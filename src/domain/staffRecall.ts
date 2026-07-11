import { NOTE_NAMES } from "./notes";
import { buildTargetNoteSetKey } from "./targetNoteSet";
import type { NoteName, StaffRecallRunRecord, TargetNote, TargetNoteId } from "./types";

export interface NoteNameColumnDefinition {
  answerNumber: string;
  noteName: NoteName;
}

export interface NoteNameColumn extends NoteNameColumnDefinition {
  bassNotes: TargetNote[];
  notes: TargetNote[];
  trebleNotes: TargetNote[];
}

export const NOTE_NAME_COLUMNS: NoteNameColumnDefinition[] = NOTE_NAMES.map((noteName, index) => ({
  answerNumber: String(index + 1),
  noteName,
}));

const NOTE_NAME_ORDER = new Map(NOTE_NAMES.map((noteName, index) => [noteName, index]));

export function targetNotePitchOrder(note: Pick<TargetNote, "noteName" | "octave">): number {
  return note.octave * NOTE_NAMES.length + (NOTE_NAME_ORDER.get(note.noteName) ?? 0);
}

export function compareTargetNotePitch(left: TargetNote, right: TargetNote): number {
  return targetNotePitchOrder(left) - targetNotePitchOrder(right);
}

export function buildNoteNameColumns(
  notes: TargetNote[],
  columnDefinitions: readonly NoteNameColumnDefinition[],
): NoteNameColumn[] {
  return columnDefinitions.map((column) => {
    const columnNotes = notes.filter((note) => note.noteName === column.noteName).sort(compareTargetNotePitch);
    return {
      ...column,
      bassNotes: columnNotes.filter((note) => note.staff === "bass"),
      notes: columnNotes,
      trebleNotes: columnNotes.filter((note) => note.staff === "treble"),
    };
  });
}

export function dedupeTargetNotePitches(notes: TargetNote[]): TargetNote[] {
  const seen = new Set<string>();
  return notes.filter((note) => {
    if (seen.has(note.pitchId)) {
      return false;
    }
    seen.add(note.pitchId);
    return true;
  });
}

export function shuffleNoteNames(random: () => number = Math.random): NoteName[] {
  const noteNames = [...NOTE_NAMES];
  for (let index = noteNames.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(random() * (index + 1));
    [noteNames[index], noteNames[swapIndex]] = [noteNames[swapIndex], noteNames[index]];
  }
  return noteNames;
}

export function columnDefinitionsForNoteNames(noteNames: readonly NoteName[]): NoteNameColumnDefinition[] {
  return noteNames.map((noteName) => {
    const column = NOTE_NAME_COLUMNS.find((candidate) => candidate.noteName === noteName);
    if (!column) {
      throw new Error(`Unknown note name: ${noteName}`);
    }
    return column;
  });
}

export function buildStaffRecallAnswerSetKey(targetNoteIds: readonly TargetNoteId[]): string {
  return buildTargetNoteSetKey(targetNoteIds);
}

export function getStaffRecallTargetNoteSetKey(run: StaffRecallRunRecord): string {
  return run.schemaVersion === 2 ? run.targetNoteSetKey : run.answerSetKey;
}

export function buildStaffRecallTargetNoteIds(notes: readonly TargetNote[]): TargetNoteId[] {
  return notes.map((note) => note.id).sort();
}

export function totalStaffRecallActiveMs(run: Pick<StaffRecallRunRecord, "columnActiveMs">): number {
  return NOTE_NAMES.reduce((total, noteName) => total + run.columnActiveMs[noteName], 0);
}

export function formatStaffRecallDeltaMs(
  deltaMs: number,
): { direction: "faster" | "slower"; text: string } | undefined {
  const roundedSeconds = Number((deltaMs / 1000).toFixed(1));
  if (roundedSeconds === 0) {
    return undefined;
  }
  return {
    direction: roundedSeconds < 0 ? "faster" : "slower",
    text: `(${roundedSeconds < 0 ? "−" : "+"}${Math.abs(roundedSeconds).toFixed(1)}s)`,
  };
}

export function formatStaffRecallPerNoteMs(totalMs: number, noteCount: number): string {
  return noteCount > 0 ? `${Math.round(totalMs / noteCount)}ms` : "-";
}

export function formatStaffRecallPerNoteDeltaMs(
  totalDeltaMs: number,
  noteCount: number,
): { direction: "faster" | "slower"; text: string } | undefined {
  if (noteCount <= 0) {
    return undefined;
  }
  const roundedMagnitudeMs = Math.round(Math.abs(totalDeltaMs) / noteCount);
  if (roundedMagnitudeMs === 0) {
    return undefined;
  }
  return {
    direction: totalDeltaMs < 0 ? "faster" : "slower",
    text: `(${totalDeltaMs < 0 ? "−" : "+"}${roundedMagnitudeMs}ms)`,
  };
}

export function comparableStaffRecallRuns(
  runs: readonly StaffRecallRunRecord[],
  targetNoteSetKey: string,
): StaffRecallRunRecord[] {
  return runs
    .filter((run) => getStaffRecallTargetNoteSetKey(run) === targetNoteSetKey)
    .sort((left, right) => left.endedAt.localeCompare(right.endedAt) || left.id.localeCompare(right.id));
}
