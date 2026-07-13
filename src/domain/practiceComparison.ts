import { getNotesForGroups } from "./notes";
import { buildTargetNoteSetKey } from "./targetNoteSet";
import type {
  AppSettings,
  EffectiveQueueAlgorithm,
  NoteName,
  PracticeQueueStrategy,
  PromptDisplayMode,
  PromptNoteDuration,
  QueueComparisonFamily,
  StaffNotationMode,
  TargetNote,
} from "./types";

export interface PracticeComparisonSnapshot {
  effectiveQueueAlgorithm: EffectiveQueueAlgorithm;
  promptDisplayMode: PromptDisplayMode;
  promptNoteDuration: PromptNoteDuration;
  targetNoteSetKey: string;
}

export interface PracticeActivitySnapshot extends PracticeComparisonSnapshot {
  notes: TargetNote[];
}

export interface PracticeComparisonInput {
  drillNoteNames: readonly NoteName[];
  enabledGroupIds: AppSettings["enabledGroupIds"];
  includeInterStaffLedgerSpellings: boolean;
  promptDisplayMode: PromptDisplayMode;
  promptNoteDuration: PromptNoteDuration;
  queueStrategy: PracticeQueueStrategy;
  staffNotationMode: StaffNotationMode;
}

export function getEffectiveQueueAlgorithm(strategy: PracticeQueueStrategy): EffectiveQueueAlgorithm {
  if (strategy === "melody") {
    return "melody-v2";
  }
  return "adaptive-v2";
}

export function getQueueComparisonFamily(algorithm: EffectiveQueueAlgorithm): QueueComparisonFamily {
  if (algorithm === "melody-v1" || algorithm === "melody-v2") {
    return algorithm;
  }
  return "adaptive";
}

export function applyQueueCandidateFilter(
  notes: readonly TargetNote[],
  strategy: PracticeQueueStrategy,
  drillNoteNames: readonly NoteName[],
): TargetNote[] {
  if (strategy !== "note-drill") {
    return [...notes];
  }
  const selected = new Set(drillNoteNames);
  return notes.filter((note) => selected.has(note.noteName));
}

export function getEffectivePracticeNotes({
  drillNoteNames,
  enabledGroupIds,
  includeInterStaffLedgerSpellings,
  queueStrategy,
  staffNotationMode,
}: {
  drillNoteNames: readonly NoteName[];
  enabledGroupIds: AppSettings["enabledGroupIds"];
  includeInterStaffLedgerSpellings: boolean;
  queueStrategy: PracticeQueueStrategy;
  staffNotationMode: StaffNotationMode;
}): TargetNote[] {
  return applyQueueCandidateFilter(
    getNotesForGroups(enabledGroupIds, includeInterStaffLedgerSpellings, staffNotationMode),
    queueStrategy,
    drillNoteNames,
  );
}

export function buildPracticeComparisonSnapshot({
  drillNoteNames,
  enabledGroupIds,
  includeInterStaffLedgerSpellings,
  promptDisplayMode,
  promptNoteDuration,
  queueStrategy,
  staffNotationMode,
}: PracticeComparisonInput): PracticeComparisonSnapshot | undefined {
  const activity = buildPracticeActivitySnapshot({
    drillNoteNames,
    enabledGroupIds,
    includeInterStaffLedgerSpellings,
    promptDisplayMode,
    promptNoteDuration,
    queueStrategy,
    staffNotationMode,
  });
  if (!activity) {
    return undefined;
  }
  const { notes: _notes, ...comparison } = activity;
  return comparison;
}

export function buildPracticeActivitySnapshot({
  drillNoteNames,
  enabledGroupIds,
  includeInterStaffLedgerSpellings,
  promptDisplayMode,
  promptNoteDuration,
  queueStrategy,
  staffNotationMode,
}: PracticeComparisonInput): PracticeActivitySnapshot | undefined {
  const notes = getEffectivePracticeNotes({
    drillNoteNames,
    enabledGroupIds,
    includeInterStaffLedgerSpellings,
    queueStrategy,
    staffNotationMode,
  });
  if (notes.length === 0) {
    return undefined;
  }
  return {
    effectiveQueueAlgorithm: getEffectiveQueueAlgorithm(queueStrategy),
    notes,
    promptDisplayMode,
    promptNoteDuration,
    targetNoteSetKey: buildTargetNoteSetKey(notes.map((note) => note.id)),
  };
}
