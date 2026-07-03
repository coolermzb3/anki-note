import type { NoteName, Octave, PracticeGroup, PracticeGroupId, TargetNote, TargetNoteId } from "./types";

export const NOTE_NAMES: NoteName[] = ["C", "D", "E", "F", "G", "A", "B"];

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

export function makeNoteId(noteName: NoteName, octave: Octave): TargetNoteId {
  return `${noteName}${octave}` as TargetNoteId;
}

function makeTargetNote(noteName: NoteName, octave: Octave, groupId: PracticeGroupId): TargetNote {
  return {
    id: makeNoteId(noteName, octave),
    noteName,
    octave,
    groupId,
    staff: octave >= 4 ? "treble" : "bass",
  };
}

export const PRACTICE_GROUPS: PracticeGroup[] = GROUP_ORDER.map((group) => ({
  ...group,
  notes: NOTE_NAMES.map((noteName) => makeTargetNote(noteName, group.octave, group.id)),
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

export function getNotesForGroups(groupIds: PracticeGroupId[]): TargetNote[] {
  const enabled = new Set(groupIds);
  return ALL_NOTES.filter((note) => enabled.has(note.groupId));
}

export function noteToVexKey(note: TargetNote): string {
  return `${note.noteName.toLowerCase()}/${note.octave}`;
}

export function noteToToneName(noteName: NoteName, octave: Octave): string {
  return `${noteName}${octave}`;
}
