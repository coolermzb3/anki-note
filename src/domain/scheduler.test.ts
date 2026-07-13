import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { getNotesForGroups } from "./notes";
import {
  getAdaptiveNotePerformance,
  getAdaptiveTierWeights,
  selectNextNote,
  selectNotePage,
} from "./scheduler";
import { makeReview } from "./testFactories";
import { buildTargetNoteSetKey } from "./targetNoteSet";
import type { PracticeSessionRecordV2, ReviewRecord, TargetNote, TargetNoteId } from "./types";

function reviewsFor(note: TargetNote, count: number, activeMs: number, sessionId = "session-1"): ReviewRecord[] {
  return Array.from({ length: count }, (_, index) => makeReview({
    activeMs,
    answeredAt: `2026-07-04T12:${String(Math.floor(index / 60)).padStart(2, "0")}:${String(index % 60).padStart(2, "0")}.000+08:00`,
    endedAt: `2026-07-04T12:${String(Math.floor(index / 60)).padStart(2, "0")}:${String(index % 60).padStart(2, "0")}.000+08:00`,
    id: `${note.id}-${index}`,
    sessionId,
    startedAt: `2026-07-04T12:${String(Math.floor(index / 60)).padStart(2, "0")}:${String(index % 60).padStart(2, "0")}.000+08:00`,
    targetNoteId: note.id,
  }));
}

function makeSession(notes: TargetNote[], id = "session-1"): PracticeSessionRecordV2 {
  return {
    completedCount: 0,
    drillNoteNames: [],
    effectiveQueueAlgorithm: "adaptive-v1",
    enabledGroupIds: ["G4-F5"],
    focusedTraining: false,
    id,
    mode: "open-ended",
    promptDisplayMode: "single-note",
    queueStrategy: "adaptive",
    schemaVersion: 2,
    staffNotationMode: "grand",
    startedAt: "2026-07-04T12:00:00.000+08:00",
    targetNoteSetKey: buildTargetNoteSetKey(notes.map((note) => note.id)),
    interruptedCount: 0,
  };
}

describe("adaptive-v2 scheduler", () => {
  it("matches the shared adjusted-score and tier-weight fixtures", () => {
    const cases = JSON.parse(
      readFileSync(new URL("../../analysis/fixtures/adaptive_v2_tiers.json", import.meta.url), "utf8"),
    ) as Array<{
      adjustedMedianMs: Record<string, number>;
      notes: Array<{ count: number; id: string; medianMs: number }>;
      weights: Record<string, number>;
    }>;

    for (const fixture of cases) {
      const notes = fixture.notes.map((entry) => ({
        groupId: "G4-F5" as const,
        id: entry.id as TargetNoteId,
        isInterStaffLedgerSpelling: false,
        noteName: entry.id as TargetNote["noteName"],
        octave: 4 as const,
        pitchId: `${entry.id}4` as TargetNote["pitchId"],
        staff: "treble" as const,
      }));
      const reviews = fixture.notes.flatMap((entry, index) =>
        reviewsFor(notes[index], entry.count, entry.medianMs, `fixture-${index}`),
      );
      const performance = getAdaptiveNotePerformance(notes, reviews);
      const weights = getAdaptiveTierWeights(notes, performance);

      expect(Object.fromEntries(notes.map((note) => [note.id, performance.get(note.id)?.adjustedMedianMs]))).toEqual(
        fixture.adjustedMedianMs,
      );
      expect(Object.fromEntries(notes.map((note) => [note.id, weights.get(note.id)]))).toEqual(fixture.weights);
    }
  });

  it("avoids only the exact previous target", () => {
    const notes = getNotesForGroups(["G3-F4", "G4-F5"], false).filter((note) => note.noteName === "C");

    const selected = selectNextNote({ notes, reviews: [], lastTargetNoteId: notes[0].id, rng: () => 0 });

    expect(selected.id).toBe(notes[1].id);
    expect(selected.noteName).toBe("C");
  });

  it("uses only the latest 100 eligible durations without clamping", () => {
    const [note] = getNotesForGroups(["G4-F5"], false);
    const reviews = [
      ...reviewsFor(note, 1, 99_000),
      ...reviewsFor(note, 100, 800).map((review, index) => ({ ...review, id: `recent-${index}`, answeredAt: `2026-07-05T12:${String(Math.floor(index / 60)).padStart(2, "0")}:${String(index % 60).padStart(2, "0")}.000+08:00` })),
    ];

    expect(getAdaptiveNotePerformance([note], reviews).get(note.id)).toMatchObject({
      eligibleReviewCount: 101,
      recentMedianMs: 800,
    });
  });

  it("shrinks five-review medians fully to the shared prior", () => {
    const notes = getNotesForGroups(["G4-F5"], false).slice(0, 3);
    const reviews = [
      ...reviewsFor(notes[0], 5, 1000),
      ...reviewsFor(notes[1], 5, 2000),
      ...reviewsFor(notes[2], 100, 3000),
    ];
    const performance = getAdaptiveNotePerformance(notes, reviews);

    expect(performance.get(notes[0].id)?.adjustedMedianMs).toBe(2000);
    expect(performance.get(notes[1].id)?.adjustedMedianMs).toBe(2000);
    expect(performance.get(notes[2].id)?.adjustedMedianMs).toBe(3000);
  });

  it("averages slot weights when a tie crosses tier boundaries", () => {
    const notes = getNotesForGroups(["G4-F5"], false).slice(0, 4);
    const reviews = [
      ...reviewsFor(notes[0], 100, 4000),
      ...reviewsFor(notes[1], 100, 3000),
      ...reviewsFor(notes[2], 100, 3000),
      ...reviewsFor(notes[3], 100, 1000),
    ];
    const weights = getAdaptiveTierWeights(notes, getAdaptiveNotePerformance(notes, reviews));

    expect(notes.map((note) => weights.get(note.id))).toEqual([5, 4, 4, 2]);
  });

  it("balances a broadly new set until every target reaches five", () => {
    const notes = getNotesForGroups(["G4-F5"], false).slice(0, 3);

    const selected = selectNotePage({ notes, reviews: [], count: 15, rng: () => 0 });
    const counts = new Map(notes.map((note) => [note.id, selected.filter((draw) => draw.id === note.id).length]));

    expect([...counts.values()]).toEqual([5, 5, 5]);
  });

  it("uses the newcomer channel only for targets below five reviews", () => {
    const notes = getNotesForGroups(["G4-F5"], false).slice(0, 3);
    const reviews = [
      ...reviewsFor(notes[0], 100, 3000),
      ...reviewsFor(notes[1], 100, 1000),
    ];
    const rngValues = [0.1, 0];

    expect(selectNextNote({ notes, reviews, rng: () => rngValues.shift() ?? 0 }).id).toBe(notes[2].id);
  });

  it("does not add an explicit penalty for wrong answers", () => {
    const notes = getNotesForGroups(["G4-F5"], false).slice(0, 2);
    const clean = reviewsFor(notes[0], 100, 1200);
    const errorProne = reviewsFor(notes[1], 100, 1200).map((review) => ({
      ...review,
      wrongAnswers: [{ atActiveMs: 200, noteName: "C" as const }],
    }));
    const weights = getAdaptiveTierWeights(notes, getAdaptiveNotePerformance(notes, [...clean, ...errorProne]));

    expect(weights.get(notes[0].id)).toBe(weights.get(notes[1].id));
  });

  it("drains a mature target once its eligible question gap reaches 90", () => {
    const notes = getNotesForGroups(["G4-F5"], false).slice(0, 2);
    const earlier = reviewsFor(notes[1], 5, 1000);
    const later = reviewsFor(notes[0], 90, 1000).map((review, index) => ({
      ...review,
      answeredAt: `2026-07-05T12:${String(Math.floor(index / 60)).padStart(2, "0")}:${String(index % 60).padStart(2, "0")}.000+08:00`,
      endedAt: `2026-07-05T12:${String(Math.floor(index / 60)).padStart(2, "0")}:${String(index % 60).padStart(2, "0")}.000+08:00`,
      id: `later-${index}`,
    }));

    expect(selectNextNote({
      notes,
      reviews: [...earlier, ...later],
      sessions: [makeSession(notes)],
      lastTargetNoteId: notes[0].id,
      rng: () => 0,
    }).id).toBe(notes[1].id);
  });

  it("does not infer maintenance debt from history without a target-set snapshot", () => {
    const notes = getNotesForGroups(["G4-F5"], false).slice(0, 2);
    const reviews = [
      ...reviewsFor(notes[0], 100, 3000, "missing"),
      ...reviewsFor(notes[1], 5, 1000, "missing"),
    ];

    const selected = selectNextNote({ notes, reviews, sessions: [], rng: () => 0.99 });

    expect(notes.map((note) => note.id)).toContain(selected.id as TargetNoteId);
  });

  it("does not advance a target's maintenance gap while that target is disabled", () => {
    const notes = getNotesForGroups(["G4-F5"], false).slice(0, 3);
    const initial = [
      ...reviewsFor(notes[1], 5, 1000, "initial"),
      ...reviewsFor(notes[2], 5, 3000, "initial"),
    ];
    const disabledPeriod = reviewsFor(notes[0], 90, 1000, "only-first").map((review, index) => ({
      ...review,
      answeredAt: `2026-07-05T12:${String(Math.floor(index / 60)).padStart(2, "0")}:${String(index % 60).padStart(2, "0")}.000+08:00`,
      endedAt: `2026-07-05T12:${String(Math.floor(index / 60)).padStart(2, "0")}:${String(index % 60).padStart(2, "0")}.000+08:00`,
      id: `disabled-${index}`,
    }));

    const selected = selectNextNote({
      notes,
      reviews: [...initial, ...disabledPeriod],
      sessions: [makeSession(notes, "initial"), makeSession([notes[0]], "only-first")],
      lastTargetNoteId: notes[0].id,
      rng: () => 0.99,
    });

    expect(selected.id).toBe(notes[2].id);
  });

  it("routes melody generation separately", () => {
    const notes = getNotesForGroups(["G3-F4"], false);
    const rngValues = [0, 0];

    expect(selectNextNote({
      notes,
      reviews: [],
      queueStrategy: "melody",
      lastTargetNoteId: "C4",
      rng: () => rngValues.shift() ?? 0,
    }).id).toBe("B3");
  });
});
