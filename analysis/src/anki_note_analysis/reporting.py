from __future__ import annotations

import json
import math
from pathlib import Path
from typing import Any

import matplotlib
import pandas as pd

matplotlib.use("Agg")
from matplotlib import pyplot as plt  # noqa: E402


def write_json(path: Path, value: dict[str, Any]) -> None:
    path.write_text(json.dumps(value, ensure_ascii=False, indent=2, default=str) + "\n", encoding="utf-8")


def plot_daily_speed(daily: pd.DataFrame, path: Path) -> None:
    figure, axis = plt.subplots(figsize=(10, 5))
    axis.plot(daily["local_date"], daily["macro_p50_ms"] / 1000, marker="o", label="Equal-note P50")
    axis.plot(daily["local_date"], daily["macro_p90_ms"] / 1000, marker="o", label="Equal-note P90")
    axis.set_ylabel("Seconds")
    axis.set_title("Daily equal-note recognition speed")
    axis.grid(alpha=0.25)
    axis.legend()
    figure.autofmt_xdate(rotation=30)
    figure.tight_layout()
    figure.savefig(path, dpi=160)
    plt.close(figure)


def plot_recent_notes(metrics: pd.DataFrame, path: Path) -> None:
    ordered = metrics.sort_values("p50_ms", ascending=True)
    figure, axis = plt.subplots(figsize=(11, 6))
    positions = range(len(ordered))
    axis.bar(positions, ordered["p90_ms"] / 1000, color="#d9b8a8", label="P90")
    axis.bar(positions, ordered["p50_ms"] / 1000, color="#4f8c84", label="P50")
    axis.set_xticks(list(positions), ordered.index, rotation=45)
    axis.set_ylabel("Seconds")
    axis.set_title("Latest 100 qualified reviews per note")
    axis.legend()
    figure.tight_layout()
    figure.savefig(path, dpi=160)
    plt.close(figure)


def plot_policy_allocations(allocation: pd.DataFrame, path: Path) -> None:
    policy_order = [
        "adaptive_v2",
        "adaptive_current",
        "focused_current",
        "tier_p50_631",
        "tier_p90_631",
        "tier_p50_532",
        "tier_p90_532",
    ]
    policies = [policy for policy in policy_order if policy in allocation]
    ordered = allocation.sort_values("window_p50_ms", ascending=False)
    row_count = math.ceil(len(policies) / 2)
    figure, axes = plt.subplots(row_count, 2, figsize=(12, row_count * 3.3), sharex=True, sharey=True)
    for axis, policy in zip(axes.flat, policies, strict=False):
        axis.bar(ordered["target_note_id"], ordered[policy] * 100)
        axis.set_title(policy)
        axis.tick_params(axis="x", rotation=45)
        axis.set_ylabel("Expected draw share (%)")
    for axis in axes.flat[len(policies) :]:
        axis.set_visible(False)
    figure.tight_layout()
    figure.savefig(path, dpi=160)
    plt.close(figure)


def plot_queue_replay(replay: pd.DataFrame, path: Path) -> None:
    latest_state = replay["state_date"].iloc[-1]
    latest = replay.loc[replay["state_date"].eq(latest_state)]
    policies = latest["policy"].drop_duplicates().tolist()
    ordering_policy = "tier_p50_631" if "tier_p50_631" in policies else policies[0]
    ordering = latest.loc[latest["policy"].eq(ordering_policy)].copy()
    ordering["tier_order"] = ordering["p50_tier"].map({"weak": 0, "middle": 1, "strong": 2})
    note_order = ordering.sort_values(["tier_order", "mean_draw_share"], ascending=[True, False])[
        "target_note_id"
    ].tolist()
    row_count = math.ceil(len(policies) / 2)
    figure, axes = plt.subplots(row_count, 2, figsize=(12, row_count * 3.3), sharex=True, sharey=True)
    for axis, policy in zip(axes.flat, policies, strict=False):
        policy_rows = latest.loc[latest["policy"].eq(policy)].set_index("target_note_id").loc[note_order]
        axis.bar(policy_rows.index, policy_rows["mean_draw_share"] * 100)
        axis.set_title(policy)
        axis.tick_params(axis="x", rotation=45)
        axis.set_ylabel("Mean draw share (%)")
    for axis in axes.flat[len(policies) :]:
        axis.set_visible(False)
    figure.suptitle(f"300-draw queue replay at {latest_state}")
    figure.tight_layout()
    figure.savefig(path, dpi=160)
    plt.close(figure)
