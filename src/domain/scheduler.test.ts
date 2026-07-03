import { describe, expect, it } from "vitest";
import { getNotesForGroups } from "./notes";
import { getNoteWeight, selectNextNote } from "./scheduler";
import { makeReview } from "./testFactories";

describe("scheduler", () => {
  it("does not repeat the previous target when alternatives exist", () => {
    const notes = getNotesForGroups(["C4-B4"]);
    const selected = selectNextNote({
      notes,
      reviews: [],
      lastTargetNoteId: "C4",
      newCardRate: 0,
      rng: () => 0,
    });
    expect(selected.id).not.toBe("C4");
  });

  it("raises weight for slow and error-prone recent reviews", () => {
    const notes = getNotesForGroups(["C4-B4"]);
    const c4 = notes.find((note) => note.id === "C4")!;
    const d4 = notes.find((note) => note.id === "D4")!;
    const reviews = [
      makeReview({ targetNoteId: "C4", activeMs: 3200, wrongAnswers: [{ noteName: "D", atActiveMs: 900 }] }),
      makeReview({ targetNoteId: "C4", activeMs: 2800, wrongAnswers: [{ noteName: "E", atActiveMs: 1200 }] }),
      makeReview({ targetNoteId: "D4", activeMs: 900 }),
      makeReview({ targetNoteId: "D4", activeMs: 850 }),
    ];

    expect(getNoteWeight(c4, reviews)).toBeGreaterThan(getNoteWeight(d4, reviews));
  });

  it("can reserve draws for least-seen cards", () => {
    const notes = getNotesForGroups(["C4-B4"]);
    const selected = selectNextNote({
      notes,
      reviews: [makeReview({ targetNoteId: "C4" })],
      newCardRate: 1,
      rng: () => 0,
    });
    expect(selected.id).not.toBe("C4");
  });
});
