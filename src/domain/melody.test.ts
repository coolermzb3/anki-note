import { describe, expect, it } from "vitest";
import { getNotesForGroups } from "./notes";
import { selectMelodyNotes } from "./melody";

function rngFrom(values: number[]): () => number {
  let index = 0;
  return () => values[index++] ?? values[values.length - 1] ?? 0;
}

describe("melody generator", () => {
  it("generates the requested count inside the enabled practice range", () => {
    const notes = getNotesForGroups(["G3-F4"], false);
    const selected = selectMelodyNotes({
      notes,
      count: 12,
      rng: rngFrom([0.2, 0.4, 0.7, 0.1, 0.9, 0.3]),
    });

    expect(selected).toHaveLength(12);
    expect(selected.every((note) => note.groupId === "G3-F4")).toBe(true);
  });

  it("cadences phrase endings on stable notes", () => {
    const notes = getNotesForGroups(["G3-F4"], false);
    const selected = selectMelodyNotes({
      notes,
      count: 8,
      rng: rngFrom([0.1]),
    });

    expect(["C", "G"]).toContain(selected[7].noteName);
  });

  it("recovers a large leap by moving back in the opposite direction", () => {
    const notes = getNotesForGroups(["G3-F4"], false);
    const selected = selectMelodyNotes({
      notes,
      count: 4,
      rng: rngFrom([0, 0, 0.96, 0.9, 0.9, 0, 0]),
    });

    expect(selected.slice(0, 3).map((note) => note.noteName)).toEqual(["G", "E", "D"]);
  });
});
