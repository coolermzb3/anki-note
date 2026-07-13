import { describe, expect, it } from "vitest";
import {
  buildDailyStats,
  buildNoteStats,
  buildPracticeSessionStats,
  buildRecognitionTrend,
  filterLongTermReviews,
  hasEnoughStatReviews,
  isLongTermStatsEligible,
  percentile,
  positiveTertileLevel,
  positiveTertileThresholds,
} from "./stats";
import { makeReview } from "./testFactories";
import type { PracticeSessionRecordV1 } from "./types";

function makeSession(
  overrides: Partial<PracticeSessionRecordV1> & { id: string; startedAt: string },
): PracticeSessionRecordV1 {
  return {
    id: overrides.id,
    schemaVersion: 1,
    mode: overrides.mode ?? "open-ended",
    enabledGroupIds: overrides.enabledGroupIds ?? ["G3-F4"],
    fixedCount: overrides.fixedCount,
    fixedDurationSeconds: overrides.fixedDurationSeconds,
    queueStrategy: overrides.queueStrategy,
    drillNoteNames: overrides.drillNoteNames,
    promptDisplayMode: overrides.promptDisplayMode,
    includeLedgerVariants: overrides.includeLedgerVariants,
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

  it("assigns positive values to tertile heat levels", () => {
    expect(positiveTertileThresholds([40, 10, 50, 20])).toEqual({ low: 20, high: 40 });
    expect(positiveTertileLevel(10, [10, 20, 30])).toBe(1);
    expect(positiveTertileLevel(20, [10, 20, 30])).toBe(2);
    expect(positiveTertileLevel(30, [10, 20, 30])).toBe(3);
    expect(positiveTertileLevel(10, [10, 10, 10])).toBe(1);
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

    expect(hasEnoughStatReviews(shortSession)).toBe(false);
    expect(isLongTermStatsEligible(longSession)).toBe(true);
    expect(new Set(filtered.map((review) => review.sessionId))).toEqual(new Set(["long-session"]));
    expect(buildDailyStats(filtered)[0].completedReviews).toBe(5);
  });

  it("assigns daily heat levels from positive daily-count tertiles", () => {
    const reviews = [
      makeReview({
        id: "day-1-0",
        targetNoteId: "C4",
        answeredAt: "2026-07-01T12:00:00.000+08:00",
        endedAt: "2026-07-01T12:00:00.000+08:00",
      }),
      ...Array.from({ length: 2 }, (_, index) =>
        makeReview({
          id: `day-2-${index}`,
          targetNoteId: "C4",
          answeredAt: "2026-07-02T12:00:00.000+08:00",
          endedAt: "2026-07-02T12:00:00.000+08:00",
        }),
      ),
      ...Array.from({ length: 3 }, (_, index) =>
        makeReview({
          id: `day-3-${index}`,
          targetNoteId: "C4",
          answeredAt: "2026-07-03T12:00:00.000+08:00",
          endedAt: "2026-07-03T12:00:00.000+08:00",
        }),
      ),
    ];

    expect(buildDailyStats(reviews).map((stat) => [stat.date, stat.completedReviews, stat.heatLevel])).toEqual([
      ["2026-07-01", 1, 1],
      ["2026-07-02", 2, 2],
      ["2026-07-03", 3, 3],
    ]);
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

  it("builds recognition trend snapshots by averaging each established note equally", () => {
    const sessions = [makeSession({
      endedAt: "2026-07-04T13:00:00.000+08:00",
      id: "trend-session",
      startedAt: "2026-07-04T10:00:00.000+08:00",
    })];
    const reviews = [
      ...Array.from({ length: 20 }, (_, index) => makeReview({
        activeMs: 1000,
        id: `c-${index}`,
        sessionId: "trend-session",
        targetNoteId: "C4",
      })),
      ...Array.from({ length: 80 }, (_, index) => makeReview({
        activeMs: 3000,
        id: `d-${index}`,
        sessionId: "trend-session",
        targetNoteId: "D4",
        wrongAnswers: [{ atActiveMs: 500, noteName: "C" }],
      })),
    ];

    const [point] = buildRecognitionTrend(reviews, sessions, ["C4", "D4"], "practice-session");

    expect(point.coveredNoteCount).toBe(2);
    expect(point.medianMs).toBe(2000);
    expect(point.errorRate).toBe(0.5);
  });

  it("changes cohorts only at sampled boundaries and keeps the last boundary of a day", () => {
    const sessions = [
      makeSession({
        endedAt: "2026-07-04T10:30:00.000+08:00",
        id: "first",
        startedAt: "2026-07-04T10:00:00.000+08:00",
      }),
      makeSession({
        endedAt: "2026-07-04T11:30:00.000+08:00",
        id: "second",
        startedAt: "2026-07-04T11:00:00.000+08:00",
      }),
    ];
    const reviews = [
      ...Array.from({ length: 20 }, (_, index) => makeReview({
        answeredAt: "2026-07-04T10:20:00.000+08:00",
        endedAt: "2026-07-04T10:20:00.000+08:00",
        id: `first-${index}`,
        sessionId: "first",
        targetNoteId: "C4",
      })),
      ...Array.from({ length: 20 }, (_, index) => makeReview({
        answeredAt: "2026-07-04T11:20:00.000+08:00",
        endedAt: "2026-07-04T11:20:00.000+08:00",
        id: `second-${index}`,
        sessionId: "second",
        targetNoteId: "D4",
      })),
    ];

    const bySession = buildRecognitionTrend(reviews, sessions, ["C4", "D4"], "practice-session");
    const byDay = buildRecognitionTrend(reviews, sessions, ["C4", "D4"], "day");

    expect(bySession.map((point) => point.cohortKey)).toEqual(["C4", "C4|D4"]);
    expect(byDay).toHaveLength(1);
    expect(byDay[0].cohortKey).toBe("C4|D4");
  });

  it("limits each recognition metric to that note's latest 100 reviews", () => {
    const sessions = [makeSession({
      endedAt: "2026-07-04T13:00:00.000+08:00",
      id: "latest-window",
      startedAt: "2026-07-04T10:00:00.000+08:00",
    })];
    const reviews = Array.from({ length: 120 }, (_, index) => makeReview({
      activeMs: index < 20 ? 5000 : 1000,
      id: `window-${index}`,
      sessionId: "latest-window",
      targetNoteId: "C4",
      wrongAnswers: index < 20 ? [{ atActiveMs: 500, noteName: "D" }] : [],
    }));

    const [point] = buildRecognitionTrend(reviews, sessions, ["C4"], "practice-session");

    expect(point.medianMs).toBe(1000);
    expect(point.errorRate).toBe(0);
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
      makeReview({
        targetNoteId: "F3",
        activeMs: 800,
        wrongAnswers: (["A", "D", "B", "C"] as const).map((noteName, index) => ({
          noteName,
          atActiveMs: 500 + index * 100,
        })),
      }),
      makeReview({
        targetNoteId: "F3",
        activeMs: 1000,
        wrongAnswers: (["A", "D", "B"] as const).map((noteName, index) => ({
          noteName,
          atActiveMs: 500 + index * 100,
        })),
      }),
      makeReview({
        targetNoteId: "F3",
        activeMs: 1200,
        wrongAnswers: (["A", "D"] as const).map((noteName, index) => ({
          noteName,
          atActiveMs: 500 + index * 100,
        })),
      }),
      makeReview({
        targetNoteId: "F3",
        activeMs: 1400,
        wrongAnswers: [{ noteName: "A", atActiveMs: 500 }],
      }),
    ];

    const f3 = buildNoteStats(reviews).find((stat) => stat.targetNoteId === "F3")!;
    expect(f3.reviewCount).toBe(4);
    expect(f3.errorCount).toBe(10);
    expect(f3.commonConfusion).toBe("A");
    expect(f3.commonConfusions).toEqual([
      { noteName: "A", count: 4 },
      { noteName: "D", count: 3 },
      { noteName: "B", count: 2 },
    ]);
    expect(f3.p10Ms).toBe(860);
    expect(f3.medianMs).toBe(1100);
    expect(f3.p90Ms).toBe(1340);
    expect(Math.round(f3.errorRate * 100)).toBe(100);
  });

  it("builds note stats from the current target-note group instead of the review group snapshot", () => {
    const reviews = [makeReview({ targetNoteId: "C4", groupId: "G5-G6" })];

    const c4 = buildNoteStats(reviews, ["G3-F4"]).find((stat) => stat.targetNoteId === "C4")!;
    const outOfRange = buildNoteStats(reviews, ["G5-G6"]).find((stat) => stat.targetNoteId === "C4");

    expect(c4.reviewCount).toBe(1);
    expect(outOfRange).toBeUndefined();
  });
});
