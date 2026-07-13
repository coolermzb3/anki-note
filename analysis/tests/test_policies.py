import json
from pathlib import Path

import pandas as pd
import pytest

from anki_note_analysis.policies import (
    CurrentWeightParameters,
    adaptive_distribution,
    adaptive_v2_scores,
    adaptive_v2_tier_weights,
    current_weights,
    focused_note_ids,
    tier_distribution,
)


def test_adaptive_v2_golden_tier_fixtures() -> None:
    fixture_path = Path(__file__).parents[1] / "fixtures" / "adaptive_v2_tiers.json"
    for case in json.loads(fixture_path.read_text(encoding="utf-8")):
        performance = pd.DataFrame(
            {
                "target_note_id": [note["id"] for note in case["notes"]],
                "exposure": [note["count"] for note in case["notes"]],
                "recent_p50_ms": [note["medianMs"] for note in case["notes"]],
            }
        ).set_index("target_note_id")

        scores = adaptive_v2_scores(performance)
        weights = adaptive_v2_tier_weights(scores)

        assert scores.to_dict() == case["adjustedMedianMs"]
        assert weights.to_dict() == case["weights"]


def _performance() -> pd.DataFrame:
    return pd.DataFrame(
        {
            "target_note_id": ["C4", "D4", "E4", "F4", "G4", "A4"],
            "exposure": [0, 1, 5, 5, 5, 5],
            "recent_p50_ms": [None, 2400, 4400, 1400, 900, 800],
            "recent_p90_ms": [None, 3000, 5000, 1800, 1200, 1000],
            "error_rate": [0, 0.5, 1, 0, 0, 0],
        }
    ).set_index("target_note_id")


def test_current_weight_formula_matches_scheduler_constants() -> None:
    weights = current_weights(_performance(), CurrentWeightParameters())

    assert weights["C4"] == pytest.approx(3)
    assert weights["D4"] == pytest.approx(5.1)
    assert weights["E4"] == pytest.approx(7)
    assert weights["F4"] == pytest.approx(1)


def test_focused_pool_keeps_the_weak_half_with_at_least_three_notes() -> None:
    performance = _performance()
    weights = current_weights(performance)

    assert focused_note_ids(performance, weights) == ["E4", "D4", "C4"]


def test_policy_distributions_sum_to_one() -> None:
    performance = _performance()

    assert adaptive_distribution(performance).sum() == pytest.approx(1)
    assert tier_distribution(performance, performance["recent_p50_ms"]).sum() == pytest.approx(1)
