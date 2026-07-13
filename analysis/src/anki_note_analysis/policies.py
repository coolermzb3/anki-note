from __future__ import annotations

import json
import math
from collections.abc import Iterable
from dataclasses import dataclass
from pathlib import Path

import numpy as np
import pandas as pd

ADAPTIVE_V2_SPEC = json.loads(
    (Path(__file__).resolve().parents[3] / "src" / "domain" / "adaptiveV2Spec.json").read_text(encoding="utf-8")
)


@dataclass(frozen=True)
class CurrentWeightParameters:
    new_card_rate: float = 0.25
    new_card_reward: float = 2.0
    new_card_decay: float = 0.4
    slow_threshold_ms: float = 1400.0
    slow_scale_ms: float = 1000.0
    slow_cap: float = 3.0
    error_weight: float = 3.0


DEFAULT_CURRENT_WEIGHT_PARAMETERS = CurrentWeightParameters()


def note_performance(reviews: pd.DataFrame, note_ids: Iterable[str]) -> pd.DataFrame:
    rows: list[dict[str, float | int | str]] = []
    for note_id in note_ids:
        note_reviews = reviews.loc[reviews["targetNoteId"] == note_id].sort_values("started_at")
        recent = note_reviews.tail(20)
        count = len(note_reviews)
        rows.append(
            {
                "target_note_id": note_id,
                "exposure": count,
                "recent_p50_ms": float(recent["activeMs"].median()) if not recent.empty else math.nan,
                "recent_p90_ms": float(recent["activeMs"].quantile(0.9)) if not recent.empty else math.nan,
                "error_rate": float(note_reviews["wrong_count"].gt(0).mean()) if count else 0.0,
            }
        )
    return pd.DataFrame(rows).set_index("target_note_id")


def current_weights(
    performance: pd.DataFrame,
    parameters: CurrentWeightParameters = DEFAULT_CURRENT_WEIGHT_PARAMETERS,
) -> pd.Series:
    exposure = performance["exposure"].astype(float)
    new_reward = (parameters.new_card_reward - exposure * parameters.new_card_decay).clip(lower=0)
    slow = ((performance["recent_p50_ms"] - parameters.slow_threshold_ms) / parameters.slow_scale_ms).clip(
        lower=0, upper=parameters.slow_cap
    )
    slow = slow.fillna(0)
    return 1 + new_reward + slow + performance["error_rate"] * parameters.error_weight


def _coverage_distribution(performance: pd.DataFrame) -> pd.Series:
    minimum = performance["exposure"].min()
    selected = performance["exposure"].eq(minimum)
    return selected.astype(float) / selected.sum()


def _weighted_distribution(performance: pd.DataFrame, weights: pd.Series, new_card_rate: float) -> pd.Series:
    coverage = _coverage_distribution(performance)
    weighted = weights / weights.sum()
    return coverage * new_card_rate + weighted * (1 - new_card_rate)


def adaptive_distribution(
    performance: pd.DataFrame,
    parameters: CurrentWeightParameters = DEFAULT_CURRENT_WEIGHT_PARAMETERS,
) -> pd.Series:
    return _weighted_distribution(performance, current_weights(performance, parameters), parameters.new_card_rate)


def focused_note_ids(performance: pd.DataFrame, weights: pd.Series) -> list[str]:
    if len(performance) <= 3 or weights.max() == weights.min():
        return performance.index.tolist()
    target_count = max(3, math.ceil(len(performance) / 2))
    ordered = weights.sort_values(ascending=False, kind="stable")
    threshold = ordered.iloc[target_count - 1]
    return ordered.loc[ordered >= threshold].index.tolist()


def focused_distribution(
    performance: pd.DataFrame,
    parameters: CurrentWeightParameters = DEFAULT_CURRENT_WEIGHT_PARAMETERS,
    focused_rate: float = 0.8,
) -> pd.Series:
    weights = current_weights(performance, parameters)
    focused_ids = focused_note_ids(performance, weights)
    focused = _weighted_distribution(
        performance.loc[focused_ids], weights.loc[focused_ids], parameters.new_card_rate
    ).reindex(performance.index, fill_value=0)
    full = _weighted_distribution(performance, weights, parameters.new_card_rate)
    return focused * focused_rate + full * (1 - focused_rate)


def tier_labels(scores: pd.Series) -> pd.Series:
    ordered = scores.sort_values(ascending=False, na_position="first", kind="stable")
    chunks = np.array_split(ordered.index.to_numpy(), 3)
    labels = pd.Series(index=scores.index, dtype="object")
    for label, chunk in zip(("weak", "middle", "strong"), chunks, strict=True):
        labels.loc[chunk] = label
    return labels


def tier_distribution(
    performance: pd.DataFrame,
    scores: pd.Series,
    tier_shares: tuple[float, float, float] = (0.6, 0.3, 0.1),
    coverage_rate: float = 0.25,
) -> pd.Series:
    labels = tier_labels(scores)
    tier_draw = pd.Series(0.0, index=performance.index)
    for label, share in zip(("weak", "middle", "strong"), tier_shares, strict=True):
        members = labels.index[labels.eq(label)]
        if len(members):
            tier_draw.loc[members] = share / len(members)
    return _coverage_distribution(performance) * coverage_rate + tier_draw * (1 - coverage_rate)


def adaptive_v2_scores(performance: pd.DataFrame) -> pd.Series:
    cold_start_count = ADAPTIVE_V2_SPEC["coldStartReviewCount"]
    review_limit = ADAPTIVE_V2_SPEC["performanceReviewLimit"]
    mature = performance.loc[performance["exposure"] >= cold_start_count, "recent_p50_ms"].dropna()
    prior = float(mature.median()) if not mature.empty else math.nan
    scores = pd.Series(math.nan, index=performance.index, dtype=float)
    for note_id, row in performance.iterrows():
        count = min(float(row["exposure"]), review_limit)
        if count < cold_start_count or math.isnan(float(row["recent_p50_ms"])) or math.isnan(prior):
            continue
        alpha = min(1.0, max(0.0, (count - cold_start_count) / (review_limit - cold_start_count)))
        scores.loc[note_id] = (1 - alpha) * prior + alpha * float(row["recent_p50_ms"])
    return scores


def adaptive_v2_tier_weights(scores: pd.Series) -> pd.Series:
    mature = scores.dropna().sort_values(ascending=False, kind="stable")
    chunks = np.array_split(np.arange(len(mature)), 3)
    slot_weights = np.zeros(len(mature), dtype=float)
    for weight, positions in zip(ADAPTIVE_V2_SPEC["tierWeights"], chunks, strict=True):
        slot_weights[positions] = weight
    weights = pd.Series(0.0, index=scores.index)
    start = 0
    while start < len(mature):
        end = start + 1
        while end < len(mature) and math.isclose(mature.iloc[end], mature.iloc[start], abs_tol=1e-9):
            end += 1
        weights.loc[mature.index[start:end]] = float(slot_weights[start:end].mean())
        start = end
    return weights


def adaptive_v2_distribution(performance: pd.DataFrame, newcomer_rate: float | None = None) -> pd.Series:
    cold_start_count = ADAPTIVE_V2_SPEC["coldStartReviewCount"]
    newcomer_rate = ADAPTIVE_V2_SPEC["newcomerRate"] if newcomer_rate is None else newcomer_rate
    counts = performance["exposure"]
    newcomers = counts < cold_start_count
    if newcomers.any() and counts.max() <= cold_start_count:
        minimum = counts.loc[newcomers].min()
        selected = newcomers & counts.eq(minimum)
        return selected.astype(float) / selected.sum()

    tier_weights = adaptive_v2_tier_weights(adaptive_v2_scores(performance))
    mature_draw = tier_weights / tier_weights.sum()
    if not newcomers.any():
        return mature_draw
    minimum = counts.loc[newcomers].min()
    newcomer_draw = (newcomers & counts.eq(minimum)).astype(float)
    newcomer_draw /= newcomer_draw.sum()
    return mature_draw * (1 - newcomer_rate) + newcomer_draw * newcomer_rate


def distribution_summary(probabilities: pd.Series) -> dict[str, float]:
    positive = probabilities.loc[probabilities > 0]
    entropy = float(-(positive * np.log(positive)).sum())
    return {
        "min_probability": float(probabilities.min()),
        "max_probability": float(probabilities.max()),
        "effective_note_count": float(math.exp(entropy)),
        "coefficient_of_variation": float(probabilities.std(ddof=0) / probabilities.mean()),
    }
