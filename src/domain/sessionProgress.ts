import { findNoteById } from "./notes";
import { isCompletedReview } from "./reviews";
import type { AppSettings, PracticeGroupId, PracticeSessionRecord, ReviewRecord } from "./types";

export type SessionProgressMode = "actual-order" | "duration-cumsum";

export interface SessionProgressPoint {
  elapsedMs: number;
  completedReviews: number;
}

export interface SessionProgressSeries {
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

function buildActualOrderPoints(reviews: ReviewRecord[]): SessionProgressPoint[] {
  const completedReviews = reviews.filter(isCompletedReview);
  if (completedReviews.length === 0) {
    return [];
  }

  let elapsedMs = 0;
  return [
    { elapsedMs: 0, completedReviews: 0 },
    ...completedReviews
      .map((review, index) => ({ index, review }))
      .sort(
        (a, b) =>
          new Date(a.review.answeredAt ?? a.review.endedAt).getTime() -
            new Date(b.review.answeredAt ?? b.review.endedAt).getTime() ||
          new Date(a.review.startedAt).getTime() - new Date(b.review.startedAt).getTime() ||
          a.index - b.index,
      )
      .map(({ review }, index) => {
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
    .filter(isCompletedReview)
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
  if (currentSession.mode === "open-ended") {
    return [];
  }

  const currentPoints = buildSessionProgressPoints(currentReviews, mode);
  if (currentPoints.length <= 1) {
    return [];
  }

  const currentStartedAt = new Date(currentSession.startedAt).getTime();
  const reviewsBySession = groupReviewsBySession(reviews);

  const historySeries = sessions
    .filter((session) => {
      const sessionReviews = reviewsBySession.get(session.id) ?? [];
      return (
        new Date(session.startedAt).getTime() < currentStartedAt &&
        isComparablePracticeSession(currentSession, session, sessionReviews)
      );
    })
    .sort(
      (a, b) =>
        new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime() || b.id.localeCompare(a.id),
    )
    .slice(0, Math.max(1, Math.floor(historyLimit)))
    .reverse()
    .map((session) => ({
      sessionId: session.id,
      startedAt: session.startedAt,
      isCurrent: false,
      points: buildSessionProgressPoints(reviewsBySession.get(session.id) ?? [], mode),
    }))
    .filter((series) => series.points.length > 1);

  return [
    ...historySeries,
    {
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
        session.mode !== "open-ended" && isSamePracticeRange(settings, session, reviewsBySession.get(session.id) ?? []),
    )
    .sort(
      (a, b) =>
        new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime() || b.id.localeCompare(a.id),
    )
    .find((session) => buildSessionProgressPoints(reviewsBySession.get(session.id) ?? [], mode).length > 1);

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
