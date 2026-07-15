import { describe, expect, it } from "vitest";
import type { Staff } from "../domain/types";
import {
  getBarlineGapCenter,
  getCrossStaffOuterStemDirection,
  getQuarterNoteBeats,
  getStaffPageBarlineInterval,
  getStaffPageBeamRuns,
  getVisibleBeamStemDirection,
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

  it("keeps complete eighth-note pairs beamed across staff changes", () => {
    expect(
      getStaffPageBeamRuns(
        [note("treble"), note("treble"), note("bass"), note("treble"), note("bass"), note("bass")],
        "eighth",
      ),
    ).toEqual([
      { size: 2, startIndex: 0 },
      { size: 2, startIndex: 2 },
      { size: 2, startIndex: 4 },
    ]);
  });

  it("keeps complete sixteenth-note groups beamed across staff changes", () => {
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
          note("bass"),
        ],
        "sixteenth",
      ),
    ).toEqual([
      { size: 4, startIndex: 0 },
      { size: 4, startIndex: 4 },
    ]);
  });

  it("keeps a short final sixteenth-note group aligned to the beat", () => {
    expect(
      getStaffPageBeamRuns(
        [note("treble"), note("treble"), note("treble"), note("bass"), note("bass"), note("bass"), note("bass")],
        "sixteenth",
      ),
    ).toEqual([
      { size: 4, startIndex: 0 },
      { size: 3, startIndex: 4 },
    ]);
  });

  it("leaves an isolated final note unbeamed", () => {
    expect(
      getStaffPageBeamRuns(
        [note("treble"), note("bass"), note("bass"), note("treble"), note("bass")],
        "sixteenth",
      ),
    ).toEqual([{ size: 4, startIndex: 0 }]);
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
      { size: 4, startIndex: 0 },
      { size: 4, startIndex: 4 },
      { size: 2, startIndex: 8 },
    ]);
  });

  it("does not beam whole or quarter notes", () => {
    expect(getStaffPageBeamRuns([note("treble"), note("treble")], "whole")).toEqual([]);
    expect(getStaffPageBeamRuns([note("treble"), note("treble")], "quarter")).toEqual([]);
  });

  it("prioritizes keeping every beam inside the visible row", () => {
    expect(getVisibleBeamStemDirection([{ y: 20 }, { y: 70 }], { bottomY: 200, topY: 0 }, 35)).toBe(
      "down",
    );
    expect(getVisibleBeamStemDirection([{ y: 50 }, { y: 180 }], { bottomY: 200, topY: 0 }, 35)).toBe(
      "up",
    );
    expect(getVisibleBeamStemDirection([{ y: 10 }, { y: 70 }], { bottomY: 90, topY: 0 }, 35)).toBe(
      "down",
    );
  });

  it("leaves the direction open when both sides have enough room", () => {
    expect(getVisibleBeamStemDirection([{ y: 50 }, { y: 75 }], { bottomY: 200, topY: 0 }, 35)).toBeUndefined();
  });

  it("optimizes total stem length for a cross-staff beam", () => {
    expect(getCrossStaffOuterStemDirection([{ y: 50 }, { y: 55 }, { y: 60 }, { y: 75 }])).toBe("up");
    expect(getCrossStaffOuterStemDirection([{ y: 50 }, { y: 65 }, { y: 70 }, { y: 75 }])).toBe("down");
  });
});
