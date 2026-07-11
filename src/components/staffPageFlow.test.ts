import { describe, expect, it } from "vitest";
import { getStaffPageRefillCount } from "./staffPageFlow";

describe("rolling staff-page flow", () => {
  it("refills one row when eight visible notes remain", () => {
    expect(
      getStaffPageRefillCount({ completedSessionCount: 40, nextIndex: 40, plannedNoteCount: 48 }),
    ).toBe(24);
  });

  it("does not refill before the eight-note threshold", () => {
    expect(
      getStaffPageRefillCount({ completedSessionCount: 39, nextIndex: 39, plannedNoteCount: 48 }),
    ).toBe(0);
  });

  it("limits or skips the final refill for fixed-count sessions", () => {
    expect(
      getStaffPageRefillCount({
        completedSessionCount: 40,
        fixedSessionCount: 60,
        nextIndex: 40,
        plannedNoteCount: 48,
      }),
    ).toBe(12);
    expect(
      getStaffPageRefillCount({
        completedSessionCount: 40,
        fixedSessionCount: 48,
        nextIndex: 40,
        plannedNoteCount: 48,
      }),
    ).toBe(0);
  });
});
