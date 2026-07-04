import type { NoteName, Octave, PitchId, PracticeGroup, PracticeGroupId, Staff, TargetNote, TargetNoteId } from "./types";

export const NOTE_NAMES: NoteName[] = ["C", "D", "E", "F", "G", "A", "B"];
const NOTE_NAME_INDEX = new Map(NOTE_NAMES.map((noteName, index) => [noteName, index]));

export const ANSWER_BUTTONS: Array<{ key: string; label: string; noteName: NoteName }> = NOTE_NAMES.map(
  (noteName, index) => ({
    key: String(index + 1),
    label: String(index + 1),
    noteName,
  }),
);

const GROUP_ORDER: Array<{ id: PracticeGroupId; octave: Octave; label: string }> = [
  { id: "C4-B4", octave: 4, label: "C4-B4" },
  { id: "C3-B3", octave: 3, label: "C3-B3" },
  { id: "C5-B5", octave: 5, label: "C5-B5" },
  { id: "C2-B2", octave: 2, label: "C2-B2" },
  { id: "C6-B6", octave: 6, label: "C6-B6" },
];

function noteOrder(noteName: NoteName, octave: Octave): number {
  const index = NOTE_NAME_INDEX.get(noteName);
  if (index === undefined) {
    throw new Error(`Unknown note name: ${noteName}`);
  }
  return octave * NOTE_NAMES.length + index;
}

function isLedgerOverlap(noteName: NoteName, octave: Octave): boolean {
  const order = noteOrder(noteName, octave);
  return order >= noteOrder("E", 3) && order <= noteOrder("A", 4);
}

function getDefaultStaff(octave: Octave): Staff {
  return octave >= 4 ? "treble" : "bass";
}

function getAlternateStaff(staff: Staff): Staff {
  return staff === "treble" ? "bass" : "treble";
}

export function makePitchId(noteName: NoteName, octave: Octave): PitchId {
  return `${noteName}${octave}` as PitchId;
}

export function makeNoteId(noteName: NoteName, octave: Octave, staff = getDefaultStaff(octave)): TargetNoteId {
  const pitchId = makePitchId(noteName, octave);
  return staff === getDefaultStaff(octave) ? pitchId : `${pitchId}-${staff}`;
}

function makeTargetNote(noteName: NoteName, octave: Octave, groupId: PracticeGroupId, staff = getDefaultStaff(octave)): TargetNote {
  const pitchId = makePitchId(noteName, octave);
  const isLedgerVariant = staff !== getDefaultStaff(octave);
  return {
    id: makeNoteId(noteName, octave, staff),
    pitchId,
    noteName,
    octave,
    groupId,
    staff,
    isLedgerVariant,
  };
}

function makeTargetNotes(noteName: NoteName, octave: Octave, groupId: PracticeGroupId): TargetNote[] {
  const defaultStaff = getDefaultStaff(octave);
  const notes = [makeTargetNote(noteName, octave, groupId, defaultStaff)];
  if (isLedgerOverlap(noteName, octave)) {
    notes.push(makeTargetNote(noteName, octave, groupId, getAlternateStaff(defaultStaff)));
  }
  return notes;
}

export const PRACTICE_GROUPS: PracticeGroup[] = GROUP_ORDER.map((group) => ({
  ...group,
  notes: NOTE_NAMES.flatMap((noteName) => makeTargetNotes(noteName, group.octave, group.id)),
}));

export const PRACTICE_GROUPS_LOW_TO_HIGH: PracticeGroup[] = [...PRACTICE_GROUPS].sort(
  (a, b) => a.octave - b.octave,
);

export const ALL_NOTES: TargetNote[] = PRACTICE_GROUPS.flatMap((group) => group.notes);

export const DEFAULT_ENABLED_GROUPS: PracticeGroupId[] = ["C4-B4"];

export function getNoteById(id: TargetNoteId): TargetNote {
  const note = ALL_NOTES.find((candidate) => candidate.id === id);
  if (!note) {
    throw new Error(`Unknown target note: ${id}`);
  }
  return note;
}

export function getNotesForGroups(groupIds: PracticeGroupId[], includeLedgerVariants = true): TargetNote[] {
  const enabled = new Set(groupIds);
  return ALL_NOTES.filter((note) => enabled.has(note.groupId) && (includeLedgerVariants || !note.isLedgerVariant));
}

export function formatStaffLabel(staff: Staff): string {
  return staff === "treble" ? "高音谱号" : "低音谱号";
}

export function formatTargetNoteLabel(note: TargetNote): string {
  if (!isLedgerOverlap(note.noteName, note.octave)) {
    return note.pitchId;
  }
  return `${note.pitchId} · ${formatStaffLabel(note.staff)}`;
}

export function noteToVexKey(note: TargetNote): string {
  return `${note.noteName.toLowerCase()}/${note.octave}`;
}

export function noteToToneName(noteName: NoteName, octave: Octave): string {
  return `${noteName}${octave}`;
}
