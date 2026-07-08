import { findNoteById } from "./notes";
import { isStatisticalReview } from "./reviews";
import { hasEnoughStatReviews } from "./stats";
import type { AppSettings, PracticeGroupId, PracticeSessionRecord, ReviewRecord } from "./types";

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
  settings: Pick<AppSettings, "enabledGroupIds" | "includeLedgerVariants">;
  sessions: PracticeSessionRecord[];
  reviews: ReviewRecord[];
  historyLimit: number;
  mode: SessionProgressMode;
}

type PracticeRangeScope = {
  enabledGroupIds: PracticeGroupId[];
  includeLedgerVariants?: boolean;
};

function sameStringSet(left: string[] = [], right: string[] = []): boolean {
  if (left.length !== right.length) {
    return false;
  }
  const selected = new Set(left);
  return right.every((value) => selected.has(value));
}

function areFinitePracticeSessions(reference: PracticeSessionRecord, candidate: PracticeSessionRecord): boolean {
  return reference.mode !== "open-ended" && candidate.mode !== "open-ended";
}

export function isProgressChartEligible(session: PracticeSessionRecord, sessionReviews: ReviewRecord[]): boolean {
  return session.mode !== "open-ended" && hasEnoughStatReviews(sessionReviews);
}

function hasLedgerVariantReview(reviews: ReviewRecord[]): boolean {
  return reviews.some((review) => findNoteById(review.targetNoteId)?.isLedgerVariant);
}

function samePromptDisplayMode(reference: PracticeSessionRecord, candidate: PracticeSessionRecord): boolean {
  return (
    reference.promptDisplayMode === undefined ||
    candidate.promptDisplayMode === undefined ||
    reference.promptDisplayMode === candidate.promptDisplayMode
  );
}

function sameLedgerVariantScope(
  reference: PracticeRangeScope,
  candidate: PracticeRangeScope,
  candidateReviews: ReviewRecord[],
): boolean {
  if (reference.includeLedgerVariants !== undefined && candidate.includeLedgerVariants !== undefined) {
    return reference.includeLedgerVariants === candidate.includeLedgerVariants;
  }
  return reference.includeLedgerVariants !== false || !hasLedgerVariantReview(candidateReviews);
}

export function isSamePracticeRange(
  reference: PracticeRangeScope,
  candidate: PracticeRangeScope,
  candidateReviews: ReviewRecord[] = [],
): boolean {
  return (
    sameStringSet(reference.enabledGroupIds, candidate.enabledGroupIds) &&
    sameLedgerVariantScope(reference, candidate, candidateReviews)
  );
}

export function isComparablePracticeSession(
  reference: PracticeSessionRecord,
  candidate: PracticeSessionRecord,
  candidateReviews: ReviewRecord[] = [],
): boolean {
  if (reference.id === candidate.id || !areFinitePracticeSessions(reference, candidate)) {
    return false;
  }
  if (!isSamePracticeRange(reference, candidate, candidateReviews)) {
    return false;
  }
  if (!samePromptDisplayMode(reference, candidate)) {
    return false;
  }
  if (reference.queueStrategy !== candidate.queueStrategy) {
    return false;
  }
  if (reference.queueStrategy === "note-drill") {
    return sameStringSet(reference.drillNoteNames, candidate.drillNoteNames);
  }
  return true;
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
        isComparablePracticeSession(currentSession, session, sessionReviews)
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
  const currentSession = [...sessions]
    .filter(
      (session) =>
        isProgressChartEligible(session, reviewsBySession.get(session.id) ?? []) &&
        isSamePracticeRange(settings, session, reviewsBySession.get(session.id) ?? []),
    )
    .sort(
      (a, b) =>
        new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime() || b.id.localeCompare(a.id),
    )[0];

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
