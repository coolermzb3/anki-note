import { describe, expect, it } from "vitest";
import { buildDailyStats, buildNoteStats, buildPracticeSessionStats, filterLongTermReviews, percentile } from "./stats";
import { makeReview } from "./testFactories";
import type { PracticeSessionRecord } from "./types";

function makeSession(overrides: Partial<PracticeSessionRecord> & { id: string; startedAt: string }): PracticeSessionRecord {
  return {
    id: overrides.id,
    schemaVersion: 1,
    mode: overrides.mode ?? "open-ended",
    enabledGroupIds: overrides.enabledGroupIds ?? ["G3-F4"],
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
  });

  it("excludes ignored reviews from long-term stats", () => {
    const reviews = [
      makeReview({ targetNoteId: "C4", activeMs: 1000 }),
      makeReview({ targetNoteId: "C4", activeMs: 9000, ignored: true }),
    ];

    expect(buildDailyStats(reviews)[0].medianMs).toBe(1000);
    expect(buildPracticeSessionStats(reviews)[0].medianMs).toBe(1000);
    expect(buildNoteStats(reviews).find((stat) => stat.targetNoteId === "C4")?.reviewCount).toBe(1);
  });

  it("filters sessions with fewer than five qualified reviews from long-term stats", () => {
    const shortSession = Array.from({ length: 4 }, (_, index) =>
      makeReview({ id: `short-${index}`, targetNoteId: "C4", sessionId: "short-session" }),
    );
    const longSession = Array.from({ length: 5 }, (_, index) =>
      makeReview({ id: `long-${index}`, targetNoteId: "D4", sessionId: "long-session" }),
    );

    const filtered = filterLongTermReviews([...shortSession, ...longSession]);

    expect(new Set(filtered.map((review) => review.sessionId))).toEqual(new Set(["long-session"]));
    expect(buildDailyStats(filtered)[0].completedReviews).toBe(5);
  });

  it("does not let interrupted reviews qualify a session for long-term stats", () => {
    const reviews = [
      ...Array.from({ length: 4 }, (_, index) =>
        makeReview({ id: `completed-${index}`, targetNoteId: "C4", sessionId: "mixed-session" }),
      ),
      makeReview({
        id: "interrupted",
        targetNoteId: "D4",
        sessionId: "mixed-session",
        interrupted: true,
        interruptReason: "focus-lost",
      }),
    ];

    expect(filterLongTermReviews(reviews)).toHaveLength(0);
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

  it("builds note stats from the current target-note group instead of the review group snapshot", () => {
    const reviews = [makeReview({ targetNoteId: "C4", groupId: "G5-G6" })];

    const c4 = buildNoteStats(reviews, ["G3-F4"]).find((stat) => stat.targetNoteId === "C4")!;
    const outOfRange = buildNoteStats(reviews, ["G5-G6"]).find((stat) => stat.targetNoteId === "C4");

    expect(c4.reviewCount).toBe(1);
    expect(outOfRange).toBeUndefined();
  });
});
