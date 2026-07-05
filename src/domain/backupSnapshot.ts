import { localDateKey } from "./stats";
import type { AppSettings, BackupDayFile, BackupSnapshot, PracticeSessionRecord, ReviewRecord } from "./types";

function latestReview(reviews: ReviewRecord[]): ReviewRecord | undefined {
  return [...reviews].sort((a, b) => b.endedAt.localeCompare(a.endedAt))[0];
}

export function buildBackupSnapshot(
  settings: AppSettings,
  sessions: PracticeSessionRecord[],
  reviews: ReviewRecord[],
  backupAt = new Date().toISOString(),
): BackupSnapshot {
  const days: Record<string, BackupDayFile> = {};
  const sessionsByDate = new Map<string, PracticeSessionRecord[]>();
  const reviewsByDate = new Map<string, ReviewRecord[]>();

  for (const session of sessions) {
    const date = localDateKey(session.startedAt);
    sessionsByDate.set(date, [...(sessionsByDate.get(date) ?? []), session]);
  }

  for (const review of reviews) {
    const date = localDateKey(review.startedAt);
    reviewsByDate.set(date, [...(reviewsByDate.get(date) ?? []), review]);
  }

  const dates = new Set([...sessionsByDate.keys(), ...reviewsByDate.keys()]);
  for (const date of dates) {
    days[date] = {
      schemaVersion: 1,
      date,
      sessions: sessionsByDate.get(date) ?? [],
      reviews: reviewsByDate.get(date) ?? [],
    };
  }

  return {
    manifest: {
      schemaVersion: 1,
      dataSetId: settings.dataSetId,
      createdAt: settings.createdAt,
      firstReviewAt: settings.firstReviewAt,
      settings,
      lastBackupAt: backupAt,
      lastReviewId: latestReview(reviews)?.id,
      dates: [...dates].sort((a, b) => a.localeCompare(b)),
    },
    days,
  };
}
