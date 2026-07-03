import { describe, expect, it } from "vitest";
import { ALL_NOTES, ANSWER_BUTTONS, DEFAULT_ENABLED_GROUPS, PRACTICE_GROUPS } from "./notes";

describe("notes", () => {
  it("builds the 35 natural-note cards from C2 through B6", () => {
    expect(ALL_NOTES).toHaveLength(35);
    expect(ALL_NOTES[0].id).toBe("C4");
    expect(ALL_NOTES.map((note) => note.id)).toContain("C2");
    expect(ALL_NOTES.map((note) => note.id)).toContain("B6");
  });

  it("orders practice groups from the middle outward", () => {
    expect(PRACTICE_GROUPS.map((group) => group.id)).toEqual(["C4-B4", "C3-B3", "C5-B5", "C2-B2", "C6-B6"]);
    expect(DEFAULT_ENABLED_GROUPS).toEqual(["C4-B4"]);
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
