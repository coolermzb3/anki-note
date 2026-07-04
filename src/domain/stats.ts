import { ALL_NOTES } from "./notes";
import type { NoteName, PracticeGroupId, PracticeSessionRecord, ReviewRecord, TargetNoteId } from "./types";

export interface DailyStat {
  date: string;
  completedReviews: number;
  p10Ms?: number;
  medianMs?: number;
  p90Ms?: number;
  heatLevel: 0 | 1 | 2;
}

export interface NoteStat {
  targetNoteId: TargetNoteId;
  groupId: PracticeGroupId;
  reviewCount: number;
  errorCount: number;
  medianMs?: number;
  p90Ms?: number;
  errorRate: number;
  commonConfusion?: NoteName;
  weaknessScore: number;
}

export interface PracticeSessionStat {
  sessionId: string;
  startedAt: string;
  endedAt?: string;
  completedReviews: number;
  p10Ms?: number;
  medianMs?: number;
  p90Ms?: number;
}

export function isQualifiedReview(review: ReviewRecord, includeInterrupted = false): boolean {
  return review.answeredCorrectly && (includeInterrupted || !review.interrupted);
}

export function percentile(values: number[], percent: number): number | undefined {
  if (values.length === 0) {
    return undefined;
  }
  const sorted = [...values].sort((a, b) => a - b);
  const index = (sorted.length - 1) * percent;
  const lower = Math.floor(index);
  const upper = Math.ceil(index);
  if (lower === upper) {
    return sorted[lower];
  }
  return sorted[lower] + (sorted[upper] - sorted[lower]) * (index - lower);
}

export function localDateKey(iso: string): string {
  const date = new Date(iso);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function commonConfusion(reviews: ReviewRecord[]): NoteName | undefined {
  const counts = new Map<NoteName, number>();
  for (const review of reviews) {
    for (const wrongAnswer of review.wrongAnswers) {
      counts.set(wrongAnswer.noteName, (counts.get(wrongAnswer.noteName) ?? 0) + 1);
    }
  }
  let best: { noteName: NoteName; count: number } | undefined;
  for (const [noteName, count] of counts) {
    if (!best || count > best.count) {
      best = { noteName, count };
    }
  }
  return best?.noteName;
}

export function buildDailyStats(reviews: ReviewRecord[], includeInterrupted = false): DailyStat[] {
  const byDate = new Map<string, ReviewRecord[]>();
  for (const review of reviews.filter((review) => isQualifiedReview(review, includeInterrupted))) {
    const date = localDateKey(review.answeredAt ?? review.endedAt);
    byDate.set(date, [...(byDate.get(date) ?? []), review]);
  }

  const nonZeroCounts = [...byDate.values()].map((dayReviews) => dayReviews.length);
  const p75 = percentile(nonZeroCounts, 0.75);
  const highThreshold = Math.max(20, Math.ceil(p75 ?? 20));

  return [...byDate.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, dayReviews]) => {
      const times = dayReviews.map((review) => review.activeMs);
      const completedReviews = dayReviews.length;
      return {
        date,
        completedReviews,
        p10Ms: percentile(times, 0.1),
        medianMs: percentile(times, 0.5),
        p90Ms: percentile(times, 0.9),
        heatLevel: completedReviews === 0 ? 0 : completedReviews >= highThreshold ? 2 : 1,
      };
    });
}

function earliestReviewStartedAt(reviews: ReviewRecord[]): string {
  return reviews.reduce(
    (earliest, review) => (new Date(review.startedAt).getTime() < new Date(earliest).getTime() ? review.startedAt : earliest),
    reviews[0].startedAt,
  );
}

function latestReviewEndedAt(reviews: ReviewRecord[]): string {
  return reviews.reduce(
    (latest, review) => (new Date(review.endedAt).getTime() > new Date(latest).getTime() ? review.endedAt : latest),
    reviews[0].endedAt,
  );
}

export function buildPracticeSessionStats(
  reviews: ReviewRecord[],
  sessions: PracticeSessionRecord[] = [],
  includeInterrupted = false,
): PracticeSessionStat[] {
  const sessionsById = new Map(sessions.map((session) => [session.id, session]));
  const reviewsBySession = new Map<string, ReviewRecord[]>();

  for (const review of reviews.filter((review) => isQualifiedReview(review, includeInterrupted))) {
    reviewsBySession.set(review.sessionId, [...(reviewsBySession.get(review.sessionId) ?? []), review]);
  }

  return [...reviewsBySession.entries()]
    .map(([sessionId, sessionReviews]) => {
      const session = sessionsById.get(sessionId);
      const times = sessionReviews.map((review) => review.activeMs);
      return {
        sessionId,
        startedAt: session?.startedAt ?? earliestReviewStartedAt(sessionReviews),
        endedAt: session?.endedAt ?? latestReviewEndedAt(sessionReviews),
        completedReviews: sessionReviews.length,
        p10Ms: percentile(times, 0.1),
        medianMs: percentile(times, 0.5),
        p90Ms: percentile(times, 0.9),
      };
    })
    .sort((a, b) => new Date(a.startedAt).getTime() - new Date(b.startedAt).getTime() || a.sessionId.localeCompare(b.sessionId));
}

export function buildNoteStats(
  reviews: ReviewRecord[],
  groupFilter?: PracticeGroupId[],
  includeInterrupted = false,
): NoteStat[] {
  const allowedGroups = groupFilter && groupFilter.length > 0 ? new Set(groupFilter) : undefined;
  return ALL_NOTES.filter((note) => !allowedGroups || allowedGroups.has(note.groupId)).map((note) => {
    const noteReviews = reviews.filter((review) => review.targetNoteId === note.id && isQualifiedReview(review, includeInterrupted));
    const times = noteReviews.map((review) => review.activeMs);
    const reviewsWithErrors = noteReviews.filter((review) => review.wrongAnswers.length > 0).length;
    const errorCount = noteReviews.reduce((count, review) => count + review.wrongAnswers.length, 0);
    const medianMs = percentile(times, 0.5);
    const p90Ms = percentile(times, 0.9);
    const errorRate = noteReviews.length === 0 ? 0 : reviewsWithErrors / noteReviews.length;
    const speedScore = medianMs === undefined ? 2 : medianMs / 1000;
    return {
      targetNoteId: note.id,
      groupId: note.groupId,
      reviewCount: noteReviews.length,
      errorCount,
      medianMs,
      p90Ms,
      errorRate,
      commonConfusion: commonConfusion(noteReviews),
      weaknessScore: speedScore + errorRate * 3 + (noteReviews.length === 0 ? 2 : 0),
    };
  });
}

export function formatMs(ms?: number): string {
  if (ms === undefined) {
    return "-";
  }
  if (ms < 1000) {
    return `${Math.round(ms)}ms`;
  }
  return `${(ms / 1000).toFixed(1)}s`;
}
