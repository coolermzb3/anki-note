import { describe, expect, it } from "vitest";
import type { Staff } from "../domain/types";
import {
  getCompleteStaffPageBeamGroups,
  getQuarterNoteBeats,
  getStaffPageBarlineInterval,
  getVexNoteDuration,
  PROMPT_NOTE_DURATIONS,
} from "./staffPageNotation";

function note(staff: Staff): { staff: Staff } {
  return { staff };
}

describe("staff-page notation", () => {
  it("exposes all supported prompt note durations", () => {
    expect(PROMPT_NOTE_DURATIONS).toEqual(["whole", "quarter", "eighth", "sixteenth"]);
  });

  it("maps prompt note durations to VexFlow durations and quarter-note beats", () => {
    expect([
      getVexNoteDuration("whole"),
      getVexNoteDuration("quarter"),
      getVexNoteDuration("eighth"),
      getVexNoteDuration("sixteenth"),
    ]).toEqual(["w", "q", "8", "16"]);
    expect([
      getQuarterNoteBeats("whole"),
      getQuarterNoteBeats("quarter"),
      getQuarterNoteBeats("eighth"),
      getQuarterNoteBeats("sixteenth"),
    ]).toEqual([4, 1, 0.5, 0.25]);
  });

  it("uses four-note barlines for long values and eight-note barlines for short values", () => {
    expect(getStaffPageBarlineInterval("whole")).toBe(4);
    expect(getStaffPageBarlineInterval("quarter")).toBe(4);
    expect(getStaffPageBarlineInterval("eighth")).toBe(8);
    expect(getStaffPageBarlineInterval("sixteenth")).toBe(8);
  });

  it("beams complete same-staff eighth-note pairs", () => {
    expect(
      getCompleteStaffPageBeamGroups(
        [note("treble"), note("treble"), note("bass"), note("treble"), note("bass"), note("bass")],
        "eighth",
      ),
    ).toEqual([
      { size: 2, staff: "treble", startIndex: 0 },
      { size: 2, staff: "bass", startIndex: 4 },
    ]);
  });

  it("beams complete same-staff sixteenth-note groups of four", () => {
    expect(
      getCompleteStaffPageBeamGroups(
        [
          note("treble"),
          note("treble"),
          note("treble"),
          note("treble"),
          note("bass"),
          note("bass"),
          note("bass"),
          note("bass"),
        ],
        "sixteenth",
      ),
    ).toEqual([
      { size: 4, staff: "treble", startIndex: 0 },
      { size: 4, staff: "bass", startIndex: 4 },
    ]);
  });

  it("leaves staff changes and incomplete final groups unbeamed", () => {
    expect(
      getCompleteStaffPageBeamGroups(
        [note("treble"), note("treble"), note("treble"), note("bass"), note("bass"), note("bass"), note("bass")],
        "sixteenth",
      ),
    ).toEqual([]);
  });

  it("does not beam whole or quarter notes", () => {
    expect(getCompleteStaffPageBeamGroups([note("treble"), note("treble")], "whole")).toEqual([]);
    expect(getCompleteStaffPageBeamGroups([note("treble"), note("treble")], "quarter")).toEqual([]);
  });
});
