import json
from pathlib import Path

import pandas as pd
import pytest

from anki_note_analysis.backup import (
    BackupSnapshot,
    backup_content_fingerprint,
    load_backup,
    prepare_output_dir,
    qualified_reviews,
)


def _write_minimal_backup(path: Path) -> None:
    (path / "days").mkdir(parents=True)
    (path / "manifest.json").write_text(json.dumps({"dates": ["2026-07-13"]}), encoding="utf-8")
    (path / "days" / "2026-07-13.json").write_text(
        json.dumps({"date": "2026-07-13", "sessions": [], "reviews": [], "staffRecallRuns": []}),
        encoding="utf-8",
    )


def test_load_backup_is_read_only(tmp_path: Path) -> None:
    backup = tmp_path / "backup"
    _write_minimal_backup(backup)
    before = {path: path.read_bytes() for path in backup.rglob("*") if path.is_file()}

    snapshot = load_backup(backup)

    assert snapshot.reviews.empty
    assert {path: path.read_bytes() for path in backup.rglob("*") if path.is_file()} == before

    first_fingerprint = backup_content_fingerprint(snapshot)
    assert first_fingerprint == backup_content_fingerprint(snapshot)
    assert {path: path.read_bytes() for path in backup.rglob("*") if path.is_file()} == before


def test_output_cannot_be_inside_backup(tmp_path: Path) -> None:
    backup = tmp_path / "backup"
    _write_minimal_backup(backup)

    with pytest.raises(ValueError, match="separate"):
        prepare_output_dir(backup, backup / "output")


def test_scheduler_history_applies_the_complete_long_term_session_filter(tmp_path: Path) -> None:
    sessions = pd.DataFrame([{"id": session_id} for session_id in ("eligible", "too-many-errors", "too-many-heavy")])
    reviews = []
    for session_id in sessions["id"]:
        for index in range(5):
            wrong_answers = []
            if session_id == "too-many-errors" and index < 4:
                wrong_answers = ["D4"]
            if session_id == "too-many-heavy" and index < 3:
                wrong_answers = ["D4", "E4", "F4"]
            reviews.append(
                {
                    "activeMs": 1000,
                    "answeredCorrectly": True,
                    "endedAt": f"2026-07-13T00:00:{index:02d}Z",
                    "id": f"{session_id}-{index}",
                    "ignored": False,
                    "interrupted": False,
                    "sessionId": session_id,
                    "startedAt": f"2026-07-13T00:00:{index:02d}Z",
                    "targetNoteId": "C4",
                    "wrongAnswers": wrong_answers,
                }
            )
    snapshot = BackupSnapshot(
        backup_dir=tmp_path,
        manifest={},
        reviews=pd.DataFrame(reviews),
        sessions=sessions,
        staff_recall_runs=pd.DataFrame(),
    )

    scheduler_history = qualified_reviews(snapshot, scheduler_history_only=True)

    assert scheduler_history["sessionId"].unique().tolist() == ["eligible"]
