from __future__ import annotations

import json
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import pandas as pd

LOCAL_TIMEZONE = "Asia/Shanghai"
MIN_SESSION_STAT_REVIEWS = 5


@dataclass(frozen=True)
class BackupSnapshot:
    backup_dir: Path
    manifest: dict[str, Any]
    sessions: pd.DataFrame
    reviews: pd.DataFrame
    staff_recall_runs: pd.DataFrame


def _read_json(path: Path) -> dict[str, Any]:
    with path.open("r", encoding="utf-8") as handle:
        value = json.load(handle)
    if not isinstance(value, dict):
        raise ValueError(f"Expected a JSON object in {path}")
    return value


def _records_frame(records: list[dict[str, Any]]) -> pd.DataFrame:
    return pd.DataFrame.from_records(records) if records else pd.DataFrame()


def _validate_unique_ids(frame: pd.DataFrame, label: str) -> None:
    if frame.empty or "id" not in frame:
        return
    duplicates = frame.loc[frame["id"].duplicated(), "id"].astype(str).tolist()
    if duplicates:
        raise ValueError(f"Duplicate {label} ids in backup: {duplicates[:3]}")


def load_backup(backup_dir: Path) -> BackupSnapshot:
    backup_dir = backup_dir.resolve(strict=True)
    manifest = _read_json(backup_dir / "manifest.json")
    dates = manifest.get("dates")
    if not isinstance(dates, list) or not all(isinstance(date, str) for date in dates):
        raise ValueError("Backup manifest dates must be a list of strings")

    sessions: list[dict[str, Any]] = []
    reviews: list[dict[str, Any]] = []
    staff_recall_runs: list[dict[str, Any]] = []
    for date in dates:
        day = _read_json(backup_dir / "days" / f"{date}.json")
        if day.get("date") != date:
            raise ValueError(f"Backup day mismatch for {date}")
        sessions.extend(day.get("sessions", []))
        reviews.extend(day.get("reviews", []))
        staff_recall_runs.extend(day.get("staffRecallRuns", []))

    sessions_frame = _records_frame(sessions)
    reviews_frame = _records_frame(reviews)
    staff_recall_frame = _records_frame(staff_recall_runs)
    _validate_unique_ids(sessions_frame, "session")
    _validate_unique_ids(reviews_frame, "review")
    _validate_unique_ids(staff_recall_frame, "staff-recall run")
    return BackupSnapshot(
        backup_dir=backup_dir,
        manifest=manifest,
        sessions=sessions_frame,
        reviews=reviews_frame,
        staff_recall_runs=staff_recall_frame,
    )


def prepare_output_dir(backup_dir: Path, output_dir: Path) -> Path:
    backup_dir = backup_dir.resolve(strict=True)
    output_dir = output_dir.resolve()
    if output_dir == backup_dir or output_dir.is_relative_to(backup_dir) or backup_dir.is_relative_to(output_dir):
        raise ValueError("Output directory must be separate from the backup input")
    output_dir.mkdir(parents=True, exist_ok=True)
    return output_dir


def _resolved_strategy(row: pd.Series) -> str:
    strategy = row.get("queueStrategy")
    if isinstance(strategy, str) and strategy:
        return strategy
    focused_training = row.get("focusedTraining", False)
    return "focused" if pd.notna(focused_training) and bool(focused_training) else "adaptive"


def enriched_reviews(snapshot: BackupSnapshot) -> pd.DataFrame:
    reviews = snapshot.reviews.copy()
    if reviews.empty:
        return reviews

    reviews["started_at"] = pd.to_datetime(reviews["startedAt"], utc=True)
    completed_at = reviews["startedAt"].copy()
    for column in ("endedAt", "answeredAt"):
        if column in reviews:
            completed_at = reviews[column].combine_first(completed_at)
    reviews["completed_at"] = pd.to_datetime(completed_at, utc=True)
    reviews["local_date"] = reviews["completed_at"].dt.tz_convert(LOCAL_TIMEZONE).dt.date.astype(str)
    reviews["wrong_count"] = reviews["wrongAnswers"].map(lambda value: len(value) if isinstance(value, list) else 0)
    ignored = reviews["ignored"] if "ignored" in reviews else pd.Series(False, index=reviews.index)
    reviews["ignored"] = ignored.fillna(False).astype(bool)
    reviews["qualified"] = (
        reviews["answeredCorrectly"].fillna(False).astype(bool)
        & ~reviews["interrupted"].fillna(False).astype(bool)
        & ~reviews["ignored"]
    )

    sessions = snapshot.sessions.copy()
    if sessions.empty:
        reviews["resolved_strategy"] = "unknown"
        return reviews
    sessions["resolved_strategy"] = sessions.apply(_resolved_strategy, axis=1)
    session_fields = [
        "id",
        "resolved_strategy",
        "schemaVersion",
        "promptDisplayMode",
        "staffNotationMode",
        "promptNoteDuration",
        "targetNoteSetKey",
    ]
    available = [field for field in session_fields if field in sessions]
    session_data = sessions[available].rename(
        columns={field: f"session_{field}" for field in available if field != "id"}
    )
    return reviews.merge(session_data, how="left", left_on="sessionId", right_on="id", suffixes=("", "_session")).drop(
        columns=["id_session"], errors="ignore"
    )


def qualified_reviews(snapshot: BackupSnapshot, *, scheduler_history_only: bool = False) -> pd.DataFrame:
    reviews = enriched_reviews(snapshot)
    qualified = reviews.loc[reviews["qualified"]].copy()
    if not scheduler_history_only or qualified.empty:
        return qualified
    eligible_session_ids = (
        qualified.groupby("sessionId").size().loc[lambda counts: counts >= MIN_SESSION_STAT_REVIEWS].index
    )
    return qualified.loc[qualified["sessionId"].isin(eligible_session_ids)].copy()


def latest_target_note_ids(snapshot: BackupSnapshot) -> list[str]:
    sessions = snapshot.sessions.copy()
    if sessions.empty or "targetNoteSetKey" not in sessions:
        return sorted(snapshot.reviews["targetNoteId"].dropna().astype(str).unique().tolist())
    sessions["started_at"] = pd.to_datetime(sessions["startedAt"], utc=True)
    with_key = sessions.loc[sessions["targetNoteSetKey"].fillna("").astype(str).ne("")].sort_values("started_at")
    if with_key.empty:
        return sorted(snapshot.reviews["targetNoteId"].dropna().astype(str).unique().tolist())
    return str(with_key.iloc[-1]["targetNoteSetKey"]).split("|")
