import pandas as pd
import pytest
from pandas.testing import assert_frame_equal

import anki_note_analysis.backtest as backtest
from anki_note_analysis.backtest import (
    historical_queue_replay,
    observed_unseen_gaps,
    queue_replay_at_state,
    simulate_queue,
)
from anki_note_analysis.policies import CurrentWeightParameters


def _performance() -> pd.DataFrame:
    return pd.DataFrame(
        {
            "target_note_id": ["C4", "D4", "E4", "F4", "G4", "A4"],
            "exposure": [10, 10, 10, 10, 10, 10],
            "recent_p50_ms": [700, 800, 900, 1000, 1100, 1200],
            "recent_p90_ms": [1000, 1100, 1200, 1300, 1400, 1500],
            "error_rate": [0.0, 0.0, 0.0, 0.1, 0.1, 0.2],
        }
    ).set_index("target_note_id")


def _historical_reviews() -> tuple[pd.DataFrame, list[str], list[str]]:
    note_ids = _performance().index.tolist()
    days = [f"2026-07-{day:02d}" for day in range(1, 5)]
    rows = [
        {
            "id": f"{day}-{note_id}-{index}",
            "targetNoteId": note_id,
            "started_at": pd.Timestamp(day, tz="UTC") + pd.Timedelta(minutes=index),
            "local_date": day,
            "activeMs": 700 + note_index * 100,
            "wrong_count": int(note_index == 0 and index == 0),
            "session_targetNoteSetKey": "|".join(note_ids),
        }
        for day in days
        for note_index, note_id in enumerate(note_ids)
        for index in range(3)
    ]
    return pd.DataFrame(rows), note_ids, days


def test_simulation_updates_exposure_and_balances_coverage_draws() -> None:
    performance = _performance()
    counts, gaps = simulate_queue(
        performance,
        "adaptive_current",
        p50_scores=performance["recent_p50_ms"],
        p90_scores=performance["recent_p90_ms"],
        draw_count=60,
        seed=7,
        parameters=CurrentWeightParameters(new_card_rate=1),
    )

    assert counts.sum() == 60
    assert counts.max() - counts.min() <= 1
    assert gaps.ge(0).all()


def test_queue_replay_reports_one_row_per_policy_and_note() -> None:
    performance = _performance()
    history_rows = []
    recent_rows = []
    for note_id, row in performance.iterrows():
        for index in range(int(row["exposure"])):
            review = {
                "id": f"{note_id}-{index}",
                "targetNoteId": note_id,
                "started_at": f"2026-07-01T00:00:{index:02d}Z",
                "activeMs": row["recent_p50_ms"],
                "wrong_count": int(row["error_rate"] > 0 and index == 0),
            }
            history_rows.append(review)
            recent_rows.append(review)

    by_note, summary = queue_replay_at_state(
        pd.DataFrame(history_rows),
        pd.DataFrame(recent_rows),
        performance.index,
        state_date="test",
        draw_count=30,
        repetitions=4,
        policies=("adaptive_current", "tier_p50_631"),
    )

    assert len(by_note) == 2 * len(performance)
    assert len(summary) == 2
    assert by_note.groupby("policy")["mean_draw_count"].sum().eq(30).all()


def test_queue_replay_uses_all_policies_by_default() -> None:
    performance = _performance()
    reviews = pd.DataFrame(
        [
            {
                "id": note_id,
                "targetNoteId": note_id,
                "started_at": "2026-07-01T00:00:00Z",
                "activeMs": row["recent_p50_ms"],
                "wrong_count": 0,
            }
            for note_id, row in performance.iterrows()
        ]
    )

    _, summary = queue_replay_at_state(
        reviews,
        reviews,
        performance.index,
        state_date="test",
        draw_count=2,
        repetitions=1,
    )

    assert summary["policy"].tolist() == list(backtest.POLICY_NAMES)


def test_bootstrap_channel_stops_after_each_note_has_five_exposures() -> None:
    performance = _performance()
    p50_scores = performance["recent_p50_ms"]
    weak_ids = p50_scores.nlargest(2).index

    counts, _ = simulate_queue(
        performance,
        "tier_p50_631_bootstrap",
        p50_scores=p50_scores,
        p90_scores=performance["recent_p90_ms"],
        draw_count=6000,
        seed=11,
    )

    assert counts.loc[weak_ids].sum() / counts.sum() == pytest.approx(0.6, abs=0.03)


def test_all_new_notes_are_balanced_before_tiering() -> None:
    performance = _performance()
    performance[["exposure", "error_rate"]] = 0
    performance[["recent_p50_ms", "recent_p90_ms"]] = float("nan")

    counts, _ = simulate_queue(
        performance,
        "tier_p50_532_bootstrap",
        p50_scores=pd.Series(float("inf"), index=performance.index),
        p90_scores=pd.Series(float("inf"), index=performance.index),
        draw_count=30,
        seed=13,
        parameters=CurrentWeightParameters(new_card_rate=0.1),
    )

    assert counts.eq(5).all()


def test_adaptive_v2_balances_all_new_notes_before_tiering() -> None:
    performance = _performance()
    performance[["exposure", "error_rate"]] = 0
    performance[["recent_p50_ms", "recent_p90_ms"]] = float("nan")

    counts, _ = simulate_queue(
        performance,
        "adaptive_v2",
        p50_scores=pd.Series(float("inf"), index=performance.index),
        p90_scores=pd.Series(float("inf"), index=performance.index),
        draw_count=30,
        seed=29,
    )

    assert counts.eq(5).all()


def test_new_note_is_not_also_drawn_from_a_performance_tier() -> None:
    performance = _performance()
    performance.loc["C4", "exposure"] = 0

    counts, _ = simulate_queue(
        performance,
        "tier_p50_532_bootstrap",
        p50_scores=performance["recent_p50_ms"].fillna(float("inf")),
        p90_scores=performance["recent_p90_ms"].fillna(float("inf")),
        draw_count=100,
        seed=15,
        parameters=CurrentWeightParameters(new_card_rate=0),
    )

    assert counts.loc["C4"] == 0


def test_maintenance_gap_limits_long_absences() -> None:
    performance = _performance()

    _, gaps = simulate_queue(
        performance,
        "tier_p50_532_bootstrap",
        p50_scores=performance["recent_p50_ms"],
        p90_scores=performance["recent_p90_ms"],
        draw_count=300,
        seed=17,
        maintenance_gap=40,
    )

    assert gaps.max() <= 45


def test_maintenance_gap_uses_history_before_the_replay() -> None:
    performance = _performance()
    initial_gaps = pd.Series(0, index=performance.index)
    initial_gaps.loc["C4"] = 100

    counts, _ = simulate_queue(
        performance,
        "tier_p50_532_bootstrap",
        p50_scores=performance["recent_p50_ms"],
        p90_scores=performance["recent_p90_ms"],
        draw_count=1,
        seed=23,
        maintenance_gap=40,
        initial_unseen_counts=initial_gaps,
    )

    assert counts.loc["C4"] == 1


def test_observed_gaps_count_each_notes_eligible_opportunities() -> None:
    reviews = pd.DataFrame(
        [
            {"targetNoteId": "C4", "started_at": "2026-07-01T00:00:01Z", "session_targetNoteSetKey": "C4|D4"},
            {"targetNoteId": "D4", "started_at": "2026-07-01T00:00:02Z", "session_targetNoteSetKey": "C4|D4"},
            {"targetNoteId": "E4", "started_at": "2026-07-01T00:00:03Z", "session_targetNoteSetKey": "D4|E4"},
            {"targetNoteId": "F4", "started_at": "2026-07-01T00:00:04Z", "session_targetNoteSetKey": "C4|D4|F4"},
            {"targetNoteId": "C4", "started_at": "2026-07-01T00:00:05Z", "session_targetNoteSetKey": None},
        ]
    )

    gaps = observed_unseen_gaps(reviews, ["C4", "D4", "E4"]).set_index("target_note_id")

    assert gaps["current_unseen_gap"].to_dict() == {"C4": 2, "D4": 2, "E4": 0}
    assert gaps["historical_max_unseen_gap"].to_dict() == {"C4": 2, "D4": 2, "E4": 0}


def test_adaptive_v2_replay_inherits_the_observed_maintenance_gap() -> None:
    started_at = pd.Timestamp("2026-07-01T00:00:00Z")
    history = pd.DataFrame(
        [
            {
                "id": f"C4-{index}",
                "targetNoteId": "C4",
                "started_at": started_at + pd.Timedelta(seconds=index),
                "activeMs": 500,
                "wrong_count": 0,
                "session_targetNoteSetKey": "C4|D4",
            }
            for index in range(5)
        ]
        + [
            {
                "id": f"D4-{index}",
                "targetNoteId": "D4",
                "started_at": started_at + pd.Timedelta(seconds=index + 5),
                "activeMs": 5000,
                "wrong_count": 0,
                "session_targetNoteSetKey": "C4|D4",
            }
            for index in range(100)
        ]
    )

    by_note, _ = queue_replay_at_state(
        history,
        history,
        ["C4", "D4"],
        state_date="test",
        draw_count=1,
        repetitions=3,
        policies=("adaptive_v2",),
    )

    assert by_note.set_index("target_note_id").loc["C4", "mean_draw_count"] == 1


def test_adaptive_v2_applies_the_90_question_guard_by_default() -> None:
    performance = _performance()

    _, gaps = simulate_queue(
        performance,
        "adaptive_v2",
        p50_scores=performance["recent_p50_ms"],
        p90_scores=performance["recent_p90_ms"],
        draw_count=1000,
        seed=31,
    )

    assert gaps.max() <= 90


def test_adaptive_v2_maintenance_guard_excludes_new_notes() -> None:
    performance = _performance().iloc[:2].copy()
    performance.loc["C4", "exposure"] = 0
    initial_gaps = pd.Series({"C4": 100, "D4": 90})

    counts, _ = simulate_queue(
        performance,
        "adaptive_v2",
        p50_scores=performance["recent_p50_ms"],
        p90_scores=performance["recent_p90_ms"],
        draw_count=1,
        seed=41,
        initial_unseen_counts=initial_gaps,
    )

    assert counts.to_dict() == {"C4": 0, "D4": 1}


def test_adaptive_v2_uses_the_supplied_100_review_p50_window() -> None:
    performance = _performance().iloc[:3].copy()
    performance["recent_p50_ms"] = [700, 3000, 3000]
    p50_scores = pd.Series([4000, 1000, 1000], index=performance.index)

    counts, _ = simulate_queue(
        performance,
        "adaptive_v2",
        p50_scores=p50_scores,
        p90_scores=performance["recent_p90_ms"],
        draw_count=600,
        seed=37,
    )

    assert counts.iloc[0] > counts.iloc[1]
    assert counts.iloc[0] > counts.iloc[2]


def test_historical_replay_parallel_matches_serial() -> None:
    history, note_ids, days = _historical_reviews()

    serial = historical_queue_replay(history, note_ids, days, draw_count=20, repetitions=3, jobs=1)
    parallel = historical_queue_replay(history, note_ids, days, draw_count=20, repetitions=3, jobs=2)

    for serial_frame, parallel_frame in zip(serial, parallel, strict=True):
        assert_frame_equal(serial_frame, parallel_frame)


def test_historical_replay_can_limit_policies_without_changing_production_result() -> None:
    history, note_ids, days = _historical_reviews()

    full = historical_queue_replay(history, note_ids, days, draw_count=20, repetitions=3, jobs=1)
    production = historical_queue_replay(
        history,
        note_ids,
        days,
        draw_count=20,
        repetitions=3,
        jobs=1,
        policies=("adaptive_v2",),
    )

    for full_frame, production_frame in zip(full, production, strict=True):
        expected = full_frame.loc[full_frame["policy"].eq("adaptive_v2")].reset_index(drop=True)
        assert_frame_equal(expected, production_frame)


def test_candidate_snapshot_only_computes_requested_policies(monkeypatch) -> None:
    history, note_ids, _ = _historical_reviews()

    def unexpected_candidate(*_args, **_kwargs):
        raise AssertionError("unrequested candidate policy was computed")

    monkeypatch.setattr(backtest, "adaptive_distribution", unexpected_candidate)
    monkeypatch.setattr(backtest, "focused_distribution", unexpected_candidate)
    monkeypatch.setattr(backtest, "tier_distribution", unexpected_candidate)

    allocation, summary = backtest.candidate_policy_distributions(
        history,
        history,
        note_ids,
        policies=("adaptive_v2",),
    )

    assert "adaptive_v2" in allocation
    assert summary["policy"].tolist() == ["adaptive_v2"]


def test_historical_replay_cache_hits_and_invalidates(tmp_path, monkeypatch) -> None:
    history, note_ids, days = _historical_reviews()
    cache_dir = tmp_path / "output" / "cache"
    arguments = {
        "draw_count": 20,
        "repetitions": 2,
        "jobs": 1,
        "cache_dir": cache_dir,
        "cache_input_fingerprint": "backup-a",
    }
    first = historical_queue_replay(history, note_ids, days, **arguments)
    cache_files = sorted(cache_dir.glob("*.npz"))
    assert len(cache_files) == 3 * len(backtest.POLICY_NAMES)

    original = backtest._run_replay_job
    calls = []

    def tracking_run(job):
        calls.append(job)
        return original(job)

    monkeypatch.setattr(backtest, "_run_replay_job", tracking_run)
    cached = historical_queue_replay(history, note_ids, days, **arguments)
    assert not calls
    for first_frame, cached_frame in zip(first, cached, strict=True):
        assert_frame_equal(first_frame, cached_frame)

    historical_queue_replay(history, note_ids, days, **{**arguments, "cache_input_fingerprint": "backup-b"})
    assert calls
    calls.clear()

    monkeypatch.setattr(backtest, "_replay_algorithm_fingerprint", lambda: "changed-algorithm")
    historical_queue_replay(history, note_ids, days, **arguments)
    assert calls
    calls.clear()

    historical_queue_replay(history, note_ids, days, **{**arguments, "draw_count": 21})
    assert calls
    calls.clear()

    monkeypatch.setattr(backtest.pd, "__version__", "changed-pandas")
    historical_queue_replay(history, note_ids, days, **arguments)
    assert calls
