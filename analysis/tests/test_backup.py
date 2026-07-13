import json
from pathlib import Path

import pytest

from anki_note_analysis.backup import load_backup, prepare_output_dir


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


def test_output_cannot_be_inside_backup(tmp_path: Path) -> None:
    backup = tmp_path / "backup"
    _write_minimal_backup(backup)

    with pytest.raises(ValueError, match="separate"):
        prepare_output_dir(backup, backup / "output")
