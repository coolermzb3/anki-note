import { describe, expect, it } from "vitest";
import { buildPracticeComparisonSnapshot, getQueueComparisonFamily } from "./practiceComparison";

function snapshot(overrides: Partial<Parameters<typeof buildPracticeComparisonSnapshot>[0]> = {}) {
  return buildPracticeComparisonSnapshot({
    drillNoteNames: [],
    enabledGroupIds: ["G4-F5"],
    includeInterStaffLedgerSpellings: false,
    promptDisplayMode: "staff-page",
    promptNoteDuration: "quarter",
    queueStrategy: "adaptive",
    staffNotationMode: "grand",
    ...overrides,
  });
}

describe("practice comparison snapshot", () => {
  it("compares by the resulting target set instead of the staff-selection cause", () => {
    const grand = snapshot();
    const trebleOnly = snapshot({ staffNotationMode: "treble-only" });
    const grandWithInterStaffLedger = snapshot({ includeInterStaffLedgerSpellings: true });

    expect(grand?.targetNoteSetKey).toBe(trebleOnly?.targetNoteSetKey);
    expect(grandWithInterStaffLedger?.targetNoteSetKey).not.toBe(grand?.targetNoteSetKey);
  });

  it("treats a seven-name drill as the regular adaptive queue after filtering", () => {
    const adaptive = snapshot();
    const fullDrill = snapshot({
      drillNoteNames: ["C", "D", "E", "F", "G", "A", "B"],
      queueStrategy: "note-drill",
    });

    expect(fullDrill).toEqual(adaptive);
  });

  it("records the coverage-aware melody generator as melody-v2", () => {
    expect(snapshot({ queueStrategy: "melody" })?.effectiveQueueAlgorithm).toBe("melody-v2");
  });

  it("keeps old regular and focused algorithms in the adaptive comparison family", () => {
    expect((["adaptive-v1", "focused-v1", "adaptive-v2"] as const).map(getQueueComparisonFamily)).toEqual([
      "adaptive",
      "adaptive",
      "adaptive",
    ]);
    expect(snapshot()?.effectiveQueueAlgorithm).toBe("adaptive-v2");
  });

  it("keeps prompt note duration in the direct comparison snapshot", () => {
    expect(snapshot({ promptNoteDuration: "quarter" })).not.toEqual(
      snapshot({ promptNoteDuration: "sixteenth" }),
    );
  });
});
