import { getPracticeSessionComparisonSnapshot } from "./legacyPracticeSessionCompatibility";
import { selectMelodyNotes, type MelodyGenerationState } from "./melody";
import { isStatisticalReview } from "./reviews";
import adaptiveV2Spec from "./adaptiveV2Spec.json";
import type {
  NoteName,
  PracticeQueueStrategy,
  PracticeSessionRecord,
  ReviewRecord,
  TargetNote,
  TargetNoteId,
} from "./types";

const {
  coldStartReviewCount: COLD_START_REVIEW_COUNT,
  maintenanceGap: MAINTENANCE_GAP,
  newcomerRate: NEWCOMER_RATE,
  performanceReviewLimit: PERFORMANCE_REVIEW_LIMIT,
  tierWeights: TIER_WEIGHTS,
} = adaptiveV2Spec;

export interface SelectNextNoteOptions {
  notes: TargetNote[];
  reviews: ReviewRecord[];
  sessions?: PracticeSessionRecord[];
  currentSessionId?: string;
  lastTargetNoteId?: TargetNoteId;
  plannedTargetNoteIds?: TargetNoteId[];
  queueStrategy?: PracticeQueueStrategy;
  drillNoteNames?: NoteName[];
  rng?: () => number;
  melodyState?: MelodyGenerationState;
}

export interface AdaptiveNotePerformance {
  adjustedMedianMs?: number;
  eligibleReviewCount: number;
  plannedPageCount: number;
  recentMedianMs?: number;
  selectionCount: number;
}

function median(values: number[]): number | undefined {
  if (values.length === 0) {
    return undefined;
  }
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

function reviewCompletedAt(review: ReviewRecord): number {
  return new Date(review.answeredAt ?? review.endedAt).getTime();
}

function qualifiedReviewsFor(noteId: TargetNoteId, reviews: ReviewRecord[]): ReviewRecord[] {
  return reviews
    .filter((review) => review.targetNoteId === noteId && isStatisticalReview(review))
    .sort(
      (left, right) =>
        reviewCompletedAt(left) - reviewCompletedAt(right) ||
        new Date(left.startedAt).getTime() - new Date(right.startedAt).getTime(),
    );
}

function plannedCount(noteId: TargetNoteId, plannedTargetNoteIds: readonly TargetNoteId[]): number {
  return plannedTargetNoteIds.filter((candidate) => candidate === noteId).length;
}

export function getAdaptiveNotePerformance(
  notes: readonly TargetNote[],
  reviews: ReviewRecord[],
  plannedTargetNoteIds: readonly TargetNoteId[] = [],
): Map<TargetNoteId, AdaptiveNotePerformance> {
  const raw = notes.map((note) => {
    const qualified = qualifiedReviewsFor(note.id, reviews);
    const recent = qualified.slice(-PERFORMANCE_REVIEW_LIMIT);
    const plannedPageCount = plannedCount(note.id, plannedTargetNoteIds);
    return {
      noteId: note.id,
      eligibleReviewCount: qualified.length,
      plannedPageCount,
      recentMedianMs: median(recent.map((review) => review.activeMs)),
      selectionCount: qualified.length + plannedPageCount,
    };
  });
  const matureMedians = raw
    .filter((entry) => entry.selectionCount >= COLD_START_REVIEW_COUNT && entry.recentMedianMs !== undefined)
    .map((entry) => entry.recentMedianMs!);
  const priorMedianMs = median(matureMedians);

  return new Map(raw.map((entry) => {
    const evidenceCount = Math.min(entry.selectionCount, PERFORMANCE_REVIEW_LIMIT);
    const alpha = Math.min(
      1,
      Math.max(
        0,
        (evidenceCount - COLD_START_REVIEW_COUNT) / (PERFORMANCE_REVIEW_LIMIT - COLD_START_REVIEW_COUNT),
      ),
    );
    const adjustedMedianMs =
      entry.selectionCount >= COLD_START_REVIEW_COUNT &&
      entry.recentMedianMs !== undefined &&
      priorMedianMs !== undefined
        ? (1 - alpha) * priorMedianMs + alpha * entry.recentMedianMs
        : undefined;
    return [entry.noteId, {
      adjustedMedianMs,
      eligibleReviewCount: entry.eligibleReviewCount,
      plannedPageCount: entry.plannedPageCount,
      recentMedianMs: entry.recentMedianMs,
      selectionCount: entry.selectionCount,
    }];
  }));
}

function tierSlotWeights(noteCount: number): number[] {
  const base = Math.floor(noteCount / 3);
  const remainder = noteCount % 3;
  const sizes = [0, 1, 2].map((index) => base + (index < remainder ? 1 : 0));
  return sizes.flatMap((size, index) => Array.from({ length: size }, () => TIER_WEIGHTS[index]));
}

export function getAdaptiveTierWeights(
  notes: readonly TargetNote[],
  performance: ReadonlyMap<TargetNoteId, AdaptiveNotePerformance>,
): Map<TargetNoteId, number> {
  const ordered = notes
    .filter((note) => performance.get(note.id)?.adjustedMedianMs !== undefined)
    .sort((left, right) => {
      const scoreDifference =
        performance.get(right.id)!.adjustedMedianMs! - performance.get(left.id)!.adjustedMedianMs!;
      return scoreDifference || left.id.localeCompare(right.id);
    });
  const slotWeights = tierSlotWeights(ordered.length);
  const weights = new Map<TargetNoteId, number>();
  const sameScore = (left: number | undefined, right: number | undefined): boolean =>
    left !== undefined && right !== undefined && Math.abs(left - right) <= 1e-9;
  for (let start = 0; start < ordered.length;) {
    const score = performance.get(ordered[start].id)!.adjustedMedianMs;
    let end = start + 1;
    while (end < ordered.length && sameScore(performance.get(ordered[end].id)!.adjustedMedianMs, score)) {
      end += 1;
    }
    const averageWeight = slotWeights.slice(start, end).reduce((sum, weight) => sum + weight, 0) / (end - start);
    for (let index = start; index < end; index += 1) {
      weights.set(ordered[index].id, averageWeight);
    }
    start = end;
  }
  return weights;
}

function withoutImmediateRepeat(notes: TargetNote[], lastTargetNoteId?: TargetNoteId): TargetNote[] {
  if (notes.length <= 1 || lastTargetNoteId === undefined) {
    return notes;
  }
  const eligible = notes.filter((note) => note.id !== lastTargetNoteId);
  return eligible.length > 0 ? eligible : notes;
}

function randomChoice<T>(items: readonly T[], rng: () => number): T {
  return items[Math.min(items.length - 1, Math.floor(rng() * items.length))];
}

function weightedChoice(
  notes: readonly TargetNote[],
  weights: ReadonlyMap<TargetNoteId, number>,
  rng: () => number,
): TargetNote {
  const total = notes.reduce((sum, note) => sum + (weights.get(note.id) ?? 0), 0);
  if (total <= 0) {
    return randomChoice(notes, rng);
  }
  let cursor = rng() * total;
  for (const note of notes) {
    cursor -= weights.get(note.id) ?? 0;
    if (cursor <= 0) {
      return note;
    }
  }
  return notes[notes.length - 1];
}

function targetSetForSession(session: PracticeSessionRecord | undefined): Set<string> | undefined {
  const key = session && getPracticeSessionComparisonSnapshot(session)?.targetNoteSetKey;
  return key ? new Set(key.split("|")) : undefined;
}

function buildQuestionGaps({
  currentSessionId,
  notes,
  plannedTargetNoteIds,
  reviews,
  sessions,
}: {
  currentSessionId?: string;
  notes: readonly TargetNote[];
  plannedTargetNoteIds: readonly TargetNoteId[];
  reviews: ReviewRecord[];
  sessions: PracticeSessionRecord[];
}): Map<TargetNoteId, number> {
  const gaps = new Map(notes.map((note) => [note.id, 0]));
  const relevantIds = new Set(gaps.keys());
  const sessionTargetSets = new Map(
    sessions.map((session) => [session.id, targetSetForSession(session)]),
  );
  const currentTargetSet = new Set(relevantIds);
  const orderedReviews = reviews
    .filter(isStatisticalReview)
    .sort(
      (left, right) =>
        reviewCompletedAt(left) - reviewCompletedAt(right) ||
        new Date(left.startedAt).getTime() - new Date(right.startedAt).getTime(),
    );
  for (const review of orderedReviews) {
    const targetSet = review.sessionId === currentSessionId
      ? currentTargetSet
      : sessionTargetSets.get(review.sessionId);
    if (!targetSet) {
      continue;
    }
    for (const noteId of relevantIds) {
      if (targetSet.has(noteId)) {
        gaps.set(noteId, noteId === review.targetNoteId ? 0 : (gaps.get(noteId) ?? 0) + 1);
      }
    }
  }
  for (const selectedId of plannedTargetNoteIds) {
    for (const noteId of relevantIds) {
      gaps.set(noteId, noteId === selectedId ? 0 : (gaps.get(noteId) ?? 0) + 1);
    }
  }
  return gaps;
}

function resolvePracticeQueueStrategy(strategy?: PracticeQueueStrategy): PracticeQueueStrategy {
  return strategy === "focused" || strategy === undefined ? "adaptive" : strategy;
}

export function getDrillNotes(notes: TargetNote[], drillNoteNames: NoteName[] = []): TargetNote[] {
  const enabledNoteNames = new Set(drillNoteNames);
  return notes.filter((note) => enabledNoteNames.has(note.noteName));
}

export function selectNextNote({
  notes,
  reviews,
  sessions = [],
  currentSessionId,
  lastTargetNoteId,
  plannedTargetNoteIds = [],
  queueStrategy,
  drillNoteNames,
  melodyState,
  rng = Math.random,
}: SelectNextNoteOptions): TargetNote {
  if (notes.length === 0) {
    throw new Error("Cannot select a note without enabled groups.");
  }
  const strategy = resolvePracticeQueueStrategy(queueStrategy);
  if (strategy === "melody") {
    return selectMelodyNotes({ notes, count: 1, lastTargetNoteId, state: melodyState, rng })[0];
  }
  const strategyNotes = strategy === "note-drill" ? getDrillNotes(notes, drillNoteNames) : notes;
  if (strategyNotes.length === 0) {
    throw new Error("Cannot select a note without enabled drill note names.");
  }

  const eligible = withoutImmediateRepeat(strategyNotes, lastTargetNoteId);
  if (eligible.length === 1) {
    return eligible[0];
  }
  const performance = getAdaptiveNotePerformance(strategyNotes, reviews, plannedTargetNoteIds);
  const mature = eligible.filter((note) => performance.get(note.id)!.selectionCount >= COLD_START_REVIEW_COUNT);
  const newcomers = eligible.filter((note) => performance.get(note.id)!.selectionCount < COLD_START_REVIEW_COUNT);
  const gaps = buildQuestionGaps({ currentSessionId, notes: strategyNotes, plannedTargetNoteIds, reviews, sessions });
  const overdue = mature.filter((note) => (gaps.get(note.id) ?? 0) >= MAINTENANCE_GAP);
  if (overdue.length > 0) {
    const oldestGap = Math.max(...overdue.map((note) => gaps.get(note.id) ?? 0));
    return randomChoice(overdue.filter((note) => gaps.get(note.id) === oldestGap), rng);
  }

  const allBroadlyNew = newcomers.length > 0 && strategyNotes.every(
    (note) => performance.get(note.id)!.selectionCount <= COLD_START_REVIEW_COUNT,
  );
  if (allBroadlyNew || mature.length === 0) {
    const minimumCount = Math.min(...newcomers.map((note) => performance.get(note.id)!.selectionCount));
    return randomChoice(
      newcomers.filter((note) => performance.get(note.id)!.selectionCount === minimumCount),
      rng,
    );
  }
  if (newcomers.length > 0 && rng() < NEWCOMER_RATE) {
    const minimumCount = Math.min(...newcomers.map((note) => performance.get(note.id)!.selectionCount));
    return randomChoice(
      newcomers.filter((note) => performance.get(note.id)!.selectionCount === minimumCount),
      rng,
    );
  }
  return weightedChoice(mature, getAdaptiveTierWeights(strategyNotes, performance), rng);
}

export interface SelectNotePageOptions extends SelectNextNoteOptions {
  count: number;
}

export function selectNotePage({ count, ...options }: SelectNotePageOptions): TargetNote[] {
  if (resolvePracticeQueueStrategy(options.queueStrategy) === "melody") {
    return selectMelodyNotes({
      notes: options.notes,
      count,
      lastTargetNoteId: options.lastTargetNoteId,
      state: options.melodyState,
      rng: options.rng,
    });
  }
  const selected: TargetNote[] = [];
  let lastTargetNoteId = options.lastTargetNoteId;
  for (let index = 0; index < count; index += 1) {
    const note = selectNextNote({
      ...options,
      lastTargetNoteId,
      plannedTargetNoteIds: [
        ...(options.plannedTargetNoteIds ?? []),
        ...selected.map((selectedNote) => selectedNote.id),
      ],
    });
    selected.push(note);
    lastTargetNoteId = note.id;
  }
  return selected;
}
