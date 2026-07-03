import { describe, expect, it } from "vitest";
import { buildDailyStats, buildNoteStats, percentile } from "./stats";
import { makeReview } from "./testFactories";

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

  it("builds per-note error and confusion stats", () => {
    const reviews = [
      makeReview({ targetNoteId: "F3", wrongAnswers: [{ noteName: "A", atActiveMs: 500 }] }),
      makeReview({ targetNoteId: "F3", wrongAnswers: [{ noteName: "A", atActiveMs: 700 }] }),
      makeReview({ targetNoteId: "F3" }),
    ];

    const f3 = buildNoteStats(reviews).find((stat) => stat.targetNoteId === "F3")!;
    expect(f3.reviewCount).toBe(3);
    expect(f3.commonConfusion).toBe("A");
    expect(Math.round(f3.errorRate * 100)).toBe(67);
  });
});
