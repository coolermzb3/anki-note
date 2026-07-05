import { describe, expect, it } from "vitest";
import { buildDailyStats, buildNoteStats, buildPracticeSessionStats, percentile } from "./stats";
import { makeReview } from "./testFactories";
import type { PracticeSessionRecord } from "./types";

function makeSession(overrides: Partial<PracticeSessionRecord> & { id: string; startedAt: string }): PracticeSessionRecord {
  return {
    id: overrides.id,
    schemaVersion: 1,
    mode: overrides.mode ?? "open-ended",
    enabledGroupIds: overrides.enabledGroupIds ?? ["C4-B4"],
    fixedCount: overrides.fixedCount,
    fixedDurationSeconds: overrides.fixedDurationSeconds,
    startedAt: overrides.startedAt,
    endedAt: overrides.endedAt,
    endReason: overrides.endReason,
    completedCount: overrides.completedCount ?? 0,
    interruptedCount: overrides.interruptedCount ?? 0,
  };
}

describe("stats", () => {
  it("calculates percentile values with interpolation", () => {
    expect(percentile([100, 200, 300], 0.5)).toBe(200);
    expect(percentile([100, 200], 0.5)).toBe(150);
  });

  it("excludes interrupted reviews by default", () => {
    const reviews = [
      makeReview({ targetNoteId: "C4", activeMs: 1000 }),
      makeReview({ targetNoteId: "C4", activeMs: 5000, interrupted: true, interruptReason: "focus-lost" }),
    ];

    expect(buildDailyStats(reviews)[0].medianMs).toBe(1000);
    expect(buildDailyStats(reviews, true)[0].medianMs).toBe(3000);
  });

  it("excludes ignored reviews from long-term stats", () => {
    const reviews = [
      makeReview({ targetNoteId: "C4", activeMs: 1000 }),
      makeReview({ targetNoteId: "C4", activeMs: 9000, ignored: true }),
    ];

    expect(buildDailyStats(reviews, true)[0].medianMs).toBe(1000);
    expect(buildPracticeSessionStats(reviews, [], true)[0].medianMs).toBe(1000);
    expect(buildNoteStats(reviews, undefined, true).find((stat) => stat.targetNoteId === "C4")?.reviewCount).toBe(1);
  });

  it("builds recognition time stats by practice session", () => {
    const sessions = [
      makeSession({ id: "session-2", startedAt: "2026-07-04T11:00:00.000+08:00" }),
      makeSession({ id: "session-1", startedAt: "2026-07-04T10:00:00.000+08:00" }),
    ];
    const reviews = [
      makeReview({ targetNoteId: "C4", sessionId: "session-1", activeMs: 1000 }),
      makeReview({ targetNoteId: "D4", sessionId: "session-1", activeMs: 3000 }),
      makeReview({ targetNoteId: "E4", sessionId: "session-2", activeMs: 5000 }),
      makeReview({
        targetNoteId: "F4",
        sessionId: "session-2",
        activeMs: 9000,
        interrupted: true,
        interruptReason: "focus-lost",
      }),
    ];

    const stats = buildPracticeSessionStats(reviews, sessions);

    expect(stats.map((stat) => stat.sessionId)).toEqual(["session-1", "session-2"]);
    expect(stats[0].completedReviews).toBe(2);
    expect(stats[0].medianMs).toBe(2000);
    expect(stats[1].medianMs).toBe(5000);
    expect(buildPracticeSessionStats(reviews, sessions, true)[1].medianMs).toBe(7000);
  });

  it("builds practice session stats from review session ids without session records", () => {
    const reviews = [
      makeReview({
        targetNoteId: "C4",
        sessionId: "later",
        startedAt: "2026-07-04T11:00:00.000+08:00",
        endedAt: "2026-07-04T11:00:02.000+08:00",
      }),
      makeReview({
        targetNoteId: "D4",
        sessionId: "earlier",
        startedAt: "2026-07-04T10:00:00.000+08:00",
        endedAt: "2026-07-04T10:00:02.000+08:00",
      }),
    ];

    expect(buildPracticeSessionStats(reviews).map((stat) => stat.sessionId)).toEqual(["earlier", "later"]);
  });

  it("builds per-note error and confusion stats", () => {
    const reviews = [
      makeReview({ targetNoteId: "F3", wrongAnswers: [{ noteName: "A", atActiveMs: 500 }] }),
      makeReview({ targetNoteId: "F3", wrongAnswers: [{ noteName: "A", atActiveMs: 700 }] }),
      makeReview({ targetNoteId: "F3" }),
    ];

    const f3 = buildNoteStats(reviews).find((stat) => stat.targetNoteId === "F3")!;
    expect(f3.reviewCount).toBe(3);
    expect(f3.errorCount).toBe(2);
    expect(f3.commonConfusion).toBe("A");
    expect(Math.round(f3.errorRate * 100)).toBe(67);
  });
});
