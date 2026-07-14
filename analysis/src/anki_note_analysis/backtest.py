from __future__ import annotations

import json
import math
import os
from collections.abc import Iterable
from concurrent.futures import ProcessPoolExecutor
from dataclasses import asdict, dataclass
from hashlib import sha256
from pathlib import Path

import numpy as np
import pandas as pd

from .metrics import note_metrics, recent_per_note_window
from .policies import (
    ADAPTIVE_V2_SPEC,
    DEFAULT_CURRENT_WEIGHT_PARAMETERS,
    CurrentWeightParameters,
    adaptive_distribution,
    adaptive_v2_distribution,
    current_weights,
    distribution_summary,
    focused_distribution,
    note_performance,
    tier_distribution,
    tier_labels,
)

POLICY_NAMES = (
    "adaptive_v2",
    "adaptive_current",
    "focused_current",
    "tier_p50_631",
    "tier_p90_631",
    "tier_p50_532",
    "tier_p90_532",
    "tier_p50_631_bootstrap",
    "tier_p50_532_bootstrap",
)

CACHE_FORMAT_VERSION = 1
AUTO_JOB_LIMIT = 8


@dataclass(frozen=True)
class ReplayState:
    state_date: str
    performance: pd.DataFrame
    p50_scores: pd.Series
    p90_scores: pd.Series
    p50_tiers: pd.Series
    p90_tiers: pd.Series
    initial_unseen_counts: pd.Series


@dataclass(frozen=True)
class ReplayJob:
    state: ReplayState
    policy: str
    draw_count: int
    repetitions: int
    seed: int


@dataclass(frozen=True)
class ReplayResult:
    state_date: str
    policy: str
    draw_count: int
    repetitions: int
    run_counts: np.ndarray
    run_gaps: np.ndarray


def _draw_index(rng: np.random.Generator, probabilities: np.ndarray) -> int:
    probabilities = probabilities / probabilities.sum()
    return int(rng.choice(len(probabilities), p=probabilities))


def _adaptive_v2_mature_weights(exposures: np.ndarray, recent_p50: np.ndarray) -> np.ndarray:
    cold_start_count = ADAPTIVE_V2_SPEC["coldStartReviewCount"]
    review_limit = ADAPTIVE_V2_SPEC["performanceReviewLimit"]
    mature = (exposures >= cold_start_count) & np.isfinite(recent_p50)
    if not mature.any():
        return (exposures >= cold_start_count).astype(float)
    prior = float(np.median(recent_p50[mature]))
    alpha = np.clip((np.minimum(exposures, review_limit) - cold_start_count) / (review_limit - cold_start_count), 0, 1)
    scores = (1 - alpha) * prior + alpha * recent_p50
    mature_indexes = np.flatnonzero(mature)
    ordered = mature_indexes[np.argsort(-scores[mature_indexes], kind="stable")]
    chunks = np.array_split(np.arange(len(ordered)), 3)
    slot_weights = np.zeros(len(ordered), dtype=float)
    for weight, positions in zip(ADAPTIVE_V2_SPEC["tierWeights"], chunks, strict=True):
        slot_weights[positions] = weight
    weights = np.zeros(len(exposures), dtype=float)
    start = 0
    while start < len(ordered):
        end = start + 1
        while end < len(ordered) and math.isclose(scores[ordered[end]], scores[ordered[start]], abs_tol=1e-9):
            end += 1
        weights[ordered[start:end]] = slot_weights[start:end].mean()
        start = end
    return weights


def simulate_queue(
    performance: pd.DataFrame,
    policy: str,
    *,
    p50_scores: pd.Series,
    p90_scores: pd.Series,
    draw_count: int = 300,
    seed: int = 0,
    parameters: CurrentWeightParameters = DEFAULT_CURRENT_WEIGHT_PARAMETERS,
    maintenance_gap: int | None = None,
    initial_unseen_counts: pd.Series | None = None,
    precomputed_tier_codes: np.ndarray | None = None,
) -> tuple[pd.Series, pd.Series]:
    if policy not in POLICY_NAMES:
        raise ValueError(f"Unknown policy: {policy}")
    if draw_count < 1:
        raise ValueError("draw_count must be positive")

    note_ids = performance.index.tolist()
    note_count = len(note_ids)
    exposures = performance["exposure"].to_numpy(dtype=float).copy()
    recent_p50 = performance["recent_p50_ms"].to_numpy(dtype=float)
    adaptive_v2_recent_p50 = p50_scores.reindex(note_ids).to_numpy(dtype=float)
    error_rates = performance["error_rate"].to_numpy(dtype=float)
    counts = np.zeros(note_count, dtype=int)
    positions: list[list[int]] = [[] for _ in note_ids]
    if initial_unseen_counts is None:
        last_seen = np.full(note_count, -1, dtype=int)
    else:
        initial = initial_unseen_counts.reindex(note_ids, fill_value=0).to_numpy(dtype=int)
        last_seen = -initial - 1
    rng = np.random.default_rng(seed)
    last_index: int | None = None
    tier_codes = None
    tier_shares = None
    if policy.startswith("tier_"):
        if precomputed_tier_codes is None:
            metric = p50_scores if "p50" in policy else p90_scores
            labels = tier_labels(metric).loc[note_ids]
            tier_codes = labels.map({"weak": 0, "middle": 1, "strong": 2}).to_numpy(dtype=int)
        else:
            tier_codes = np.asarray(precomputed_tier_codes, dtype=int)
            if len(tier_codes) != note_count:
                raise ValueError("precomputed_tier_codes must match the note count")
        tier_shares = np.array((0.6, 0.3, 0.1) if "631" in policy else (0.5, 0.3, 0.2))
    balanced_cold_start = policy.endswith("_bootstrap") and exposures.max() < 5
    all_indexes = np.arange(note_count)
    effective_maintenance_gap = ADAPTIVE_V2_SPEC["maintenanceGap"] if policy == "adaptive_v2" else maintenance_gap

    for position in range(draw_count):
        weights = None
        if policy in ("adaptive_current", "focused_current"):
            weights = (
                1
                + np.maximum(0, parameters.new_card_reward - exposures * parameters.new_card_decay)
                + np.nan_to_num(
                    np.clip(
                        (recent_p50 - parameters.slow_threshold_ms) / parameters.slow_scale_ms, 0, parameters.slow_cap
                    )
                )
                + error_rates * parameters.error_weight
            )
        source = all_indexes
        guard_eligible = source if last_index is None or note_count <= 1 else source[source != last_index]
        maintenance_eligible = (
            guard_eligible[exposures[guard_eligible] >= ADAPTIVE_V2_SPEC["coldStartReviewCount"]]
            if policy == "adaptive_v2"
            else guard_eligible
        )
        unseen_counts = position - last_seen[maintenance_eligible] - 1
        overdue = (
            maintenance_eligible[unseen_counts >= effective_maintenance_gap]
            if effective_maintenance_gap is not None
            else np.array([], dtype=int)
        )
        if len(overdue):
            overdue_ages = position - last_seen[overdue] - 1
            oldest = overdue[overdue_ages == overdue_ages.max()]
            selected = int(oldest[int(rng.integers(len(oldest)))])
        elif policy == "adaptive_v2":
            eligible = source if last_index is None or note_count <= 1 else source[source != last_index]
            cold_start_count = ADAPTIVE_V2_SPEC["coldStartReviewCount"]
            newcomer_eligible = eligible[exposures[eligible] < cold_start_count]
            mature_eligible = eligible[exposures[eligible] >= cold_start_count]
            broadly_new = len(newcomer_eligible) > 0 and exposures.max() <= cold_start_count
            should_draw_newcomer = (
                broadly_new
                or len(mature_eligible) == 0
                or (len(newcomer_eligible) > 0 and rng.random() < ADAPTIVE_V2_SPEC["newcomerRate"])
            )
            if should_draw_newcomer:
                minimum = exposures[newcomer_eligible].min()
                choices = newcomer_eligible[exposures[newcomer_eligible] == minimum]
                selected = int(choices[int(rng.integers(len(choices)))])
            else:
                weights_v2 = _adaptive_v2_mature_weights(exposures, adaptive_v2_recent_p50)
                selected = int(mature_eligible[_draw_index(rng, weights_v2[mature_eligible])])
        elif policy in ("adaptive_current", "focused_current"):
            assert weights is not None
            if policy == "focused_current" and rng.random() < 0.8 and note_count > 3 and weights.max() != weights.min():
                target_count = max(3, math.ceil(note_count / 2))
                ordered = sorted(range(note_count), key=lambda index: (-weights[index], note_ids[index]))
                threshold = weights[ordered[target_count - 1]]
                source = np.flatnonzero(weights >= threshold)
            eligible = source if last_index is None or len(source) <= 1 else source[source != last_index]
            if rng.random() < parameters.new_card_rate:
                minimum = exposures[eligible].min()
                choices = eligible[exposures[eligible] == minimum]
                selected = int(choices[int(rng.integers(len(choices)))])
            else:
                selected = int(eligible[_draw_index(rng, weights[eligible])])
        else:
            eligible = source if last_index is None or note_count <= 1 else source[source != last_index]
            bootstrap_only = policy.endswith("_bootstrap")
            bootstrap_eligible = eligible[exposures[eligible] < 5] if bootstrap_only else eligible
            mature_eligible = eligible[exposures[eligible] >= 5] if bootstrap_only else eligible
            should_draw_coverage = len(bootstrap_eligible) > 0 and (
                (balanced_cold_start and exposures.min() < 5)
                or len(mature_eligible) == 0
                or rng.random() < parameters.new_card_rate
            )
            if should_draw_coverage:
                minimum = exposures[bootstrap_eligible].min()
                choices = bootstrap_eligible[exposures[bootstrap_eligible] == minimum]
                selected = int(choices[int(rng.integers(len(choices)))])
            else:
                assert tier_codes is not None and tier_shares is not None
                tier_eligible = mature_eligible if bootstrap_only else eligible
                available = np.array(
                    [
                        share if np.any(tier_codes[tier_eligible] == code) else 0
                        for code, share in enumerate(tier_shares)
                    ]
                )
                selected_tier = _draw_index(rng, available)
                choices = tier_eligible[tier_codes[tier_eligible] == selected_tier]
                selected = int(choices[int(rng.integers(len(choices)))])
        counts[selected] += 1
        exposures[selected] += 1
        positions[selected].append(position)
        last_seen[selected] = position
        last_index = selected

    max_unseen_gaps = np.zeros(note_count, dtype=int)
    for note_index, seen_positions in enumerate(positions):
        boundaries = [-1, *seen_positions, draw_count]
        max_unseen_gaps[note_index] = max(
            right - left - 1 for left, right in zip(boundaries, boundaries[1:], strict=False)
        )
    return pd.Series(counts, index=note_ids), pd.Series(max_unseen_gaps, index=note_ids)


def queue_replay_at_state(
    history: pd.DataFrame,
    recent_window: pd.DataFrame,
    note_ids: Iterable[str],
    *,
    state_date: str,
    draw_count: int = 300,
    repetitions: int = 50,
    seed: int = 20260713,
    policies: Iterable[str] = POLICY_NAMES,
) -> tuple[pd.DataFrame, pd.DataFrame]:
    policy_names = tuple(policies)
    state = _prepare_replay_state(history, recent_window, list(note_ids), state_date)
    results = [
        _run_replay_job(
            ReplayJob(
                state=state,
                policy=policy,
                draw_count=draw_count,
                repetitions=repetitions,
                seed=seed + policy_index * repetitions,
            )
        )
        for policy_index, policy in enumerate(policy_names)
    ]
    return _replay_frames({state_date: state}, results)


def _prepare_replay_state(
    history: pd.DataFrame,
    recent_window: pd.DataFrame,
    note_ids: list[str],
    state_date: str,
) -> ReplayState:
    performance = note_performance(history, note_ids)
    recent = note_metrics(recent_window, note_ids)
    p50_scores = recent["p50_ms"].fillna(float("inf"))
    p90_scores = recent["p90_ms"].fillna(float("inf"))
    initial_unseen_counts = observed_unseen_gaps(history, note_ids).set_index("target_note_id")["current_unseen_gap"]
    return ReplayState(
        state_date=state_date,
        performance=performance,
        p50_scores=p50_scores,
        p90_scores=p90_scores,
        p50_tiers=tier_labels(p50_scores),
        p90_tiers=tier_labels(p90_scores),
        initial_unseen_counts=initial_unseen_counts,
    )


def _run_replay_job(job: ReplayJob) -> ReplayResult:
    note_ids = job.state.performance.index.tolist()
    run_counts = np.zeros((job.repetitions, len(note_ids)), dtype=int)
    run_gaps = np.zeros((job.repetitions, len(note_ids)), dtype=int)
    tier_codes = None
    if job.policy.startswith("tier_"):
        tiers = job.state.p50_tiers if "p50" in job.policy else job.state.p90_tiers
        tier_codes = tiers.loc[note_ids].map({"weak": 0, "middle": 1, "strong": 2}).to_numpy(dtype=int)

    for repetition in range(job.repetitions):
        counts, gaps = simulate_queue(
            job.state.performance,
            job.policy,
            p50_scores=job.state.p50_scores,
            p90_scores=job.state.p90_scores,
            draw_count=job.draw_count,
            seed=job.seed + repetition,
            initial_unseen_counts=job.state.initial_unseen_counts if job.policy == "adaptive_v2" else None,
            precomputed_tier_codes=tier_codes,
        )
        run_counts[repetition] = counts.loc[note_ids].to_numpy()
        run_gaps[repetition] = gaps.loc[note_ids].to_numpy()
    return ReplayResult(
        state_date=job.state.state_date,
        policy=job.policy,
        draw_count=job.draw_count,
        repetitions=job.repetitions,
        run_counts=run_counts,
        run_gaps=run_gaps,
    )


def _replay_frames(
    states: dict[str, ReplayState],
    results: Iterable[ReplayResult],
) -> tuple[pd.DataFrame, pd.DataFrame]:
    note_rows: list[dict[str, float | int | str]] = []
    summary_rows: list[dict[str, float | int | str]] = []
    for result in results:
        state = states[result.state_date]
        note_ids = state.performance.index.tolist()
        run_effective_counts = np.zeros(result.repetitions)
        run_cvs = np.zeros(result.repetitions)
        for repetition in range(result.repetitions):
            shares = pd.Series(result.run_counts[repetition], index=note_ids) / result.draw_count
            summary = distribution_summary(shares)
            run_effective_counts[repetition] = summary["effective_note_count"]
            run_cvs[repetition] = summary["coefficient_of_variation"]

        for note_index, note_id in enumerate(note_ids):
            draws = result.run_counts[:, note_index]
            gaps = result.run_gaps[:, note_index]
            note_rows.append(
                {
                    "state_date": result.state_date,
                    "policy": result.policy,
                    "target_note_id": note_id,
                    "p50_tier": state.p50_tiers.loc[note_id],
                    "p90_tier": state.p90_tiers.loc[note_id],
                    "mean_draw_count": float(draws.mean()),
                    "draw_count_ci_low": float(np.quantile(draws, 0.025)),
                    "draw_count_ci_high": float(np.quantile(draws, 0.975)),
                    "mean_draw_share": float(draws.mean() / result.draw_count),
                    "mean_max_unseen_gap": float(gaps.mean()),
                    "max_unseen_gap_p95": float(np.quantile(gaps, 0.95)),
                }
            )

        weak_p50 = state.p50_tiers.eq("weak").to_numpy()
        weak_p90 = state.p90_tiers.eq("weak").to_numpy()
        summary_rows.append(
            {
                "state_date": result.state_date,
                "policy": result.policy,
                "draw_count": result.draw_count,
                "repetitions": result.repetitions,
                "mean_effective_note_count": float(run_effective_counts.mean()),
                "mean_coefficient_of_variation": float(run_cvs.mean()),
                "mean_min_note_draw_count": float(result.run_counts.min(axis=1).mean()),
                "min_note_draw_count_p05": float(np.quantile(result.run_counts.min(axis=1), 0.05)),
                "mean_worst_unseen_gap": float(result.run_gaps.max(axis=1).mean()),
                "worst_unseen_gap_p95": float(np.quantile(result.run_gaps.max(axis=1), 0.95)),
                "mean_p50_weak_allocation": float(
                    result.run_counts[:, weak_p50].sum(axis=1).mean() / result.draw_count
                ),
                "mean_p90_weak_allocation": float(
                    result.run_counts[:, weak_p90].sum(axis=1).mean() / result.draw_count
                ),
            }
        )
    return pd.DataFrame(note_rows), pd.DataFrame(summary_rows)


def _replay_algorithm_fingerprint() -> str:
    source_dir = Path(__file__).resolve().parent
    paths = [
        source_dir / "backtest.py",
        source_dir / "backup.py",
        source_dir / "metrics.py",
        source_dir / "policies.py",
        Path(__file__).resolve().parents[3] / "src" / "domain" / "adaptiveV2Spec.json",
    ]
    digest = sha256()
    for path in paths:
        digest.update(path.name.encode())
        digest.update(b"\0")
        digest.update(path.read_bytes())
        digest.update(b"\0")
    return digest.hexdigest()


def _replay_cache_path(
    cache_dir: Path,
    job: ReplayJob,
    *,
    input_fingerprint: str,
    algorithm_fingerprint: str,
    review_window: int,
) -> Path:
    payload = {
        "format": CACHE_FORMAT_VERSION,
        "input": input_fingerprint,
        "algorithm": algorithm_fingerprint,
        "target_note_ids": job.state.performance.index.tolist(),
        "state_date": job.state.state_date,
        "policy": job.policy,
        "draw_count": job.draw_count,
        "repetitions": job.repetitions,
        "review_window": review_window,
        "seed": job.seed,
        "numpy_version": np.__version__,
        "pandas_version": pd.__version__,
    }
    cache_key = sha256(json.dumps(payload, sort_keys=True, separators=(",", ":")).encode()).hexdigest()
    return cache_dir / f"{cache_key}.npz"


def _load_cached_replay(path: Path, job: ReplayJob) -> ReplayResult | None:
    if not path.is_file():
        return None
    expected_shape = (job.repetitions, len(job.state.performance))
    try:
        with np.load(path, allow_pickle=False) as cached:
            run_counts = cached["run_counts"]
            run_gaps = cached["run_gaps"]
    except (OSError, ValueError, KeyError):
        return None
    if run_counts.shape != expected_shape or run_gaps.shape != expected_shape:
        return None
    return ReplayResult(
        state_date=job.state.state_date,
        policy=job.policy,
        draw_count=job.draw_count,
        repetitions=job.repetitions,
        run_counts=run_counts,
        run_gaps=run_gaps,
    )


def _write_cached_replay(path: Path, result: ReplayResult) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_name(f".{path.name}.{os.getpid()}.tmp")
    with temporary.open("wb") as handle:
        np.savez_compressed(handle, run_counts=result.run_counts, run_gaps=result.run_gaps)
    os.replace(temporary, path)


def _worker_count(jobs: int, task_count: int) -> int:
    if jobs < 0:
        raise ValueError("jobs cannot be negative")
    requested = min(os.cpu_count() or 1, AUTO_JOB_LIMIT) if jobs == 0 else jobs
    return max(1, min(requested, task_count))


def historical_queue_replay(
    history: pd.DataFrame,
    note_ids: Iterable[str],
    state_days: list[str],
    *,
    draw_count: int = 300,
    repetitions: int = 50,
    review_window: int = 100,
    jobs: int = 0,
    cache_dir: Path | None = None,
    cache_input_fingerprint: str | None = None,
    policies: Iterable[str] = POLICY_NAMES,
) -> tuple[pd.DataFrame, pd.DataFrame]:
    if jobs < 0:
        raise ValueError("jobs cannot be negative")
    note_ids = list(note_ids)
    policy_names = POLICY_NAMES if policies is None else tuple(policies)
    unknown_policies = set(policy_names) - set(POLICY_NAMES)
    if unknown_policies:
        raise ValueError(f"unknown policies: {sorted(unknown_policies)}")
    if not policy_names:
        raise ValueError("policies cannot be empty")
    raw_states: list[tuple[str, pd.DataFrame, pd.DataFrame]] = []
    for state_date in state_days[2:]:
        prior = history.loc[history["local_date"].lt(state_date)]
        raw_states.append((state_date, prior, recent_per_note_window(prior, note_ids, review_window)))
    latest_date = str(history["local_date"].max())
    raw_states.append(
        (
            f"after_{latest_date}",
            history,
            recent_per_note_window(history, note_ids, review_window),
        )
    )

    states = {
        state_date: _prepare_replay_state(prior, recent, note_ids, state_date)
        for state_date, prior, recent in raw_states
    }
    replay_jobs = [
        ReplayJob(
            state=states[state_date],
            policy=policy,
            draw_count=draw_count,
            repetitions=repetitions,
            seed=20260713
            + state_index * len(POLICY_NAMES) * repetitions
            + POLICY_NAMES.index(policy) * repetitions,
        )
        for state_index, (state_date, _, _) in enumerate(raw_states)
        for policy in policy_names
    ]

    cache_paths: dict[int, Path] = {}
    results: dict[int, ReplayResult] = {}
    algorithm_fingerprint = _replay_algorithm_fingerprint()
    if cache_dir is not None and cache_input_fingerprint is not None:
        cache_dir = Path(cache_dir)
        for index, replay_job in enumerate(replay_jobs):
            cache_path = _replay_cache_path(
                cache_dir,
                replay_job,
                input_fingerprint=cache_input_fingerprint,
                algorithm_fingerprint=algorithm_fingerprint,
                review_window=review_window,
            )
            cache_paths[index] = cache_path
            cached = _load_cached_replay(cache_path, replay_job)
            if cached is not None:
                results[index] = cached

    missing_indexes = [index for index in range(len(replay_jobs)) if index not in results]
    missing_jobs = [replay_jobs[index] for index in missing_indexes]
    if missing_jobs:
        worker_count = _worker_count(jobs, len(missing_jobs))
        if worker_count == 1:
            computed = map(_run_replay_job, missing_jobs)
        else:
            with ProcessPoolExecutor(max_workers=worker_count) as executor:
                computed = list(executor.map(_run_replay_job, missing_jobs, chunksize=1))
        for index, result in zip(missing_indexes, computed, strict=True):
            results[index] = result
            if index in cache_paths:
                _write_cached_replay(cache_paths[index], result)

    ordered_results = [results[index] for index in range(len(replay_jobs))]
    return _replay_frames(states, ordered_results)


def candidate_policy_distributions(
    history: pd.DataFrame,
    recent_window: pd.DataFrame,
    note_ids: Iterable[str],
    policies: Iterable[str] | None = None,
) -> tuple[pd.DataFrame, pd.DataFrame]:
    note_ids = list(note_ids)
    performance = note_performance(history, note_ids)
    recent = note_metrics(recent_window, note_ids)
    p50_scores = recent["p50_ms"].fillna(recent["p50_ms"].max())
    p90_scores = recent["p90_ms"].fillna(recent["p90_ms"].max())
    adaptive_v2_performance = performance.copy()
    adaptive_v2_performance["recent_p50_ms"] = p50_scores
    distribution_builders = {
        "adaptive_v2": lambda: adaptive_v2_distribution(adaptive_v2_performance),
        "adaptive_current": lambda: adaptive_distribution(performance),
        "focused_current": lambda: focused_distribution(performance),
        "tier_p50_631": lambda: tier_distribution(performance, p50_scores, (0.6, 0.3, 0.1)),
        "tier_p90_631": lambda: tier_distribution(performance, p90_scores, (0.6, 0.3, 0.1)),
        "tier_p50_532": lambda: tier_distribution(performance, p50_scores, (0.5, 0.3, 0.2)),
        "tier_p90_532": lambda: tier_distribution(performance, p90_scores, (0.5, 0.3, 0.2)),
    }
    policy_names = tuple(distribution_builders) if policies is None else tuple(policies)
    unknown_policies = set(policy_names) - set(distribution_builders)
    if unknown_policies:
        raise ValueError(f"unknown policies: {sorted(unknown_policies)}")
    if not policy_names:
        raise ValueError("policies cannot be empty")
    distributions = {policy: distribution_builders[policy]() for policy in policy_names}
    allocation = performance.copy()
    allocation["window_p50_ms"] = recent["p50_ms"]
    allocation["window_p90_ms"] = recent["p90_ms"]
    allocation["p50_tier"] = tier_labels(p50_scores)
    allocation["p90_tier"] = tier_labels(p90_scores)
    for policy, probabilities in distributions.items():
        allocation[policy] = probabilities

    summaries: list[dict[str, float | str]] = []
    for policy, probabilities in distributions.items():
        summary: dict[str, float | str] = {"policy": policy, **distribution_summary(probabilities)}
        summary["p50_weak_allocation"] = float(probabilities.loc[allocation["p50_tier"].eq("weak")].sum())
        summary["p90_weak_allocation"] = float(probabilities.loc[allocation["p90_tier"].eq("weak")].sum())
        summary["expected_min_draws_per_300"] = float(probabilities.min() * 300)
        summaries.append(summary)
    return allocation.reset_index(), pd.DataFrame(summaries)


def observed_strategy_distribution(reviews: pd.DataFrame, note_ids: Iterable[str]) -> tuple[pd.DataFrame, pd.DataFrame]:
    note_ids = list(note_ids)
    target = reviews.loc[reviews["targetNoteId"].isin(note_ids)].copy()
    strategy_column = "session_resolved_strategy"
    target[strategy_column] = target.get(strategy_column, "unknown").fillna("unknown")
    counts = (
        target.groupby([strategy_column, "targetNoteId"])
        .size()
        .unstack(fill_value=0)
        .reindex(columns=note_ids, fill_value=0)
    )
    shares = counts.div(counts.sum(axis=1), axis=0)
    summary_rows: list[dict[str, float | int | str]] = []
    for strategy in counts.index:
        probabilities = shares.loc[strategy]
        summary_rows.append(
            {
                "strategy": strategy,
                "review_count": int(counts.loc[strategy].sum()),
                **distribution_summary(probabilities),
            }
        )
    long = counts.stack(future_stack=True).rename("review_count").to_frame()
    long["share"] = shares.stack(future_stack=True)
    return long.reset_index(), pd.DataFrame(summary_rows)


def observed_unseen_gaps(reviews: pd.DataFrame, note_ids: Iterable[str]) -> pd.DataFrame:
    note_ids = list(note_ids)
    target_set_column = "session_targetNoteSetKey"
    current_gaps = dict.fromkeys(note_ids, 0)
    historical_max_gaps = dict.fromkeys(note_ids, 0)
    if target_set_column not in reviews:
        return pd.DataFrame(
            {
                "target_note_id": note_ids,
                "current_unseen_gap": [0] * len(note_ids),
                "historical_max_unseen_gap": [0] * len(note_ids),
            }
        )

    for review in reviews.sort_values("started_at").itertuples(index=False):
        target_set_key = getattr(review, target_set_column)
        if not isinstance(target_set_key, str):
            continue
        eligible_note_ids = set(target_set_key.split("|"))
        for note_id in note_ids:
            if note_id not in eligible_note_ids:
                continue
            current_gaps[note_id] = 0 if review.targetNoteId == note_id else current_gaps[note_id] + 1
            historical_max_gaps[note_id] = max(historical_max_gaps[note_id], current_gaps[note_id])

    return pd.DataFrame(
        {
            "target_note_id": note_ids,
            "current_unseen_gap": [current_gaps[note_id] for note_id in note_ids],
            "historical_max_unseen_gap": [historical_max_gaps[note_id] for note_id in note_ids],
        }
    )


def hyperparameter_sensitivity(
    history: pd.DataFrame,
    recent_window: pd.DataFrame,
    note_ids: Iterable[str],
    *,
    draw_count: int = 300,
    repetitions: int = 50,
) -> pd.DataFrame:
    note_ids = list(note_ids)
    performance = note_performance(history, note_ids)
    recent = note_metrics(recent_window, note_ids)
    weak_ids = tier_labels(recent["p50_ms"].fillna(recent["p50_ms"].max())).loc[lambda labels: labels.eq("weak")].index
    dynamic_thresholds = sorted(
        {
            1400.0,
            float(recent["p50_ms"].quantile(1 / 3)),
            float(recent["p50_ms"].quantile(2 / 3)),
        }
    )
    p50_scores = recent["p50_ms"].fillna(float("inf"))
    p90_scores = recent["p90_ms"].fillna(float("inf"))
    rows: list[dict[str, float | int]] = []
    parameter_index = 0
    for threshold in dynamic_thresholds:
        for slow_cap in (1.5, 3.0):
            for error_weight in (0.0, 1.5, 3.0):
                for new_card_rate in (0.1, 0.25):
                    parameters = CurrentWeightParameters(
                        new_card_rate=new_card_rate,
                        slow_threshold_ms=threshold,
                        slow_cap=slow_cap,
                        error_weight=error_weight,
                    )
                    weak_allocations: list[float] = []
                    effective_counts: list[float] = []
                    cvs: list[float] = []
                    minimum_draws: list[int] = []
                    worst_gaps: list[int] = []
                    for repetition in range(repetitions):
                        counts, gaps = simulate_queue(
                            performance,
                            "adaptive_current",
                            p50_scores=p50_scores,
                            p90_scores=p90_scores,
                            draw_count=draw_count,
                            seed=20260713 + parameter_index * repetitions + repetition,
                            parameters=parameters,
                        )
                        distribution = distribution_summary(counts / draw_count)
                        weak_allocations.append(float(counts.loc[weak_ids].sum() / draw_count))
                        effective_counts.append(distribution["effective_note_count"])
                        cvs.append(distribution["coefficient_of_variation"])
                        minimum_draws.append(int(counts.min()))
                        worst_gaps.append(int(gaps.max()))
                    rows.append(
                        {
                            **asdict(parameters),
                            "draw_count": draw_count,
                            "repetitions": repetitions,
                            "mean_effective_note_count": float(np.mean(effective_counts)),
                            "mean_coefficient_of_variation": float(np.mean(cvs)),
                            "mean_min_note_draw_count": float(np.mean(minimum_draws)),
                            "mean_worst_unseen_gap": float(np.mean(worst_gaps)),
                            "mean_recent_p50_weak_allocation": float(np.mean(weak_allocations)),
                            "weight_min": float(current_weights(performance, parameters).min()),
                            "weight_max": float(current_weights(performance, parameters).max()),
                        }
                    )
                    parameter_index += 1
    return pd.DataFrame(rows)


def maintenance_gap_sensitivity(
    history: pd.DataFrame,
    recent_window: pd.DataFrame,
    note_ids: Iterable[str],
    *,
    draw_count: int = 300,
    repetitions: int = 100,
) -> pd.DataFrame:
    note_ids = list(note_ids)
    performance = note_performance(history, note_ids)
    recent = note_metrics(recent_window, note_ids)
    p50_scores = recent["p50_ms"].fillna(float("inf"))
    p90_scores = recent["p90_ms"].fillna(float("inf"))
    weak_ids = tier_labels(p50_scores).loc[lambda labels: labels.eq("weak")].index
    observed_gaps = observed_unseen_gaps(history, note_ids).set_index("target_note_id")["current_unseen_gap"]
    observed_gaps.loc[performance["exposure"].lt(5)] = 0
    rows: list[dict[str, float | int | str]] = []
    for gap_index, maintenance_gap in enumerate((None, 60, 90, 120)):
        effective_counts: list[float] = []
        minimum_draws: list[int] = []
        worst_gaps: list[int] = []
        weak_allocations: list[float] = []
        for repetition in range(repetitions):
            counts, gaps = simulate_queue(
                performance,
                "tier_p50_532_bootstrap",
                p50_scores=p50_scores,
                p90_scores=p90_scores,
                draw_count=draw_count,
                seed=20260713 + gap_index * repetitions + repetition,
                maintenance_gap=maintenance_gap,
                initial_unseen_counts=observed_gaps,
            )
            effective_counts.append(distribution_summary(counts / draw_count)["effective_note_count"])
            minimum_draws.append(int(counts.min()))
            worst_gaps.append(int(gaps.max()))
            weak_allocations.append(float(counts.loc[weak_ids].sum() / draw_count))
        rows.append(
            {
                "maintenance_gap": "none" if maintenance_gap is None else maintenance_gap,
                "draw_count": draw_count,
                "repetitions": repetitions,
                "mean_effective_note_count": float(np.mean(effective_counts)),
                "mean_min_note_draw_count": float(np.mean(minimum_draws)),
                "mean_worst_unseen_gap": float(np.mean(worst_gaps)),
                "worst_unseen_gap_p95": float(np.quantile(worst_gaps, 0.95)),
                "mean_recent_p50_weak_allocation": float(np.mean(weak_allocations)),
            }
        )
    return pd.DataFrame(rows)


def cold_start_sensitivity(
    history: pd.DataFrame,
    recent_window: pd.DataFrame,
    note_ids: Iterable[str],
    *,
    draw_count: int = 40,
    repetitions: int = 100,
) -> pd.DataFrame:
    note_ids = list(note_ids)
    mature_performance = note_performance(history, note_ids)
    recent = note_metrics(recent_window, note_ids)
    base_p50 = recent["p50_ms"].fillna(recent["p50_ms"].median())
    base_p90 = recent["p90_ms"].fillna(recent["p90_ms"].median())
    rows: list[dict[str, float | int | str]] = []
    all_new = mature_performance.copy()
    all_new[["exposure", "error_rate"]] = 0
    all_new[["recent_p50_ms", "recent_p90_ms"]] = math.nan
    balanced_draw_count = max(draw_count, len(note_ids) * 5)
    all_new_minimums: list[int] = []
    all_new_effective_counts: list[float] = []
    all_new_all_bootstrapped: list[bool] = []
    for repetition in range(repetitions):
        counts, _ = simulate_queue(
            all_new,
            "tier_p50_532_bootstrap",
            p50_scores=pd.Series(float("inf"), index=note_ids),
            p90_scores=pd.Series(float("inf"), index=note_ids),
            draw_count=balanced_draw_count,
            seed=20260713 + repetition,
        )
        all_new_minimums.append(int(counts.min()))
        all_new_effective_counts.append(distribution_summary(counts / counts.sum())["effective_note_count"])
        all_new_all_bootstrapped.append(bool(counts.ge(5).all()))
    rows.append(
        {
            "scenario": "all_new_balanced",
            "new_card_rate": 1.0,
            "draw_count": balanced_draw_count,
            "repetitions": repetitions,
            "mean_min_note_draw_count": float(np.mean(all_new_minimums)),
            "probability_bootstrap_complete": float(np.mean(all_new_all_bootstrapped)),
            "mean_effective_note_count": float(np.mean(all_new_effective_counts)),
        }
    )

    for rate_index, new_card_rate in enumerate((0.1, 0.25, 0.4)):
        parameters = CurrentWeightParameters(new_card_rate=new_card_rate)
        new_note_draws: list[int] = []
        new_note_bootstrapped: list[bool] = []
        for note_index, new_note_id in enumerate(note_ids):
            performance = mature_performance.copy()
            performance.loc[new_note_id, ["exposure", "error_rate"]] = 0
            performance.loc[new_note_id, ["recent_p50_ms", "recent_p90_ms"]] = math.nan
            p50_scores = base_p50.copy()
            p90_scores = base_p90.copy()
            p50_scores.loc[new_note_id] = float("inf")
            p90_scores.loc[new_note_id] = float("inf")
            for repetition in range(repetitions):
                counts, _ = simulate_queue(
                    performance,
                    "tier_p50_532_bootstrap",
                    p50_scores=p50_scores,
                    p90_scores=p90_scores,
                    draw_count=draw_count,
                    seed=20260713 + (rate_index * len(note_ids) + note_index) * repetitions + repetition,
                    parameters=parameters,
                )
                new_note_draws.append(int(counts.loc[new_note_id]))
                new_note_bootstrapped.append(bool(counts.loc[new_note_id] >= 5))
        rows.append(
            {
                "scenario": "one_new_among_mature",
                "new_card_rate": new_card_rate,
                "draw_count": draw_count,
                "repetitions": repetitions * len(note_ids),
                "mean_new_note_draw_count": float(np.mean(new_note_draws)),
                "probability_bootstrap_complete": float(np.mean(new_note_bootstrapped)),
                "mean_mature_draw_share": float(1 - np.mean(new_note_draws) / draw_count),
            }
        )
    return pd.DataFrame(rows)


def cross_day_policy_alignment(
    history: pd.DataFrame,
    note_ids: Iterable[str],
    active_days: list[str],
    window_days: int = 7,
) -> pd.DataFrame:
    note_ids = list(note_ids)
    rows: list[dict[str, float | int | str]] = []
    for future_index in range(2, len(active_days)):
        training_days = active_days[max(0, future_index - window_days) : future_index]
        future_day = active_days[future_index]
        training = history.loc[history["local_date"].isin(training_days)]
        prior = history.loc[history["local_date"].lt(future_day)]
        future = history.loc[history["local_date"].eq(future_day)]
        training_metrics = note_metrics(training, note_ids)
        future_metrics = note_metrics(future, note_ids)
        eligible = training_metrics["review_count"].ge(3) & future_metrics["review_count"].ge(3)
        eligible_ids = training_metrics.index[eligible].tolist()
        if len(eligible_ids) < 3:
            continue
        allocation, _ = candidate_policy_distributions(prior, training, eligible_ids)
        allocation = allocation.set_index("target_note_id")
        future_weak_p50 = (
            tier_labels(future_metrics.loc[eligible_ids, "p50_ms"]).loc[lambda labels: labels.eq("weak")].index
        )
        future_weak_p90 = (
            tier_labels(future_metrics.loc[eligible_ids, "p90_ms"]).loc[lambda labels: labels.eq("weak")].index
        )
        for policy in (
            "adaptive_current",
            "focused_current",
            "tier_p50_631",
            "tier_p90_631",
            "tier_p50_532",
            "tier_p90_532",
        ):
            probabilities = allocation[policy]
            rows.append(
                {
                    "future_day": future_day,
                    "training_day_count": len(training_days),
                    "note_count": len(eligible_ids),
                    "policy": policy,
                    "future_p50_weak_allocation": float(probabilities.loc[future_weak_p50].sum()),
                    "future_p90_weak_allocation": float(probabilities.loc[future_weak_p90].sum()),
                    **distribution_summary(probabilities),
                }
            )
    return pd.DataFrame(rows)
