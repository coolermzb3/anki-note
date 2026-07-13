from __future__ import annotations

import math
from collections.abc import Iterable
from dataclasses import asdict

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
        metric = p50_scores if "p50" in policy else p90_scores
        labels = tier_labels(metric).loc[note_ids]
        tier_codes = labels.map({"weak": 0, "middle": 1, "strong": 2}).to_numpy(dtype=int)
        tier_shares = np.array((0.6, 0.3, 0.1) if "631" in policy else (0.5, 0.3, 0.2))
    balanced_cold_start = policy.endswith("_bootstrap") and exposures.max() < 5

    for position in range(draw_count):
        weights = (
            1
            + np.maximum(0, parameters.new_card_reward - exposures * parameters.new_card_decay)
            + np.nan_to_num(
                np.clip((recent_p50 - parameters.slow_threshold_ms) / parameters.slow_scale_ms, 0, parameters.slow_cap)
            )
            + error_rates * parameters.error_weight
        )
        source = np.arange(note_count)
        guard_eligible = source if last_index is None or note_count <= 1 else source[source != last_index]
        maintenance_eligible = (
            guard_eligible[exposures[guard_eligible] >= ADAPTIVE_V2_SPEC["coldStartReviewCount"]]
            if policy == "adaptive_v2"
            else guard_eligible
        )
        unseen_counts = position - last_seen[maintenance_eligible] - 1
        effective_maintenance_gap = ADAPTIVE_V2_SPEC["maintenanceGap"] if policy == "adaptive_v2" else maintenance_gap
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
    note_ids = list(note_ids)
    performance = note_performance(history, note_ids)
    recent = note_metrics(recent_window, note_ids)
    p50_scores = recent["p50_ms"].fillna(float("inf"))
    p90_scores = recent["p90_ms"].fillna(float("inf"))
    p50_tiers = tier_labels(p50_scores)
    p90_tiers = tier_labels(p90_scores)
    initial_unseen_counts = observed_unseen_gaps(history, note_ids).set_index("target_note_id")["current_unseen_gap"]
    note_rows: list[dict[str, float | int | str]] = []
    summary_rows: list[dict[str, float | int | str]] = []

    for policy_index, policy in enumerate(policies):
        run_counts = np.zeros((repetitions, len(note_ids)), dtype=int)
        run_gaps = np.zeros((repetitions, len(note_ids)), dtype=int)
        run_effective_counts = np.zeros(repetitions)
        run_cvs = np.zeros(repetitions)
        for repetition in range(repetitions):
            counts, gaps = simulate_queue(
                performance,
                policy,
                p50_scores=p50_scores,
                p90_scores=p90_scores,
                draw_count=draw_count,
                seed=seed + policy_index * repetitions + repetition,
                initial_unseen_counts=initial_unseen_counts if policy == "adaptive_v2" else None,
            )
            run_counts[repetition] = counts.loc[note_ids].to_numpy()
            run_gaps[repetition] = gaps.loc[note_ids].to_numpy()
            shares = counts / draw_count
            summary = distribution_summary(shares)
            run_effective_counts[repetition] = summary["effective_note_count"]
            run_cvs[repetition] = summary["coefficient_of_variation"]

        for note_index, note_id in enumerate(note_ids):
            draws = run_counts[:, note_index]
            gaps = run_gaps[:, note_index]
            note_rows.append(
                {
                    "state_date": state_date,
                    "policy": policy,
                    "target_note_id": note_id,
                    "p50_tier": p50_tiers.loc[note_id],
                    "p90_tier": p90_tiers.loc[note_id],
                    "mean_draw_count": float(draws.mean()),
                    "draw_count_ci_low": float(np.quantile(draws, 0.025)),
                    "draw_count_ci_high": float(np.quantile(draws, 0.975)),
                    "mean_draw_share": float(draws.mean() / draw_count),
                    "mean_max_unseen_gap": float(gaps.mean()),
                    "max_unseen_gap_p95": float(np.quantile(gaps, 0.95)),
                }
            )

        weak_p50 = p50_tiers.eq("weak").to_numpy()
        weak_p90 = p90_tiers.eq("weak").to_numpy()
        summary_rows.append(
            {
                "state_date": state_date,
                "policy": policy,
                "draw_count": draw_count,
                "repetitions": repetitions,
                "mean_effective_note_count": float(run_effective_counts.mean()),
                "mean_coefficient_of_variation": float(run_cvs.mean()),
                "mean_min_note_draw_count": float(run_counts.min(axis=1).mean()),
                "min_note_draw_count_p05": float(np.quantile(run_counts.min(axis=1), 0.05)),
                "mean_worst_unseen_gap": float(run_gaps.max(axis=1).mean()),
                "worst_unseen_gap_p95": float(np.quantile(run_gaps.max(axis=1), 0.95)),
                "mean_p50_weak_allocation": float(run_counts[:, weak_p50].sum(axis=1).mean() / draw_count),
                "mean_p90_weak_allocation": float(run_counts[:, weak_p90].sum(axis=1).mean() / draw_count),
            }
        )
    return pd.DataFrame(note_rows), pd.DataFrame(summary_rows)


def historical_queue_replay(
    history: pd.DataFrame,
    note_ids: Iterable[str],
    state_days: list[str],
    *,
    draw_count: int = 300,
    repetitions: int = 50,
    review_window: int = 100,
) -> tuple[pd.DataFrame, pd.DataFrame]:
    note_ids = list(note_ids)
    states: list[tuple[str, pd.DataFrame, pd.DataFrame]] = []
    for state_date in state_days[2:]:
        prior = history.loc[history["local_date"].lt(state_date)]
        states.append((state_date, prior, recent_per_note_window(prior, note_ids, review_window)))
    latest_date = str(history["local_date"].max())
    states.append(
        (
            f"after_{latest_date}",
            history,
            recent_per_note_window(history, note_ids, review_window),
        )
    )

    note_results: list[pd.DataFrame] = []
    summaries: list[pd.DataFrame] = []
    for state_index, (state_date, prior, recent) in enumerate(states):
        notes, summary = queue_replay_at_state(
            prior,
            recent,
            note_ids,
            state_date=state_date,
            draw_count=draw_count,
            repetitions=repetitions,
            seed=20260713 + state_index * len(POLICY_NAMES) * repetitions,
        )
        note_results.append(notes)
        summaries.append(summary)
    return pd.concat(note_results, ignore_index=True), pd.concat(summaries, ignore_index=True)


def candidate_policy_distributions(
    history: pd.DataFrame,
    recent_window: pd.DataFrame,
    note_ids: Iterable[str],
) -> tuple[pd.DataFrame, pd.DataFrame]:
    note_ids = list(note_ids)
    performance = note_performance(history, note_ids)
    recent = note_metrics(recent_window, note_ids)
    p50_scores = recent["p50_ms"].fillna(recent["p50_ms"].max())
    p90_scores = recent["p90_ms"].fillna(recent["p90_ms"].max())
    adaptive_v2_performance = performance.copy()
    adaptive_v2_performance["recent_p50_ms"] = p50_scores
    distributions = {
        "adaptive_v2": adaptive_v2_distribution(adaptive_v2_performance),
        "adaptive_current": adaptive_distribution(performance),
        "focused_current": focused_distribution(performance),
        "tier_p50_631": tier_distribution(performance, p50_scores, (0.6, 0.3, 0.1)),
        "tier_p90_631": tier_distribution(performance, p90_scores, (0.6, 0.3, 0.1)),
        "tier_p50_532": tier_distribution(performance, p50_scores, (0.5, 0.3, 0.2)),
        "tier_p90_532": tier_distribution(performance, p90_scores, (0.5, 0.3, 0.2)),
    }
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
