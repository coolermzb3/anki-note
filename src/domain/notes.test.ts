import { describe, expect, it } from "vitest";
import {
  ALL_NOTES,
  ANSWER_BUTTONS,
  DEFAULT_ENABLED_GROUPS,
  formatTargetNoteLabel,
  getCurrentTargetNoteIdsForGroups,
  getNoteById,
  getNotesForGroups,
  normalizePracticeGroupIds,
  PRACTICE_GROUPS,
} from "./notes";

describe("notes", () => {
  it("builds the natural-note cards from F1 through G6 with inter-staff ledger spellings", () => {
    expect(ALL_NOTES).toHaveLength(48);
    expect(ALL_NOTES[0].id).toBe("F1");
    expect(ALL_NOTES.map((note) => note.id)).toContain("F1");
    expect(ALL_NOTES.map((note) => note.id)).toContain("C2");
    expect(ALL_NOTES.map((note) => note.id)).toContain("G6");
    expect(ALL_NOTES.map((note) => note.id)).toContain("E3-treble");
    expect(ALL_NOTES.map((note) => note.id)).toContain("C4-bass");
    expect(ALL_NOTES.map((note) => note.id)).toContain("A4-bass");
    expect(ALL_NOTES.map((note) => note.id)).not.toContain("A6");
    expect(ALL_NOTES.map((note) => note.id)).not.toContain("B6");
    expect(ALL_NOTES.map((note) => note.id)).not.toContain("D3-treble");
    expect(ALL_NOTES.map((note) => note.id)).not.toContain("B4-bass");
  });

  it("orders practice groups from low to high while defaulting to the middle group", () => {
    expect(PRACTICE_GROUPS.map((group) => group.id)).toEqual(["F1-F2", "G2-F3", "G3-F4", "G4-F5", "G5-G6"]);
    expect(DEFAULT_ENABLED_GROUPS).toEqual(["G3-F4"]);
  });

  it("keeps inter-staff ledger spellings in their pitch-range practice groups", () => {
    expect(PRACTICE_GROUPS.find((group) => group.id === "F1-F2")?.notes).toHaveLength(8);
    expect(PRACTICE_GROUPS.find((group) => group.id === "G2-F3")?.notes).toHaveLength(9);
    expect(PRACTICE_GROUPS.find((group) => group.id === "G3-F4")?.notes).toHaveLength(14);
    expect(PRACTICE_GROUPS.find((group) => group.id === "G4-F5")?.notes).toHaveLength(9);
    expect(PRACTICE_GROUPS.find((group) => group.id === "G5-G6")?.notes).toHaveLength(8);
  });

  it("can exclude the added inter-staff ledger spellings from enabled practice groups", () => {
    expect(getNotesForGroups(["G4-F5"])).toHaveLength(9);
    expect(getNotesForGroups(["G4-F5"], false).map((note) => note.id)).toEqual([
      "G4",
      "A4",
      "B4",
      "C5",
      "D5",
      "E5",
      "F5",
    ]);
  });

  it("labels inter-staff ledger spellings by pitch and staff", () => {
    expect(formatTargetNoteLabel(getNoteById("E3"))).toBe("E3 · 低音谱号");
    expect(formatTargetNoteLabel(getNoteById("E3-treble"))).toBe("E3 · 高音谱号");
    expect(formatTargetNoteLabel(getNoteById("C2"))).toBe("C2");
  });

  it("normalizes persisted group ids to the current low-to-high groups", () => {
    expect(normalizePracticeGroupIds(["C2-B2", "C4-B4", "C6-B6"])).toEqual(["F1-F2", "G3-F4", "G5-G6"]);
    expect(normalizePracticeGroupIds(["G4-F5", "F1-F2"])).toEqual(["F1-F2", "G4-F5"]);
    expect(normalizePracticeGroupIds([])).toEqual(["G3-F4"]);
    expect(normalizePracticeGroupIds(["unknown"])).toEqual(["G3-F4"]);
  });

  it("can collect current target note ids for group filtering", () => {
    const noteIds = getCurrentTargetNoteIdsForGroups(["G3-F4"]);
    expect(noteIds.has("C4")).toBe(true);
    expect(noteIds.has("C4-bass")).toBe(true);
    expect(noteIds.has("A6")).toBe(false);
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
