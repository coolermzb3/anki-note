import { describe, expect, it } from "vitest";
import type { Staff } from "../domain/types";
import {
  getBarlineGapCenter,
  getQuarterNoteBeats,
  getStaffPageBarlineInterval,
  getStaffPageBeamRuns,
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

  it("centers a barline in the visible gap and omits it when glyph bounds overlap", () => {
    expect(getBarlineGapCenter(20, 40)).toBe(30);
    expect(getBarlineGapCenter(40, 30)).toBeUndefined();
  });

  it("beams complete same-staff eighth-note pairs", () => {
    expect(
      getStaffPageBeamRuns(
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
      getStaffPageBeamRuns(
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

  it("prioritizes aligned four-note groups before splitting same-staff runs", () => {
    expect(
      getStaffPageBeamRuns(
        [note("treble"), note("treble"), note("treble"), note("bass"), note("bass"), note("bass"), note("bass")],
        "sixteenth",
      ),
    ).toEqual([
      { size: 3, staff: "treble", startIndex: 0 },
      { size: 3, staff: "bass", startIndex: 4 },
    ]);
  });

  it("beams short final runs but leaves isolated notes unbeamed", () => {
    expect(
      getStaffPageBeamRuns(
        [note("treble"), note("bass"), note("bass"), note("treble"), note("bass")],
        "sixteenth",
      ),
    ).toEqual([{ size: 2, staff: "bass", startIndex: 1 }]);
  });

  it("does not beam across an eight-note barline", () => {
    expect(
      getStaffPageBeamRuns(
        [
          note("treble"),
          note("bass"),
          note("treble"),
          note("bass"),
          note("treble"),
          note("bass"),
          note("treble"),
          note("treble"),
          note("treble"),
          note("treble"),
        ],
        "sixteenth",
      ),
    ).toEqual([
      { size: 2, staff: "treble", startIndex: 6 },
      { size: 2, staff: "treble", startIndex: 8 },
    ]);
  });

  it("does not beam whole or quarter notes", () => {
    expect(getStaffPageBeamRuns([note("treble"), note("treble")], "whole")).toEqual([]);
    expect(getStaffPageBeamRuns([note("treble"), note("treble")], "quarter")).toEqual([]);
  });
});
