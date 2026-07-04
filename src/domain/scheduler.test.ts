import { describe, expect, it } from "vitest";
import { getNotesForGroups } from "./notes";
import { getFocusedTrainingNotes, getNoteWeight, selectNextNote, selectNotePage } from "./scheduler";
import { makeReview } from "./testFactories";

function makeDifferentiatedFocusedTrainingData() {
  const notes = getNotesForGroups(["C5-B5"]);
  const activeMsByNote = {
    C5: 3200,
    D5: 2800,
    E5: 2100,
    F5: 1800,
    G5: 900,
    A5: 850,
    B5: 800,
  } as const;
  const reviews = notes.flatMap((note) =>
    Array.from({ length: 5 }, () =>
      makeReview({
        targetNoteId: note.id,
        activeMs: activeMsByNote[note.id as keyof typeof activeMsByNote],
        wrongAnswers:
          note.id === "C5" || note.id === "D5"
            ? [{ noteName: "E", atActiveMs: 1000 }]
            : [],
      }),
    ),
  );
  return { notes, reviews };
}

describe("scheduler", () => {
  it("does not repeat the previous target when alternatives exist", () => {
    const notes = getNotesForGroups(["C5-B5"]);
    const selected = selectNextNote({
      notes,
      reviews: [],
      lastTargetNoteId: "C5",
      newCardRate: 0,
      rng: () => 0,
    });
    expect(selected.id).not.toBe("C5");
  });

  it("raises weight for slow and error-prone recent reviews", () => {
    const notes = getNotesForGroups(["C5-B5"]);
    const c5 = notes.find((note) => note.id === "C5")!;
    const d5 = notes.find((note) => note.id === "D5")!;
    const reviews = [
      makeReview({ targetNoteId: "C5", activeMs: 3200, wrongAnswers: [{ noteName: "D", atActiveMs: 900 }] }),
      makeReview({ targetNoteId: "C5", activeMs: 2800, wrongAnswers: [{ noteName: "E", atActiveMs: 1200 }] }),
      makeReview({ targetNoteId: "D5", activeMs: 900 }),
      makeReview({ targetNoteId: "D5", activeMs: 850 }),
    ];

    expect(getNoteWeight(c5, reviews)).toBeGreaterThan(getNoteWeight(d5, reviews));
  });

  it("can reserve draws for least-seen cards", () => {
    const notes = getNotesForGroups(["C5-B5"]);
    const selected = selectNextNote({
      notes,
      reviews: [makeReview({ targetNoteId: "C5" })],
      newCardRate: 1,
      rng: () => 0,
    });
    expect(selected.id).not.toBe("C5");
  });

  it("uses planned page exposure while drawing a page", () => {
    const notes = getNotesForGroups(["C5-B5"]).slice(0, 3);

    const selected = selectNotePage({
      notes,
      reviews: [],
      count: 3,
      newCardRate: 1,
      rng: () => 0,
    });

    expect(selected.map((note) => note.id)).toEqual(["C5", "D5", "E5"]);
  });

  it("uses the requested page size", () => {
    const notes = getNotesForGroups(["C5-B5"]);

    expect(selectNotePage({ notes, reviews: [], count: 5 })).toHaveLength(5);
  });

  it("keeps the weaker half for focused training", () => {
    const { notes, reviews } = makeDifferentiatedFocusedTrainingData();

    expect(getFocusedTrainingNotes(notes, reviews).map((note) => note.id)).toEqual(["C5", "D5", "E5", "F5"]);
  });

  it("usually draws from the focused pool with the focused strategy", () => {
    const { notes, reviews } = makeDifferentiatedFocusedTrainingData();
    const rngValues = [0, 0.5, 0.99];
    const selected = selectNextNote({
      notes,
      reviews,
      queueStrategy: "focused",
      newCardRate: 0,
      rng: () => rngValues.shift() ?? 0,
    });

    expect(selected.id).toBe("F5");
  });

  it("keeps focusedTraining as a compatibility alias for the focused strategy", () => {
    const { notes, reviews } = makeDifferentiatedFocusedTrainingData();
    const rngValues = [0, 0.5, 0.99];
    const selected = selectNextNote({
      notes,
      reviews,
      focusedTraining: true,
      newCardRate: 0,
      rng: () => rngValues.shift() ?? 0,
    });

    expect(selected.id).toBe("F5");
  });

  it("routes melody strategy through a generated pitch sequence", () => {
    const notes = getNotesForGroups(["C4-B4"], false);
    const rngValues = [0, 0];
    const selected = selectNextNote({
      notes,
      reviews: [],
      queueStrategy: "melody",
      lastTargetNoteId: "C4",
      rng: () => rngValues.shift() ?? 0,
    });

    expect(selected.id).toBe("D4");
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

    expect(selected.id).toBe("B5");
  });

  it("falls back to every note when focused training has no differentiating data", () => {
    const notes = getNotesForGroups(["C5-B5"]);

    expect(getFocusedTrainingNotes(notes, [])).toEqual(notes);
  });

  it("keeps at least three notes for focused training", () => {
    const notes = getNotesForGroups(["C5-B5"]).slice(0, 4);
    const reviews = [
      makeReview({ targetNoteId: "C5", activeMs: 3000, wrongAnswers: [{ noteName: "D", atActiveMs: 1000 }] }),
      makeReview({ targetNoteId: "D5", activeMs: 2200 }),
      makeReview({ targetNoteId: "E5", activeMs: 900 }),
      makeReview({ targetNoteId: "F5", activeMs: 800 }),
    ];

    const focused = getFocusedTrainingNotes(notes, reviews).map((note) => note.id);
    expect(focused.length).toBeGreaterThanOrEqual(3);
    expect(focused).toContain("C5");
    expect(focused).toContain("D5");
    expect(focused).toContain("E5");
  });
});
