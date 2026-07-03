import { describe, expect, it } from "vitest";
import { getNotesForGroups } from "./notes";
import { getFocusedTrainingNotes, getNoteWeight, selectNextNote } from "./scheduler";
import { makeReview } from "./testFactories";

function makeDifferentiatedFocusedTrainingData() {
  const notes = getNotesForGroups(["C4-B4"]);
  const activeMsByNote = {
    C4: 3200,
    D4: 2800,
    E4: 2100,
    F4: 1800,
    G4: 900,
    A4: 850,
    B4: 800,
  } as const;
  const reviews = notes.flatMap((note) =>
    Array.from({ length: 5 }, () =>
      makeReview({
        targetNoteId: note.id,
        activeMs: activeMsByNote[note.id as keyof typeof activeMsByNote],
        wrongAnswers:
          note.id === "C4" || note.id === "D4"
            ? [{ noteName: "E", atActiveMs: 1000 }]
            : [],
      }),
    ),
  );
  return { notes, reviews };
}

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

  it("keeps the weaker half for focused training", () => {
    const { notes, reviews } = makeDifferentiatedFocusedTrainingData();

    expect(getFocusedTrainingNotes(notes, reviews).map((note) => note.id)).toEqual(["C4", "D4", "E4", "F4"]);
  });

  it("usually draws from the focused pool during focused training", () => {
    const { notes, reviews } = makeDifferentiatedFocusedTrainingData();
    const rngValues = [0, 0.5, 0.99];
    const selected = selectNextNote({
      notes,
      reviews,
      focusedTraining: true,
      newCardRate: 0,
      rng: () => rngValues.shift() ?? 0,
    });

    expect(selected.id).toBe("F4");
  });

  it("keeps some full-pool exploration during focused training", () => {
    const { notes, reviews } = makeDifferentiatedFocusedTrainingData();
    const rngValues = [0.95, 0.5, 0.99];
    const selected = selectNextNote({
      notes,
      reviews,
      focusedTraining: true,
      newCardRate: 0,
      rng: () => rngValues.shift() ?? 0,
    });

    expect(selected.id).toBe("B4");
  });

  it("falls back to every note when focused training has no differentiating data", () => {
    const notes = getNotesForGroups(["C4-B4"]);

    expect(getFocusedTrainingNotes(notes, [])).toEqual(notes);
  });

  it("keeps at least three notes for focused training", () => {
    const notes = getNotesForGroups(["C4-B4"]).slice(0, 4);
    const reviews = [
      makeReview({ targetNoteId: "C4", activeMs: 3000, wrongAnswers: [{ noteName: "D", atActiveMs: 1000 }] }),
      makeReview({ targetNoteId: "D4", activeMs: 2200 }),
      makeReview({ targetNoteId: "E4", activeMs: 900 }),
      makeReview({ targetNoteId: "F4", activeMs: 800 }),
    ];

    const focused = getFocusedTrainingNotes(notes, reviews).map((note) => note.id);
    expect(focused.length).toBeGreaterThanOrEqual(3);
    expect(focused).toContain("C4");
    expect(focused).toContain("D4");
    expect(focused).toContain("E4");
  });
});
