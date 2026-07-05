import { describe, expect, it } from "vitest";
import { getNotesForGroups } from "./notes";
import { getFocusedTrainingNotes, getNotePerformance, getNoteWeight, selectNextNote, selectNotePage } from "./scheduler";
import { makeReview } from "./testFactories";

function startedAtForMinute(minute: number): string {
  return `2026-07-04T12:${String(minute).padStart(2, "0")}:00.000+08:00`;
}

function makeDifferentiatedFocusedTrainingData() {
  const notes = getNotesForGroups(["G4-F5"], false);
  const activeMsByNote = {
    G4: 3200,
    A4: 2800,
    B4: 2100,
    C5: 1800,
    D5: 900,
    E5: 850,
    F5: 800,
  } as const;
  const reviews = notes.flatMap((note) =>
    Array.from({ length: 5 }, () =>
      makeReview({
        targetNoteId: note.id,
        activeMs: activeMsByNote[note.id as keyof typeof activeMsByNote],
        wrongAnswers:
          note.id === "G4" || note.id === "A4"
            ? [{ noteName: "E", atActiveMs: 1000 }]
            : [],
      }),
    ),
  );
  return { notes, reviews };
}

describe("scheduler", () => {
  it("does not repeat the previous target when alternatives exist", () => {
    const notes = getNotesForGroups(["G4-F5"], false);
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
    const notes = getNotesForGroups(["G4-F5"], false);
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

  it("ignores ignored reviews when calculating note weights", () => {
    const notes = getNotesForGroups(["G4-F5"], false);
    const c5 = notes.find((note) => note.id === "C5")!;
    const reviews = [
      makeReview({ targetNoteId: "C5", activeMs: 9000, wrongAnswers: [{ noteName: "D", atActiveMs: 900 }], ignored: true }),
    ];

    expect(getNoteWeight(c5, reviews)).toBe(getNoteWeight(c5, []));
  });

  it("uses the latest 20 qualified reviews for recent median performance", () => {
    const notes = getNotesForGroups(["G4-F5"], false);
    const c5 = notes.find((note) => note.id === "C5")!;
    const reviews = [
      ...Array.from({ length: 11 }, (_, index) =>
        makeReview({ targetNoteId: "C5", activeMs: 3000, startedAt: startedAtForMinute(index) }),
      ),
      ...Array.from({ length: 9 }, (_, index) =>
        makeReview({ targetNoteId: "C5", activeMs: 900, startedAt: startedAtForMinute(index + 11) }),
      ),
    ];

    expect(getNotePerformance(c5, reviews).recentMedianMs).toBe(3000);
  });

  it("can reserve draws for least-seen cards", () => {
    const notes = getNotesForGroups(["G4-F5"], false);
    const selected = selectNextNote({
      notes,
      reviews: [makeReview({ targetNoteId: "C5" })],
      newCardRate: 1,
      rng: () => 0,
    });
    expect(selected.id).not.toBe("C5");
  });

  it("uses planned page exposure while drawing a page", () => {
    const notes = getNotesForGroups(["G4-F5"], false).slice(0, 3);

    const selected = selectNotePage({
      notes,
      reviews: [],
      count: 3,
      newCardRate: 1,
      rng: () => 0,
    });

    expect(selected.map((note) => note.id)).toEqual(["G4", "A4", "B4"]);
  });

  it("uses the requested page size", () => {
    const notes = getNotesForGroups(["G4-F5"], false);

    expect(selectNotePage({ notes, reviews: [], count: 5 })).toHaveLength(5);
  });

  it("keeps the weaker half for focused training", () => {
    const { notes, reviews } = makeDifferentiatedFocusedTrainingData();

    expect(getFocusedTrainingNotes(notes, reviews).map((note) => note.id)).toEqual(["G4", "A4", "B4", "C5"]);
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

    expect(selected.id).toBe("C5");
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

    expect(selected.id).toBe("C5");
  });

  it("routes melody strategy through a generated pitch sequence", () => {
    const notes = getNotesForGroups(["G3-F4"], false);
    const rngValues = [0, 0];
    const selected = selectNextNote({
      notes,
      reviews: [],
      queueStrategy: "melody",
      lastTargetNoteId: "C4",
      rng: () => rngValues.shift() ?? 0,
    });

    expect(selected.id).toBe("B3");
  });

  it("restricts note drill draws to the selected note names", () => {
    const notes = getNotesForGroups(["G3-F4", "G4-F5"], false);
    const selected = selectNotePage({
      notes,
      reviews: [],
      queueStrategy: "note-drill",
      drillNoteNames: ["C"],
      count: 4,
      newCardRate: 1,
      rng: () => 0,
    });

    expect(selected.every((note) => note.noteName === "C")).toBe(true);
    expect(new Set(selected.map((note) => note.octave))).toEqual(new Set([4, 5]));
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

    expect(selected.id).toBe("F5");
  });

  it("falls back to every note when focused training has no differentiating data", () => {
    const notes = getNotesForGroups(["G4-F5"], false);

    expect(getFocusedTrainingNotes(notes, [])).toEqual(notes);
  });

  it("keeps at least three notes for focused training", () => {
    const notes = getNotesForGroups(["G4-F5"], false).slice(0, 4);
    const reviews = [
      makeReview({ targetNoteId: "G4", activeMs: 3000, wrongAnswers: [{ noteName: "D", atActiveMs: 1000 }] }),
      makeReview({ targetNoteId: "A4", activeMs: 2200 }),
      makeReview({ targetNoteId: "B4", activeMs: 900 }),
      makeReview({ targetNoteId: "C5", activeMs: 800 }),
    ];

    const focused = getFocusedTrainingNotes(notes, reviews).map((note) => note.id);
    expect(focused.length).toBeGreaterThanOrEqual(3);
    expect(focused).toContain("G4");
    expect(focused).toContain("A4");
    expect(focused).toContain("B4");
  });
});
