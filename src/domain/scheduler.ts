import { selectMelodyNotes, type MelodyGenerationState } from "./melody";
import { isStatisticalReview } from "./reviews";
import type { NoteName, PracticeQueueStrategy, ReviewRecord, TargetNote, TargetNoteId } from "./types";

export interface SelectNextNoteOptions {
  notes: TargetNote[];
  reviews: ReviewRecord[];
  lastTargetNoteId?: TargetNoteId;
  plannedTargetNoteIds?: TargetNoteId[];
  newCardRate?: number;
  queueStrategy?: PracticeQueueStrategy;
  drillNoteNames?: NoteName[];
  focusedTraining?: boolean;
  focusedTrainingRate?: number;
  rng?: () => number;
  melodyState?: MelodyGenerationState;
}

interface NotePerformance {
  exposure: number;
  recentMedianMs?: number;
  errorRate: number;
}

const RECENT_PERFORMANCE_REVIEW_LIMIT = 20;

function qualifiedReviewsFor(note: TargetNote, reviews: ReviewRecord[]): ReviewRecord[] {
  return reviews
    .filter((review) => review.targetNoteId === note.id && isStatisticalReview(review))
    .sort((a, b) => a.startedAt.localeCompare(b.startedAt));
}

function plannedExposureFor(note: TargetNote, plannedTargetNoteIds: TargetNoteId[]): number {
  return plannedTargetNoteIds.filter((targetNoteId) => targetNoteId === note.id).length;
}

function median(values: number[]): number | undefined {
  if (values.length === 0) {
    return undefined;
  }
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) {
    return sorted[mid];
  }
  return (sorted[mid - 1] + sorted[mid]) / 2;
}

export function getNotePerformance(
  note: TargetNote,
  reviews: ReviewRecord[],
  plannedTargetNoteIds: TargetNoteId[] = [],
): NotePerformance {
  const qualified = qualifiedReviewsFor(note, reviews);
  const recent = qualified.slice(-RECENT_PERFORMANCE_REVIEW_LIMIT);
  const reviewsWithErrors = qualified.filter((review) => review.wrongAnswers.length > 0).length;
  return {
    exposure: qualified.length + plannedExposureFor(note, plannedTargetNoteIds),
    recentMedianMs: median(recent.map((review) => review.activeMs)),
    errorRate: qualified.length === 0 ? 0 : reviewsWithErrors / qualified.length,
  };
}

export function getNoteWeight(note: TargetNote, reviews: ReviewRecord[], plannedTargetNoteIds: TargetNoteId[] = []): number {
  const performance = getNotePerformance(note, reviews, plannedTargetNoteIds);
  const newCardReward = Math.max(0, 2 - performance.exposure * 0.4);
  const slowPenalty =
    performance.recentMedianMs === undefined ? 0 : Math.max(0, Math.min(3, (performance.recentMedianMs - 1400) / 1000));
  const errorPenalty = performance.errorRate * 3;
  return 1 + newCardReward + slowPenalty + errorPenalty;
}

export function getFocusedTrainingNotes(
  notes: TargetNote[],
  reviews: ReviewRecord[],
  plannedTargetNoteIds: TargetNoteId[] = [],
): TargetNote[] {
  if (notes.length <= 3) {
    return notes;
  }

  const weighted = notes
    .map((note) => ({ note, weight: getNoteWeight(note, reviews, plannedTargetNoteIds) }))
    .sort((a, b) => b.weight - a.weight || a.note.id.localeCompare(b.note.id));
  const highest = weighted[0]?.weight ?? 0;
  const lowest = weighted[weighted.length - 1]?.weight ?? 0;
  if (highest === lowest) {
    return notes;
  }

  const targetCount = Math.max(3, Math.ceil(notes.length / 2));
  const threshold = weighted[targetCount - 1]?.weight ?? lowest;
  return weighted.filter((entry) => entry.weight >= threshold).map((entry) => entry.note);
}

function withoutImmediateRepeat(notes: TargetNote[], lastTargetNoteId?: TargetNoteId): TargetNote[] {
  if (notes.length <= 1 || !lastTargetNoteId) {
    return notes;
  }
  const filtered = notes.filter((note) => note.id !== lastTargetNoteId);
  return filtered.length > 0 ? filtered : notes;
}

function resolvePracticeQueueStrategy({
  queueStrategy,
  focusedTraining,
}: {
  queueStrategy?: PracticeQueueStrategy;
  focusedTraining?: boolean;
}): PracticeQueueStrategy {
  return queueStrategy ?? (focusedTraining ? "focused" : "adaptive");
}

export function getDrillNotes(notes: TargetNote[], drillNoteNames: NoteName[] = []): TargetNote[] {
  if (drillNoteNames.length === 0) {
    return [];
  }
  const enabledNoteNames = new Set<NoteName>(drillNoteNames);
  return notes.filter((note) => enabledNoteNames.has(note.noteName));
}

export function selectNextNote({
  notes,
  reviews,
  lastTargetNoteId,
  plannedTargetNoteIds = [],
  newCardRate = 0.25,
  queueStrategy,
  drillNoteNames,
  focusedTraining = false,
  focusedTrainingRate = 0.8,
  melodyState,
  rng = Math.random,
}: SelectNextNoteOptions): TargetNote {
  if (notes.length === 0) {
    throw new Error("Cannot select a note without enabled groups.");
  }

  const effectiveQueueStrategy = resolvePracticeQueueStrategy({ queueStrategy, focusedTraining });
  if (effectiveQueueStrategy === "melody") {
    return selectMelodyNotes({ notes, count: 1, lastTargetNoteId, state: melodyState, rng })[0];
  }

  const strategyNotes = effectiveQueueStrategy === "note-drill" ? getDrillNotes(notes, drillNoteNames) : notes;
  if (strategyNotes.length === 0) {
    throw new Error("Cannot select a note without enabled drill note names.");
  }

  const sourceNotes =
    effectiveQueueStrategy === "focused" && rng() < focusedTrainingRate
      ? getFocusedTrainingNotes(strategyNotes, reviews, plannedTargetNoteIds)
      : strategyNotes;
  const eligible = withoutImmediateRepeat(sourceNotes, lastTargetNoteId);
  if (eligible.length === 1) {
    return eligible[0];
  }

  if (rng() < newCardRate) {
    const exposures = eligible.map((note) => ({
      note,
      exposure: getNotePerformance(note, reviews, plannedTargetNoteIds).exposure,
    }));
    const minExposure = Math.min(...exposures.map((entry) => entry.exposure));
    const leastSeen = exposures.filter((entry) => entry.exposure === minExposure).map((entry) => entry.note);
    return leastSeen[Math.floor(rng() * leastSeen.length)] ?? leastSeen[0];
  }

  const weighted = eligible.map((note) => ({ note, weight: getNoteWeight(note, reviews, plannedTargetNoteIds) }));
  const total = weighted.reduce((sum, entry) => sum + entry.weight, 0);
  let cursor = rng() * total;
  for (const entry of weighted) {
    cursor -= entry.weight;
    if (cursor <= 0) {
      return entry.note;
    }
  }
  return weighted[weighted.length - 1].note;
}

export interface SelectNotePageOptions extends SelectNextNoteOptions {
  count: number;
}

export function selectNotePage({ count, ...options }: SelectNotePageOptions): TargetNote[] {
  if (resolvePracticeQueueStrategy(options) === "melody") {
    return selectMelodyNotes({
      notes: options.notes,
      count,
      lastTargetNoteId: options.lastTargetNoteId,
      state: options.melodyState,
      rng: options.rng,
    });
  }

  const optionsWithStrategyNotes =
    resolvePracticeQueueStrategy(options) === "note-drill"
      ? { ...options, notes: getDrillNotes(options.notes, options.drillNoteNames) }
      : options;
  const selected: TargetNote[] = [];
  let lastTargetNoteId = optionsWithStrategyNotes.lastTargetNoteId;
  for (let index = 0; index < count; index += 1) {
    const note = selectNextNote({
      ...optionsWithStrategyNotes,
      lastTargetNoteId,
      plannedTargetNoteIds: [
        ...(optionsWithStrategyNotes.plannedTargetNoteIds ?? []),
        ...selected.map((selectedNote) => selectedNote.id),
      ],
    });
    selected.push(note);
    lastTargetNoteId = note.id;
  }
  return selected;
}
