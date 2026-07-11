import { getPracticeSessionComparisonSnapshot } from "./legacyPracticeSessionCompatibility";
import { buildPracticeComparisonSnapshot, type PracticeComparisonSnapshot } from "./practiceComparison";
import { isStatisticalReview } from "./reviews";
import { hasEnoughStatReviews } from "./stats";
import type { AppSettings, PracticeSessionRecord, ReviewRecord } from "./types";

export type SessionProgressMode = "actual-order" | "duration-cumsum";

export interface SessionProgressPoint {
  elapsedMs: number;
  completedReviews: number;
}

export interface SessionProgressSeries {
  durationMs?: number;
  sessionId: string;
  startedAt: string;
  isCurrent: boolean;
  points: SessionProgressPoint[];
}

export interface BuildSessionProgressSeriesOptions {
  currentSession: PracticeSessionRecord;
  currentReviews: ReviewRecord[];
  sessions: PracticeSessionRecord[];
  reviews: ReviewRecord[];
  historyLimit: number;
  mode: SessionProgressMode;
}

export interface BuildLatestSessionProgressSeriesOptions {
  settings: AppSettings;
  sessions: PracticeSessionRecord[];
  reviews: ReviewRecord[];
  historyLimit: number;
  mode: SessionProgressMode;
}

export type BuildLatestSessionProgressBenchmarkOptions = Pick<
  BuildLatestSessionProgressSeriesOptions,
  "reviews" | "sessions" | "settings"
>;

export interface BuildSessionProgressBenchmarkOptions {
  currentSession: PracticeSessionRecord;
  currentReviews: ReviewRecord[];
  sessions: PracticeSessionRecord[];
  reviews: ReviewRecord[];
}

export interface SessionProgressBenchmark {
  bestValue?: number;
  currentValue?: number;
  isNewBest: boolean;
  metric: "completed-count" | "elapsed-ms";
}

function areFinitePracticeSessions(reference: PracticeSessionRecord, candidate: PracticeSessionRecord): boolean {
  return reference.mode !== "open-ended" && candidate.mode !== "open-ended";
}

export function isProgressChartEligible(session: PracticeSessionRecord, sessionReviews: ReviewRecord[]): boolean {
  return session.mode !== "open-ended" && hasEnoughStatReviews(sessionReviews);
}

function sameComparisonSnapshot(
  reference: PracticeComparisonSnapshot | undefined,
  candidate: PracticeComparisonSnapshot | undefined,
): boolean {
  return Boolean(
    reference &&
      candidate &&
      reference.targetNoteSetKey === candidate.targetNoteSetKey &&
      reference.promptDisplayMode === candidate.promptDisplayMode &&
      reference.effectiveQueueAlgorithm === candidate.effectiveQueueAlgorithm,
  );
}

export function isComparablePracticeSession(
  reference: PracticeSessionRecord,
  candidate: PracticeSessionRecord,
): boolean {
  if (reference.id === candidate.id || !areFinitePracticeSessions(reference, candidate)) {
    return false;
  }
  return sameComparisonSnapshot(
    getPracticeSessionComparisonSnapshot(reference),
    getPracticeSessionComparisonSnapshot(candidate),
  );
}

function getStatisticalReviewsInAnswerOrder(reviews: ReviewRecord[]): ReviewRecord[] {
  return reviews
    .map((review, index) => ({ index, review }))
    .filter(({ review }) => isStatisticalReview(review))
    .sort(
      (a, b) =>
        new Date(a.review.answeredAt ?? a.review.endedAt).getTime() -
          new Date(b.review.answeredAt ?? b.review.endedAt).getTime() ||
        new Date(a.review.startedAt).getTime() - new Date(b.review.startedAt).getTime() ||
        a.index - b.index,
    )
    .map(({ review }) => review);
}

function buildActualOrderPoints(reviews: ReviewRecord[]): SessionProgressPoint[] {
  const statisticalReviews = getStatisticalReviewsInAnswerOrder(reviews);
  if (statisticalReviews.length === 0) {
    return [];
  }

  let elapsedMs = 0;
  return [
    { elapsedMs: 0, completedReviews: 0 },
    ...statisticalReviews.map((review, index) => {
      elapsedMs += Math.max(0, review.activeMs);
      return {
        elapsedMs,
        completedReviews: index + 1,
      };
    }),
  ];
}

function buildDurationCumsumPoints(reviews: ReviewRecord[]): SessionProgressPoint[] {
  const durations = reviews
    .filter(isStatisticalReview)
    .map((review) => review.activeMs)
    .sort((a, b) => a - b);
  let elapsedMs = 0;
  return [
    { elapsedMs, completedReviews: 0 },
    ...durations.map((duration, index) => {
      elapsedMs += Math.max(0, duration);
      return {
        elapsedMs,
        completedReviews: index + 1,
      };
    }),
  ];
}

function buildSessionProgressPoints(reviews: ReviewRecord[], mode: SessionProgressMode): SessionProgressPoint[] {
  return mode === "actual-order" ? buildActualOrderPoints(reviews) : buildDurationCumsumPoints(reviews);
}

function getComparisonDurationMs(session: PracticeSessionRecord, points: SessionProgressPoint[]): number {
  if (session.mode === "fixed-duration" && session.fixedDurationSeconds !== undefined) {
    return Math.max(0, session.fixedDurationSeconds * 1000);
  }
  return points[points.length - 1]?.elapsedMs ?? 0;
}

function truncateReviewsByActualElapsedMs(reviews: ReviewRecord[], maxElapsedMs: number): ReviewRecord[] {
  let elapsedMs = 0;
  const truncatedReviews: ReviewRecord[] = [];
  for (const review of getStatisticalReviewsInAnswerOrder(reviews)) {
    const nextElapsedMs = elapsedMs + Math.max(0, review.activeMs);
    if (nextElapsedMs > maxElapsedMs) {
      break;
    }
    truncatedReviews.push(review);
    elapsedMs = nextElapsedMs;
  }
  return truncatedReviews;
}

function groupReviewsBySession(reviews: ReviewRecord[]): Map<string, ReviewRecord[]> {
  const reviewsBySession = new Map<string, ReviewRecord[]>();
  for (const review of reviews) {
    reviewsBySession.set(review.sessionId, [...(reviewsBySession.get(review.sessionId) ?? []), review]);
  }
  return reviewsBySession;
}

function currentSettingsComparisonSnapshot(settings: AppSettings): PracticeComparisonSnapshot | undefined {
  return buildPracticeComparisonSnapshot({
    drillNoteNames: settings.drillNoteNames,
    enabledGroupIds: settings.enabledGroupIds,
    includeInterStaffLedgerSpellings: settings.includeInterStaffLedgerSpellings,
    promptDisplayMode: settings.promptDisplayMode,
    queueStrategy: settings.queueStrategy,
    staffNotationMode: settings.staffNotationMode,
  });
}

function findLatestProgressSession(
  settings: AppSettings,
  sessions: PracticeSessionRecord[],
  reviewsBySession: Map<string, ReviewRecord[]>,
): PracticeSessionRecord | undefined {
  const settingsSnapshot = currentSettingsComparisonSnapshot(settings);
  return [...sessions]
    .filter(
      (session) =>
        isProgressChartEligible(session, reviewsBySession.get(session.id) ?? []) &&
        sameComparisonSnapshot(settingsSnapshot, getPracticeSessionComparisonSnapshot(session)),
    )
    .sort(
      (a, b) =>
        new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime() || b.id.localeCompare(a.id),
    )[0];
}

export function buildSessionProgressBenchmark({
  currentSession,
  currentReviews,
  sessions,
  reviews,
}: BuildSessionProgressBenchmarkOptions): SessionProgressBenchmark | undefined {
  if (currentSession.mode === "open-ended") {
    return undefined;
  }
  const currentStartedAt = new Date(currentSession.startedAt).getTime();
  const reviewsBySession = groupReviewsBySession(reviews);
  const comparableReviewSets = [
    currentReviews,
    ...sessions
      .filter((session) => {
        const sessionReviews = reviewsBySession.get(session.id) ?? [];
        return (
          new Date(session.startedAt).getTime() < currentStartedAt &&
          isComparablePracticeSession(currentSession, session)
        );
      })
      .map((session) => reviewsBySession.get(session.id) ?? []),
  ];

  if (currentSession.mode === "fixed-duration") {
    const durationMs = (currentSession.fixedDurationSeconds ?? 0) * 1000;
    if (durationMs <= 0) {
      return undefined;
    }
    const values = comparableReviewSets.map(
      (sessionReviews) => truncateReviewsByActualElapsedMs(sessionReviews, durationMs).length,
    );
    const historicalValues = values.slice(1);
    return {
      metric: "completed-count",
      currentValue: values[0],
      bestValue: Math.max(...values),
      isNewBest: historicalValues.length > 0 && values[0] > Math.max(...historicalValues),
    };
  }

  const targetCount = currentSession.fixedCount ?? 0;
  if (targetCount <= 0) {
    return undefined;
  }
  const values = comparableReviewSets.map((sessionReviews) => {
    const orderedReviews = getStatisticalReviewsInAnswerOrder(sessionReviews);
    if (orderedReviews.length < targetCount) {
      return undefined;
    }
    return orderedReviews
      .slice(0, targetCount)
      .reduce((total, review) => total + Math.max(0, review.activeMs), 0);
  });
  const completedValues = values.filter((value): value is number => value !== undefined);
  const historicalCompletedValues = values.slice(1).filter((value): value is number => value !== undefined);
  return {
    metric: "elapsed-ms",
    currentValue: values[0],
    bestValue: completedValues.length > 0 ? Math.min(...completedValues) : undefined,
    isNewBest:
      values[0] !== undefined &&
      historicalCompletedValues.length > 0 &&
      values[0] < Math.min(...historicalCompletedValues),
  };
}

export function buildSessionProgressSeries({
  currentSession,
  currentReviews,
  sessions,
  reviews,
  historyLimit,
  mode,
}: BuildSessionProgressSeriesOptions): SessionProgressSeries[] {
  if (!isProgressChartEligible(currentSession, currentReviews)) {
    return [];
  }

  const currentPoints = buildSessionProgressPoints(currentReviews, mode);
  if (currentPoints.length <= 1) {
    return [];
  }

  const comparisonDurationMs = getComparisonDurationMs(currentSession, currentPoints);
  const currentStartedAt = new Date(currentSession.startedAt).getTime();
  const reviewsBySession = groupReviewsBySession(reviews);

  const historySeries = sessions
    .filter((session) => {
      const sessionReviews = reviewsBySession.get(session.id) ?? [];
      return (
        new Date(session.startedAt).getTime() < currentStartedAt &&
        isProgressChartEligible(session, sessionReviews) &&
        isComparablePracticeSession(currentSession, session)
      );
    })
    .sort(
      (a, b) =>
        new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime() || b.id.localeCompare(a.id),
    )
    .slice(0, Math.max(1, Math.floor(historyLimit)))
    .reverse()
    .map((session) => {
      const sessionReviews = reviewsBySession.get(session.id) ?? [];
      return {
        sessionId: session.id,
        startedAt: session.startedAt,
        isCurrent: false,
        points: buildSessionProgressPoints(truncateReviewsByActualElapsedMs(sessionReviews, comparisonDurationMs), mode),
      };
    })
    .filter((series) => series.points.length > 1);

  return [
    ...historySeries,
    {
      durationMs: comparisonDurationMs,
      sessionId: currentSession.id,
      startedAt: currentSession.startedAt,
      isCurrent: true,
      points: currentPoints,
    },
  ];
}

export function buildLatestSessionProgressSeries({
  settings,
  sessions,
  reviews,
  historyLimit,
  mode,
}: BuildLatestSessionProgressSeriesOptions): SessionProgressSeries[] {
  const reviewsBySession = groupReviewsBySession(reviews);
  const currentSession = findLatestProgressSession(settings, sessions, reviewsBySession);

  if (!currentSession) {
    return [];
  }

  return buildSessionProgressSeries({
    currentSession,
    currentReviews: reviewsBySession.get(currentSession.id) ?? [],
    sessions,
    reviews,
    historyLimit,
    mode,
  });
}

export function buildLatestSessionProgressBenchmark({
  settings,
  sessions,
  reviews,
}: BuildLatestSessionProgressBenchmarkOptions): SessionProgressBenchmark | undefined {
  const reviewsBySession = groupReviewsBySession(reviews);
  const currentSession = findLatestProgressSession(settings, sessions, reviewsBySession);
  if (!currentSession) {
    return undefined;
  }
  return buildSessionProgressBenchmark({
    currentSession,
    currentReviews: reviewsBySession.get(currentSession.id) ?? [],
    sessions,
    reviews,
  });
}
