import { ALL_NOTES } from "./notes";
import type { NoteName, PracticeGroupId, ReviewRecord, TargetNoteId } from "./types";

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
  medianMs?: number;
  p90Ms?: number;
  errorRate: number;
  commonConfusion?: NoteName;
  weaknessScore: number;
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
    const medianMs = percentile(times, 0.5);
    const p90Ms = percentile(times, 0.9);
    const errorRate = noteReviews.length === 0 ? 0 : reviewsWithErrors / noteReviews.length;
    const speedScore = medianMs === undefined ? 2 : medianMs / 1000;
    return {
      targetNoteId: note.id,
      groupId: note.groupId,
      reviewCount: noteReviews.length,
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
