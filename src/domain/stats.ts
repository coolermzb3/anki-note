import { ALL_NOTES, NOTE_NAMES } from "./notes";
import { isStatisticalReview } from "./reviews";
import adaptiveV2Spec from "./adaptiveV2Spec.json";
import type { NoteName, PracticeGroupId, PracticeSessionRecord, ReviewRecord, TargetNoteId } from "./types";

export interface DailyStat {
  date: string;
  completedReviews: number;
  p10Ms?: number;
  medianMs?: number;
  p90Ms?: number;
  heatLevel: HeatLevel;
}

export interface NoteStat {
  targetNoteId: TargetNoteId;
  groupId: PracticeGroupId;
  reviewCount: number;
  errorCount: number;
  p10Ms?: number;
  medianMs?: number;
  p90Ms?: number;
  errorRate: number;
  commonConfusion?: NoteName;
  commonConfusions: NoteConfusionStat[];
  weaknessScore: number;
}

export interface NoteConfusionStat {
  count: number;
  noteName: NoteName;
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

export type RecognitionTrendGrouping = "day" | "practice-session";

export interface RecognitionTrendPoint {
  boundaryAt: string;
  cohortKey: string;
  coveredNoteCount: number;
  errorRate?: number;
  key: string;
  p10Ms?: number;
  medianMs?: number;
  p90Ms?: number;
  totalNoteCount: number;
}

export const MIN_SESSION_STAT_REVIEWS = 5;
const PERFORMANCE_REVIEW_LIMIT = adaptiveV2Spec.performanceReviewLimit;
export type PositiveHeatLevel = 1 | 2 | 3;
export type HeatLevel = 0 | PositiveHeatLevel;

function groupReviewsBySession(reviews: ReviewRecord[]): Map<string, ReviewRecord[]> {
  const reviewsBySession = new Map<string, ReviewRecord[]>();
  for (const review of reviews) {
    const sessionReviews = reviewsBySession.get(review.sessionId);
    if (sessionReviews) {
      sessionReviews.push(review);
    } else {
      reviewsBySession.set(review.sessionId, [review]);
    }
  }
  return reviewsBySession;
}

export function hasEnoughStatReviews(reviews: ReviewRecord[]): boolean {
  return reviews.filter(isStatisticalReview).length >= MIN_SESSION_STAT_REVIEWS;
}

export function isLongTermStatsEligible(reviews: ReviewRecord[]): boolean {
  return hasEnoughStatReviews(reviews);
}

export function filterLongTermReviews(reviews: ReviewRecord[]): ReviewRecord[] {
  const reviewsBySession = groupReviewsBySession(reviews);
  const eligibleSessionIds = new Set(
    [...reviewsBySession.entries()]
      .filter(([, sessionReviews]) => isLongTermStatsEligible(sessionReviews))
      .map(([sessionId]) => sessionId),
  );
  return reviews.filter((review) => eligibleSessionIds.has(review.sessionId));
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

export interface PositiveTertileThresholds {
  high: number;
  low: number;
}

export function positiveTertileThresholds(positiveValues: number[]): PositiveTertileThresholds | undefined {
  const low = percentile(positiveValues, 1 / 3);
  const high = percentile(positiveValues, 2 / 3);
  return low === undefined || high === undefined ? undefined : { low, high };
}

export function positiveTertileLevel(value: number, positiveValues: number[]): PositiveHeatLevel {
  const thresholds = positiveTertileThresholds(positiveValues);
  if (!thresholds || value <= thresholds.low) {
    return 1;
  }
  return value <= thresholds.high ? 2 : 3;
}

export function localDateKey(iso: string): string {
  const date = new Date(iso);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function commonConfusions(reviews: ReviewRecord[]): NoteConfusionStat[] {
  const counts = new Map<NoteName, number>();
  for (const review of reviews) {
    for (const wrongAnswer of review.wrongAnswers) {
      counts.set(wrongAnswer.noteName, (counts.get(wrongAnswer.noteName) ?? 0) + 1);
    }
  }
  return [...counts.entries()]
    .map(([noteName, count]) => ({ noteName, count }))
    .sort(
      (left, right) =>
        right.count - left.count || NOTE_NAMES.indexOf(left.noteName) - NOTE_NAMES.indexOf(right.noteName),
    )
    .slice(0, 3);
}

export function buildDailyStats(reviews: ReviewRecord[]): DailyStat[] {
  const byDate = new Map<string, ReviewRecord[]>();
  for (const review of reviews.filter(isStatisticalReview)) {
    const date = localDateKey(review.answeredAt ?? review.endedAt);
    byDate.set(date, [...(byDate.get(date) ?? []), review]);
  }

  const nonZeroCounts = [...byDate.values()].map((dayReviews) => dayReviews.length);

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
        heatLevel: completedReviews === 0 ? 0 : positiveTertileLevel(completedReviews, nonZeroCounts),
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
): PracticeSessionStat[] {
  const sessionsById = new Map(sessions.map((session) => [session.id, session]));
  const reviewsBySession = new Map<string, ReviewRecord[]>();

  for (const review of reviews.filter(isStatisticalReview)) {
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

function average(values: number[]): number | undefined {
  return values.length === 0 ? undefined : values.reduce((sum, value) => sum + value, 0) / values.length;
}

function reviewCompletedAt(review: ReviewRecord): number {
  return new Date(review.answeredAt ?? review.endedAt).getTime();
}

export function buildRecognitionTrend(
  reviews: ReviewRecord[],
  sessions: PracticeSessionRecord[],
  targetNoteIds: readonly TargetNoteId[],
  grouping: RecognitionTrendGrouping,
): RecognitionTrendPoint[] {
  const targetIds = [...new Set(targetNoteIds)].sort();
  const targetIdSet = new Set(targetIds);
  const statisticalReviews = reviews
    .filter((review) => targetIdSet.has(review.targetNoteId) && isStatisticalReview(review))
    .sort(
      (left, right) =>
        reviewCompletedAt(left) - reviewCompletedAt(right) ||
        new Date(left.startedAt).getTime() - new Date(right.startedAt).getTime(),
    );
  const sessionBoundaries = buildPracticeSessionStats(statisticalReviews, sessions)
    .map((session) => ({
      boundaryAt: session.endedAt ?? session.startedAt,
      key: session.sessionId,
    }))
    .sort(
      (left, right) =>
        new Date(left.boundaryAt).getTime() - new Date(right.boundaryAt).getTime() || left.key.localeCompare(right.key),
    );
  const boundaries = grouping === "day"
    ? [...new Map(sessionBoundaries.map((boundary) => [localDateKey(boundary.boundaryAt), boundary])).entries()]
        .map(([date, boundary]) => ({ ...boundary, key: date }))
    : sessionBoundaries;

  return boundaries.map((boundary) => {
    const evidence = statisticalReviews.filter(
      (review) => reviewCompletedAt(review) <= new Date(boundary.boundaryAt).getTime(),
    );
    const byNote = new Map(targetIds.map((noteId) => [noteId, [] as ReviewRecord[]]));
    for (const review of evidence) {
      byNote.get(review.targetNoteId)?.push(review);
    }
    const cohort = targetIds.filter((noteId) => (byNote.get(noteId)?.length ?? 0) >= 20);
    const noteMetrics = cohort.map((noteId) => {
      const recent = (byNote.get(noteId) ?? []).slice(-PERFORMANCE_REVIEW_LIMIT);
      const activeTimes = recent.map((review) => review.activeMs);
      return {
        errorRate: recent.filter((review) => review.wrongAnswers.length > 0).length / recent.length,
        medianMs: percentile(activeTimes, 0.5)!,
        p10Ms: percentile(activeTimes, 0.1)!,
        p90Ms: percentile(activeTimes, 0.9)!,
      };
    });
    return {
      boundaryAt: boundary.boundaryAt,
      cohortKey: cohort.join("|"),
      coveredNoteCount: cohort.length,
      errorRate: average(noteMetrics.map((metric) => metric.errorRate)),
      key: boundary.key,
      medianMs: average(noteMetrics.map((metric) => metric.medianMs)),
      p10Ms: average(noteMetrics.map((metric) => metric.p10Ms)),
      p90Ms: average(noteMetrics.map((metric) => metric.p90Ms)),
      totalNoteCount: targetIds.length,
    };
  });
}

export function buildNoteStats(
  reviews: ReviewRecord[],
  groupFilter?: PracticeGroupId[],
): NoteStat[] {
  const allowedGroups = groupFilter && groupFilter.length > 0 ? new Set(groupFilter) : undefined;
  return ALL_NOTES.filter((note) => !allowedGroups || allowedGroups.has(note.groupId)).map((note) => {
    const noteReviews = reviews.filter((review) => review.targetNoteId === note.id && isStatisticalReview(review));
    const times = noteReviews.map((review) => review.activeMs);
    const reviewsWithErrors = noteReviews.filter((review) => review.wrongAnswers.length > 0).length;
    const errorCount = noteReviews.reduce((count, review) => count + review.wrongAnswers.length, 0);
    const p10Ms = percentile(times, 0.1);
    const medianMs = percentile(times, 0.5);
    const p90Ms = percentile(times, 0.9);
    const errorRate = noteReviews.length === 0 ? 0 : reviewsWithErrors / noteReviews.length;
    const speedScore = medianMs === undefined ? 2 : medianMs / 1000;
    const confusionStats = commonConfusions(noteReviews);
    return {
      targetNoteId: note.id,
      groupId: note.groupId,
      reviewCount: noteReviews.length,
      errorCount,
      p10Ms,
      medianMs,
      p90Ms,
      errorRate,
      commonConfusion: confusionStats[0]?.noteName,
      commonConfusions: confusionStats,
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
