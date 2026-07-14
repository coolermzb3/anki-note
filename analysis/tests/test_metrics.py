import numpy as np
import pandas as pd

from anki_note_analysis.metrics import (
    _tier_codes_by_row,
    daily_speed_metrics,
    medium_or_higher_active_days,
    recent_per_note_window,
    rolling_equal_note_metrics,
)
from anki_note_analysis.policies import tier_labels


def test_vectorized_tier_codes_match_policy_tiers() -> None:
    values = np.array(
        [
            [900, 700, 500, 300, 100],
            [100, np.nan, 500, 300, 900],
            [400, 400, 400, 400, 400],
        ],
        dtype=float,
    )
    label_codes = {"weak": 0, "middle": 1, "strong": 2}
    expected = np.vstack(
        [tier_labels(pd.Series(row)).map(label_codes).to_numpy(dtype=int) for row in values]
    )

    np.testing.assert_array_equal(_tier_codes_by_row(values), expected)


def test_medium_or_higher_days_match_positive_volume_tertiles() -> None:
    reviews = pd.DataFrame(
        [
            {"id": f"{day}-{review}", "local_date": f"2026-07-{day:02d}", "targetNoteId": "C4"}
            for day in range(1, 7)
            for review in range(day)
        ]
    )

    active_days, daily = medium_or_higher_active_days(reviews, ["C4"])

    assert active_days == ["2026-07-03", "2026-07-04", "2026-07-05", "2026-07-06"]
    assert daily["heat_level"].tolist() == [1, 1, 2, 2, 3, 3]


def test_recent_per_note_window_takes_equal_latest_evidence() -> None:
    reviews = pd.DataFrame(
        [
            {
                "id": f"{note_id}-{index}",
                "targetNoteId": note_id,
                "started_at": pd.Timestamp("2026-07-01", tz="UTC") + pd.Timedelta(minutes=index),
            }
            for note_id, count in (("C4", 5), ("D4", 3))
            for index in range(count)
        ]
    )

    recent = recent_per_note_window(reviews, ["C4", "D4"], 2)

    assert recent.groupby("targetNoteId")["id"].apply(list).to_dict() == {
        "C4": ["C4-3", "C4-4"],
        "D4": ["D4-1", "D4-2"],
    }


def test_daily_macro_metrics_weight_notes_equally() -> None:
    reviews = pd.DataFrame(
        [
            {"id": f"C4-{index}", "local_date": "2026-07-13", "targetNoteId": "C4", "activeMs": 500, "wrong_count": 0}
            for index in range(9)
        ]
        + [
            {
                "id": "D4-0",
                "local_date": "2026-07-13",
                "targetNoteId": "D4",
                "activeMs": 1500,
                "wrong_count": 1,
            }
        ]
    )

    metrics = daily_speed_metrics(reviews, ["C4", "D4"]).iloc[0]

    assert metrics["raw_p50_ms"] == 500
    assert metrics["macro_p50_ms"] == 1000
    assert metrics["macro_error_rate"] == 0.5


def test_rolling_progress_waits_until_every_note_has_enough_evidence() -> None:
    reviews = pd.DataFrame(
        [
            {
                "id": f"C4-{index}",
                "local_date": "2026-07-13",
                "targetNoteId": "C4",
                "started_at": pd.Timestamp("2026-07-13", tz="UTC") + pd.Timedelta(minutes=index),
                "activeMs": 500,
                "wrong_count": 0,
            }
            for index in range(20)
        ]
    )

    progress = rolling_equal_note_metrics(reviews, ["C4", "D4"])

    assert progress.empty
