from __future__ import annotations

import math
from collections.abc import Iterable

import numpy as np
import pandas as pd

from .policies import tier_labels


def note_metrics(reviews: pd.DataFrame, note_ids: Iterable[str]) -> pd.DataFrame:
    note_ids = list(note_ids)
    grouped = reviews.loc[reviews["targetNoteId"].isin(note_ids)].groupby("targetNoteId")
    metrics = grouped.agg(
        review_count=("id", "size"),
        p50_ms=("activeMs", "median"),
        p90_ms=("activeMs", lambda values: values.quantile(0.9)),
        error_rate=("wrong_count", lambda values: values.gt(0).mean()),
        mean_wrong_count=("wrong_count", "mean"),
    )
    return metrics.reindex(note_ids)


def medium_or_higher_active_days(reviews: pd.DataFrame, note_ids: Iterable[str]) -> tuple[list[str], pd.DataFrame]:
    note_ids = list(note_ids)
    target = reviews.loc[reviews["targetNoteId"].isin(note_ids)]
    daily = target.groupby("local_date").agg(
        review_count=("id", "size"),
        note_count=("targetNoteId", "nunique"),
    )
    low = float(daily["review_count"].quantile(1 / 3))
    high = float(daily["review_count"].quantile(2 / 3))
    daily["heat_level"] = np.select(
        [daily["review_count"].le(low), daily["review_count"].le(high)],
        [1, 2],
        default=3,
    )
    daily["medium_or_higher"] = daily["heat_level"].ge(2)
    daily["volume_p33"] = low
    daily["volume_p67"] = high
    return daily.index[daily["medium_or_higher"]].tolist(), daily


def recent_active_window(
    reviews: pd.DataFrame, note_ids: Iterable[str], active_days: list[str], count: int = 7
) -> pd.DataFrame:
    selected_days = active_days[-count:]
    return reviews.loc[reviews["local_date"].isin(selected_days) & reviews["targetNoteId"].isin(note_ids)].copy()


def recent_per_note_window(reviews: pd.DataFrame, note_ids: Iterable[str], count: int) -> pd.DataFrame:
    note_ids = list(note_ids)
    target = reviews.loc[reviews["targetNoteId"].isin(note_ids)].sort_values("started_at")
    return target.groupby("targetNoteId", group_keys=False).tail(count).copy()


def compare_metric_windows(
    reviews: pd.DataFrame,
    note_ids: Iterable[str],
    active_day_window: pd.DataFrame,
    *,
    iterations: int = 500,
) -> pd.DataFrame:
    note_ids = list(note_ids)
    windows = {
        "medium_or_higher_days": active_day_window,
        "last_20_per_note": recent_per_note_window(reviews, note_ids, 20),
        "last_50_per_note": recent_per_note_window(reviews, note_ids, 50),
        "last_100_per_note": recent_per_note_window(reviews, note_ids, 100),
    }
    latest_at = reviews["completed_at"].max()
    rows: list[dict[str, float | int | str]] = []
    for window_name, window in windows.items():
        stability, summary = bootstrap_recent_metrics(window, note_ids, iterations=iterations)
        counts = window.groupby("targetNoteId").size().reindex(note_ids, fill_value=0)
        oldest = window.groupby("targetNoteId")["completed_at"].min().reindex(note_ids)
        oldest_age_days = (latest_at - oldest).dt.total_seconds() / 86400
        rows.append(
            {
                "window": window_name,
                "review_count": len(window),
                "min_reviews_per_note": int(counts.min()),
                "max_reviews_per_note": int(counts.max()),
                "median_oldest_age_days": float(oldest_age_days.median()),
                "mean_p50_tier_stability": summary["mean_p50_tier_stability"],
                "mean_p90_tier_stability": summary["mean_p90_tier_stability"],
                "median_p50_ci_width_ms": summary["median_p50_ci_width_ms"],
                "median_p90_ci_width_ms": summary["median_p90_ci_width_ms"],
                "p50_p33_ms": summary["p50_p33_ms"],
                "p50_p67_ms": summary["p50_p67_ms"],
            }
        )
    return pd.DataFrame(rows)


def daily_speed_metrics(reviews: pd.DataFrame, note_ids: Iterable[str]) -> pd.DataFrame:
    target = reviews.loc[reviews["targetNoteId"].isin(note_ids)]
    raw = target.groupby("local_date").agg(
        review_count=("id", "size"),
        raw_p50_ms=("activeMs", "median"),
        raw_p90_ms=("activeMs", lambda values: values.quantile(0.9)),
        error_rate=("wrong_count", lambda values: values.gt(0).mean()),
        note_count=("targetNoteId", "nunique"),
    )
    per_note_day = target.groupby(["local_date", "targetNoteId"]).agg(
        note_p50_ms=("activeMs", "median"),
        note_p90_ms=("activeMs", lambda values: values.quantile(0.9)),
        note_error_rate=("wrong_count", lambda values: values.gt(0).mean()),
    )
    macro = per_note_day.groupby("local_date").agg(
        macro_p50_ms=("note_p50_ms", "mean"),
        macro_p90_ms=("note_p90_ms", "mean"),
        macro_error_rate=("note_error_rate", "mean"),
    )
    return raw.join(macro).reset_index()


def rolling_equal_note_metrics(
    reviews: pd.DataFrame,
    note_ids: Iterable[str],
    *,
    review_window: int = 100,
    minimum_reviews_per_note: int = 20,
) -> pd.DataFrame:
    note_ids = list(note_ids)
    rows: list[dict[str, float | int | str]] = []
    for local_date in sorted(reviews["local_date"].unique()):
        history = reviews.loc[reviews["local_date"].le(local_date)]
        recent = recent_per_note_window(history, note_ids, review_window)
        metrics = note_metrics(recent, note_ids)
        if metrics["review_count"].fillna(0).min() < minimum_reviews_per_note:
            continue
        rows.append(
            {
                "local_date": local_date,
                "review_count": len(recent),
                "min_reviews_per_note": int(metrics["review_count"].min()),
                "macro_p50_ms": float(metrics["p50_ms"].mean()),
                "macro_p90_ms": float(metrics["p90_ms"].mean()),
                "macro_error_rate": float(metrics["error_rate"].mean()),
            }
        )
    return pd.DataFrame(rows)


def _rank_correlation(left: pd.Series, right: pd.Series) -> float:
    pair = pd.concat([left, right], axis=1).dropna()
    if len(pair) < 3 or pair.iloc[:, 0].nunique() < 2 or pair.iloc[:, 1].nunique() < 2:
        return math.nan
    return float(pair.iloc[:, 0].rank(method="average").corr(pair.iloc[:, 1].rank(method="average")))


def cross_day_metric_alignment(
    reviews: pd.DataFrame, note_ids: Iterable[str], active_days: list[str], window_days: int = 7
) -> pd.DataFrame:
    note_ids = list(note_ids)
    rows: list[dict[str, float | int | str]] = []
    for future_index in range(2, len(active_days)):
        training_days = active_days[max(0, future_index - window_days) : future_index]
        future_day = active_days[future_index]
        training = reviews.loc[reviews["local_date"].isin(training_days)]
        future = reviews.loc[reviews["local_date"].eq(future_day)]
        training_metrics = note_metrics(training, note_ids)
        future_metrics = note_metrics(future, note_ids)
        eligible = training_metrics["review_count"].ge(3) & future_metrics["review_count"].ge(3)
        training_metrics = training_metrics.loc[eligible]
        future_metrics = future_metrics.loc[eligible]
        if len(training_metrics) < 3:
            continue
        training_p50_tiers = tier_labels(training_metrics["p50_ms"])
        training_p90_tiers = tier_labels(training_metrics["p90_ms"])
        future_p50_tiers = tier_labels(future_metrics["p50_ms"])
        future_p90_tiers = tier_labels(future_metrics["p90_ms"])
        rows.append(
            {
                "future_day": future_day,
                "training_day_count": len(training_days),
                "note_count": len(training_metrics),
                "p50_rank_correlation": _rank_correlation(training_metrics["p50_ms"], future_metrics["p50_ms"]),
                "p90_rank_correlation": _rank_correlation(training_metrics["p90_ms"], future_metrics["p90_ms"]),
                "p50_weak_retention": float(training_p50_tiers.eq("weak").loc[future_p50_tiers.eq("weak")].mean()),
                "p90_weak_retention": float(training_p90_tiers.eq("weak").loc[future_p90_tiers.eq("weak")].mean()),
            }
        )
    return pd.DataFrame(rows)


def bootstrap_recent_metrics(
    reviews: pd.DataFrame,
    note_ids: Iterable[str],
    *,
    iterations: int = 500,
    seed: int = 20260713,
) -> tuple[pd.DataFrame, dict[str, float]]:
    note_ids = list(note_ids)
    rng = np.random.default_rng(seed)
    samples: dict[str, np.ndarray] = {
        note_id: reviews.loc[reviews["targetNoteId"].eq(note_id), "activeMs"].to_numpy(dtype=float)
        for note_id in note_ids
    }
    point = note_metrics(reviews, note_ids)
    point_p50_tiers = tier_labels(point["p50_ms"])
    point_p90_tiers = tier_labels(point["p90_ms"])
    p50_values = np.full((iterations, len(note_ids)), np.nan)
    p90_values = np.full((iterations, len(note_ids)), np.nan)
    p50_thresholds = np.full((iterations, 2), np.nan)
    p90_thresholds = np.full((iterations, 2), np.nan)
    p50_matches = np.zeros((iterations, len(note_ids)), dtype=bool)
    p90_matches = np.zeros((iterations, len(note_ids)), dtype=bool)
    for iteration in range(iterations):
        for note_index, note_id in enumerate(note_ids):
            values = samples[note_id]
            if len(values) == 0:
                continue
            draw = rng.choice(values, size=len(values), replace=True)
            p50_values[iteration, note_index] = np.quantile(draw, 0.5)
            p90_values[iteration, note_index] = np.quantile(draw, 0.9)
        p50_series = pd.Series(p50_values[iteration], index=note_ids)
        p90_series = pd.Series(p90_values[iteration], index=note_ids)
        p50_thresholds[iteration] = np.nanquantile(p50_values[iteration], [1 / 3, 2 / 3])
        p90_thresholds[iteration] = np.nanquantile(p90_values[iteration], [1 / 3, 2 / 3])
        p50_matches[iteration] = tier_labels(p50_series).eq(point_p50_tiers).to_numpy()
        p90_matches[iteration] = tier_labels(p90_series).eq(point_p90_tiers).to_numpy()

    stability = point.copy()
    stability["p50_ci_low_ms"] = np.nanquantile(p50_values, 0.025, axis=0)
    stability["p50_ci_high_ms"] = np.nanquantile(p50_values, 0.975, axis=0)
    stability["p90_ci_low_ms"] = np.nanquantile(p90_values, 0.025, axis=0)
    stability["p90_ci_high_ms"] = np.nanquantile(p90_values, 0.975, axis=0)
    stability["p50_tier_stability"] = p50_matches.mean(axis=0)
    stability["p90_tier_stability"] = p90_matches.mean(axis=0)
    summary = {
        "p50_p33_ms": float(point["p50_ms"].quantile(1 / 3)),
        "p50_p67_ms": float(point["p50_ms"].quantile(2 / 3)),
        "p90_p33_ms": float(point["p90_ms"].quantile(1 / 3)),
        "p90_p67_ms": float(point["p90_ms"].quantile(2 / 3)),
        "p50_p33_ci_low_ms": float(np.nanquantile(p50_thresholds[:, 0], 0.025)),
        "p50_p33_ci_high_ms": float(np.nanquantile(p50_thresholds[:, 0], 0.975)),
        "p50_p67_ci_low_ms": float(np.nanquantile(p50_thresholds[:, 1], 0.025)),
        "p50_p67_ci_high_ms": float(np.nanquantile(p50_thresholds[:, 1], 0.975)),
        "p90_p33_ci_low_ms": float(np.nanquantile(p90_thresholds[:, 0], 0.025)),
        "p90_p33_ci_high_ms": float(np.nanquantile(p90_thresholds[:, 0], 0.975)),
        "p90_p67_ci_low_ms": float(np.nanquantile(p90_thresholds[:, 1], 0.025)),
        "p90_p67_ci_high_ms": float(np.nanquantile(p90_thresholds[:, 1], 0.975)),
        "mean_p50_tier_stability": float(stability["p50_tier_stability"].mean()),
        "mean_p90_tier_stability": float(stability["p90_tier_stability"].mean()),
        "median_p50_ci_width_ms": float((stability["p50_ci_high_ms"] - stability["p50_ci_low_ms"]).median()),
        "median_p90_ci_width_ms": float((stability["p90_ci_high_ms"] - stability["p90_ci_low_ms"]).median()),
    }
    return stability, summary


def error_signal_summary(reviews: pd.DataFrame, note_ids: Iterable[str]) -> dict[str, float]:
    target = reviews.loc[reviews["targetNoteId"].isin(note_ids)].copy()
    clean = target.loc[target["wrong_count"].eq(0), "activeMs"]
    wrong = target.loc[target["wrong_count"].gt(0), "activeMs"]
    metrics = note_metrics(target, note_ids)
    p50_error_correlation = _rank_correlation(metrics["p50_ms"], metrics["error_rate"])
    p90_error_correlation = _rank_correlation(metrics["p90_ms"], metrics["error_rate"])
    error_tiers = tier_labels(metrics["error_rate"])
    return {
        "clean_review_count": int(len(clean)),
        "wrong_review_count": int(len(wrong)),
        "clean_p50_ms": float(clean.median()),
        "wrong_p50_ms": float(wrong.median()),
        "clean_p90_ms": float(clean.quantile(0.9)),
        "wrong_p90_ms": float(wrong.quantile(0.9)),
        "wrong_to_clean_p50_ratio": float(wrong.median() / clean.median()),
        "p50_error_rank_correlation": p50_error_correlation,
        "p90_error_rank_correlation": p90_error_correlation,
        "p50_weak_error_weak_overlap": float(
            tier_labels(metrics["p50_ms"]).eq("weak").loc[error_tiers.eq("weak")].mean()
        ),
        "p90_weak_error_weak_overlap": float(
            tier_labels(metrics["p90_ms"]).eq("weak").loc[error_tiers.eq("weak")].mean()
        ),
    }
