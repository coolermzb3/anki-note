import { describe, expect, it } from "vitest";
import { isCompletedReview, isStatisticalReview } from "./reviews";
import { makeReview } from "./testFactories";

describe("review predicates", () => {
  it("treats only correct uninterrupted reviews as completed", () => {
    expect(isCompletedReview(makeReview({ targetNoteId: "C4" }))).toBe(true);
    expect(
      isCompletedReview(
        makeReview({
          targetNoteId: "C4",
          interrupted: true,
          interruptReason: "focus-lost",
        }),
      ),
    ).toBe(false);
    expect(
      isCompletedReview(
        makeReview({
          targetNoteId: "C4",
          answeredAt: undefined,
          answeredCorrectly: false,
          interrupted: true,
          interruptReason: "manual-stop",
        }),
      ),
    ).toBe(false);
  });

  it("excludes ignored completed reviews from statistical history", () => {
    expect(isStatisticalReview(makeReview({ targetNoteId: "C4" }))).toBe(true);
    expect(isStatisticalReview(makeReview({ targetNoteId: "C4", ignored: true }))).toBe(false);
  });
});
