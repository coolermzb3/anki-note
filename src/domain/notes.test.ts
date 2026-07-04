import { describe, expect, it } from "vitest";
import {
  ALL_NOTES,
  ANSWER_BUTTONS,
  DEFAULT_ENABLED_GROUPS,
  formatTargetNoteLabel,
  getNoteById,
  getNotesForGroups,
  PRACTICE_GROUPS,
} from "./notes";

describe("notes", () => {
  it("builds the natural-note cards from C2 through B6 with split ledger variants", () => {
    expect(ALL_NOTES).toHaveLength(46);
    expect(ALL_NOTES[0].id).toBe("C4");
    expect(ALL_NOTES.map((note) => note.id)).toContain("C2");
    expect(ALL_NOTES.map((note) => note.id)).toContain("B6");
    expect(ALL_NOTES.map((note) => note.id)).toContain("E3-treble");
    expect(ALL_NOTES.map((note) => note.id)).toContain("C4-bass");
    expect(ALL_NOTES.map((note) => note.id)).toContain("A4-bass");
    expect(ALL_NOTES.map((note) => note.id)).not.toContain("D3-treble");
    expect(ALL_NOTES.map((note) => note.id)).not.toContain("B4-bass");
  });

  it("orders practice groups from the middle outward", () => {
    expect(PRACTICE_GROUPS.map((group) => group.id)).toEqual(["C4-B4", "C3-B3", "C5-B5", "C2-B2", "C6-B6"]);
    expect(DEFAULT_ENABLED_GROUPS).toEqual(["C4-B4"]);
  });

  it("keeps overlap variants in their octave-sized practice groups", () => {
    expect(PRACTICE_GROUPS.find((group) => group.id === "C3-B3")?.notes).toHaveLength(12);
    expect(PRACTICE_GROUPS.find((group) => group.id === "C4-B4")?.notes).toHaveLength(13);
    expect(PRACTICE_GROUPS.find((group) => group.id === "C5-B5")?.notes).toHaveLength(7);
  });

  it("can exclude the added ledger variants from enabled practice groups", () => {
    expect(getNotesForGroups(["C4-B4"])).toHaveLength(13);
    expect(getNotesForGroups(["C4-B4"], false).map((note) => note.id)).toEqual([
      "C4",
      "D4",
      "E4",
      "F4",
      "G4",
      "A4",
      "B4",
    ]);
  });

  it("labels ledger variants by pitch and staff", () => {
    expect(formatTargetNoteLabel(getNoteById("E3"))).toBe("E3 · 低音谱号");
    expect(formatTargetNoteLabel(getNoteById("E3-treble"))).toBe("E3 · 高音谱号");
    expect(formatTargetNoteLabel(getNoteById("C2"))).toBe("C2");
  });

  it("maps numeric answer buttons to absolute natural note names", () => {
    expect(ANSWER_BUTTONS.map((button) => `${button.key}:${button.noteName}`)).toEqual([
      "1:C",
      "2:D",
      "3:E",
      "4:F",
      "5:G",
      "6:A",
      "7:B",
    ]);
  });
});
