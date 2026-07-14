from __future__ import annotations

import argparse
import os
from concurrent.futures import ProcessPoolExecutor
from pathlib import Path

from .backtest import (
    candidate_policy_distributions,
    cold_start_sensitivity,
    cross_day_policy_alignment,
    historical_queue_replay,
    hyperparameter_sensitivity,
    maintenance_gap_sensitivity,
    observed_strategy_distribution,
    observed_unseen_gaps,
)
from .backup import (
    backup_content_fingerprint,
    latest_target_note_ids,
    load_backup,
    prepare_output_dir,
    qualified_reviews,
)
from .metrics import (
    analyze_metric_windows,
    cross_day_metric_alignment,
    daily_speed_metrics,
    error_signal_summary,
    medium_or_higher_active_days,
    note_metrics,
    recent_active_window,
    recent_per_note_window,
    rolling_equal_note_metrics,
)
from .reporting import plot_daily_speed, plot_policy_allocations, plot_queue_replay, plot_recent_notes, write_json


FULL_ONLY_OUTPUTS = (
    "recent_metric_stability.csv",
    "metric_window_comparison.csv",
    "metric_future_alignment.csv",
    "policy_future_alignment.csv",
    "hyperparameter_sensitivity.csv",
    "maintenance_gap_sensitivity.csv",
    "cold_start_sensitivity.csv",
)


def _default_paths() -> tuple[Path, Path]:
    repository = Path(__file__).resolve().parents[3]
    return repository / "backup", repository / "analysis" / "output"


def parse_args() -> argparse.Namespace:
    backup_default, output_default = _default_paths()
    parser = argparse.ArgumentParser(description="Read-only analysis of anki-note backup data")
    parser.add_argument("--backup-dir", type=Path, default=backup_default)
    parser.add_argument("--output-dir", type=Path, default=output_default)
    parser.add_argument("--bootstrap-iterations", type=int, default=500)
    parser.add_argument("--replay-draw-count", type=int, default=300)
    parser.add_argument("--replay-repetitions", type=int, default=50)
    parser.add_argument("--jobs", type=int, default=0, help="history replay workers; 0 uses up to 8 CPUs, 1 is serial")
    parser.add_argument(
        "--full",
        action="store_true",
        help="run bootstrap, candidate-policy comparisons, and sensitivity experiments",
    )
    return parser.parse_args()


def run(
    backup_dir: Path,
    output_dir: Path,
    bootstrap_iterations: int,
    replay_draw_count: int = 300,
    replay_repetitions: int = 50,
    jobs: int = 0,
    full: bool = False,
) -> dict[str, object]:
    snapshot = load_backup(backup_dir)
    output_dir = prepare_output_dir(snapshot.backup_dir, output_dir)
    if not full:
        for filename in FULL_ONLY_OUTPUTS:
            (output_dir / filename).unlink(missing_ok=True)
    all_qualified = qualified_reviews(snapshot)
    scheduler_history = qualified_reviews(snapshot, scheduler_history_only=True)
    note_ids = latest_target_note_ids(snapshot)
    target_reviews = all_qualified.loc[all_qualified["targetNoteId"].isin(note_ids)]
    target_scheduler_history = scheduler_history.loc[scheduler_history["targetNoteId"].isin(note_ids)]
    active_days, daily_volume = medium_or_higher_active_days(target_scheduler_history, note_ids)
    recent_review_count = 100
    recent = recent_per_note_window(target_scheduler_history, note_ids, recent_review_count)
    recent_metrics = note_metrics(recent, note_ids)
    daily_speed = daily_speed_metrics(target_scheduler_history, note_ids).merge(
        daily_volume.reset_index()[["local_date", "heat_level", "medium_or_higher"]],
        how="left",
        on="local_date",
    )
    learning_progress = rolling_equal_note_metrics(
        target_scheduler_history,
        note_ids,
        review_window=recent_review_count,
    )
    allocation, policy_summary = candidate_policy_distributions(
        target_scheduler_history,
        recent,
        note_ids,
        policies=None if full else ("adaptive_v2",),
    )
    replay_by_note, replay_summary = historical_queue_replay(
        target_scheduler_history,
        note_ids,
        active_days,
        draw_count=replay_draw_count,
        repetitions=replay_repetitions,
        review_window=recent_review_count,
        jobs=jobs,
        cache_dir=output_dir / "cache" / "historical_queue_replay",
        cache_input_fingerprint=backup_content_fingerprint(snapshot),
        policies=None if full else ("adaptive_v2",),
    )
    observed_distribution, observed_summary = observed_strategy_distribution(target_reviews, note_ids)
    observed_gaps = observed_unseen_gaps(target_scheduler_history, note_ids)
    error_summary = error_signal_summary(recent, note_ids)

    if full:
        active_day_recent = recent_active_window(target_scheduler_history, note_ids, active_days)
        window_comparison, stability, threshold_summary = analyze_metric_windows(
            target_scheduler_history,
            note_ids,
            active_day_recent,
            iterations=bootstrap_iterations,
        )
        metric_alignment = cross_day_metric_alignment(target_scheduler_history, note_ids, active_days)
        policy_alignment = cross_day_policy_alignment(target_scheduler_history, note_ids, active_days)
        sensitivity_workers = min(3, jobs if jobs > 0 else os.cpu_count() or 1)
        sensitivity_arguments = {
            "hyperparameters": (
                hyperparameter_sensitivity,
                {
                    "draw_count": replay_draw_count,
                    "repetitions": max(20, replay_repetitions // 4),
                },
            ),
            "maintenance_gaps": (
                maintenance_gap_sensitivity,
                {
                    "draw_count": replay_draw_count,
                    "repetitions": max(50, replay_repetitions),
                },
            ),
            "cold_start": (
                cold_start_sensitivity,
                {"repetitions": max(50, replay_repetitions)},
            ),
        }
        if sensitivity_workers == 1:
            sensitivity_results = {
                name: function(target_scheduler_history, recent, note_ids, **arguments)
                for name, (function, arguments) in sensitivity_arguments.items()
            }
        else:
            with ProcessPoolExecutor(max_workers=sensitivity_workers) as executor:
                futures = {
                    name: executor.submit(function, target_scheduler_history, recent, note_ids, **arguments)
                    for name, (function, arguments) in sensitivity_arguments.items()
                }
                sensitivity_results = {name: future.result() for name, future in futures.items()}
        hyperparameters = sensitivity_results["hyperparameters"]
        maintenance_gaps = sensitivity_results["maintenance_gaps"]
        cold_start = sensitivity_results["cold_start"]

    recent_metrics.to_csv(output_dir / "recent_note_metrics.csv", encoding="utf-8-sig")
    daily_volume.to_csv(output_dir / "daily_volume.csv", encoding="utf-8-sig")
    daily_speed.to_csv(output_dir / "daily_speed.csv", index=False, encoding="utf-8-sig")
    learning_progress.to_csv(output_dir / "learning_progress.csv", index=False, encoding="utf-8-sig")
    allocation.to_csv(output_dir / "policy_snapshot_probabilities.csv", index=False, encoding="utf-8-sig")
    policy_summary.to_csv(output_dir / "policy_snapshot_summary.csv", index=False, encoding="utf-8-sig")
    replay_by_note.to_csv(output_dir / "queue_replay_by_note.csv", index=False, encoding="utf-8-sig")
    replay_summary.to_csv(output_dir / "queue_replay_summary.csv", index=False, encoding="utf-8-sig")
    observed_distribution.to_csv(output_dir / "observed_strategy_distribution.csv", index=False, encoding="utf-8-sig")
    observed_summary.to_csv(output_dir / "observed_strategy_summary.csv", index=False, encoding="utf-8-sig")
    observed_gaps.to_csv(output_dir / "observed_unseen_gaps.csv", index=False, encoding="utf-8-sig")
    if full:
        stability.to_csv(output_dir / "recent_metric_stability.csv", encoding="utf-8-sig")
        window_comparison.to_csv(output_dir / "metric_window_comparison.csv", index=False, encoding="utf-8-sig")
        metric_alignment.to_csv(output_dir / "metric_future_alignment.csv", index=False, encoding="utf-8-sig")
        policy_alignment.to_csv(output_dir / "policy_future_alignment.csv", index=False, encoding="utf-8-sig")
        hyperparameters.to_csv(output_dir / "hyperparameter_sensitivity.csv", index=False, encoding="utf-8-sig")
        maintenance_gaps.to_csv(output_dir / "maintenance_gap_sensitivity.csv", index=False, encoding="utf-8-sig")
        cold_start.to_csv(output_dir / "cold_start_sensitivity.csv", index=False, encoding="utf-8-sig")
    plot_daily_speed(daily_speed, output_dir / "daily_speed.png")
    plot_recent_notes(recent_metrics, output_dir / "recent_note_metrics.png")
    plot_policy_allocations(allocation, output_dir / "policy_snapshot_probabilities.png")
    plot_queue_replay(replay_by_note, output_dir / "queue_replay_latest.png")

    latest_state = f"after_{target_scheduler_history['local_date'].max()}"
    latest_replay = replay_summary.loc[replay_summary["state_date"].eq(latest_state)].set_index("policy")

    summary: dict[str, object] = {
        "analysis_mode": "full" if full else "quick",
        "snapshot": {
            "snapshot_id": snapshot.manifest.get("snapshotId"),
            "data_modified_at": snapshot.manifest.get("dataModifiedAt"),
            "session_count": len(snapshot.sessions),
            "review_count": len(snapshot.reviews),
            "qualified_review_count": len(all_qualified),
            "scheduler_history_review_count": len(scheduler_history),
        },
        "scope": {
            "target_note_ids": note_ids,
            "target_note_count": len(note_ids),
            "medium_or_higher_active_days": active_days,
            "recent_metric_window": f"last_{recent_review_count}_reviews_per_note",
            "recent_review_count": len(recent),
        },
        "latest_learning_progress": learning_progress.iloc[-1].to_dict(),
        "latest_queue_replay": latest_replay.to_dict(orient="index"),
        "historical_queue_replay_mean": replay_summary.groupby("policy")
        .mean(numeric_only=True)
        .to_dict(orient="index"),
        "error_signal": error_summary,
        "observed_unseen_gaps": {
            "current_max": int(observed_gaps["current_unseen_gap"].max()),
            "historical_max": int(observed_gaps["historical_max_unseen_gap"].max()),
        },
    }
    if full:
        summary.update(
            {
                "metric_window_comparison": window_comparison.set_index("window").to_dict(orient="index"),
                "thresholds": threshold_summary,
                "metric_future_alignment_mean": metric_alignment.mean(numeric_only=True).to_dict(),
                "policy_future_alignment_mean": policy_alignment.groupby("policy")
                .mean(numeric_only=True)
                .to_dict(orient="index"),
                "maintenance_gap_sensitivity": maintenance_gaps.set_index("maintenance_gap").to_dict(orient="index"),
                "cold_start_sensitivity": cold_start.to_dict(orient="records"),
            }
        )
    write_json(output_dir / "summary.json", summary)
    return summary


def main() -> None:
    args = parse_args()
    summary = run(
        args.backup_dir,
        args.output_dir,
        args.bootstrap_iterations,
        args.replay_draw_count,
        args.replay_repetitions,
        args.jobs,
        args.full,
    )
    print(f"Analyzed {summary['snapshot']['review_count']} reviews; outputs written to {args.output_dir.resolve()}")


if __name__ == "__main__":
    main()
