import { staffForSingleClefMode } from "./staffNotation";
import type {
  NoteName,
  Octave,
  PianoKeyName,
  PitchId,
  PracticeGroup,
  PracticeGroupId,
  Staff,
  StaffNotationMode,
  TargetNote,
  TargetNoteId,
} from "./types";

export const NOTE_NAMES: NoteName[] = ["C", "D", "E", "F", "G", "A", "B"];
const NOTE_NAME_INDEX = new Map(NOTE_NAMES.map((noteName, index) => [noteName, index]));
type PracticePitch = { noteName: NoteName; octave: Octave };
type PracticeGroupDefinition = {
  id: PracticeGroupId;
  label: string;
  pitches: PracticePitch[];
};

export const ANSWER_BUTTONS: Array<{ key: string; label: string; noteName: NoteName }> = NOTE_NAMES.map(
  (noteName, index) => ({
    key: String(index + 1),
    label: String(index + 1),
    noteName,
  }),
);

const PRACTICE_GROUP_DEFINITIONS: PracticeGroupDefinition[] = [
  {
    id: "F1-F2",
    label: "F1-F2",
    pitches: [
      { noteName: "F", octave: 1 },
      { noteName: "G", octave: 1 },
      { noteName: "A", octave: 1 },
      { noteName: "B", octave: 1 },
      { noteName: "C", octave: 2 },
      { noteName: "D", octave: 2 },
      { noteName: "E", octave: 2 },
      { noteName: "F", octave: 2 },
    ],
  },
  {
    id: "G2-F3",
    label: "G2-F3",
    pitches: [
      { noteName: "G", octave: 2 },
      { noteName: "A", octave: 2 },
      { noteName: "B", octave: 2 },
      { noteName: "C", octave: 3 },
      { noteName: "D", octave: 3 },
      { noteName: "E", octave: 3 },
      { noteName: "F", octave: 3 },
    ],
  },
  {
    id: "G3-F4",
    label: "G3-F4",
    pitches: [
      { noteName: "G", octave: 3 },
      { noteName: "A", octave: 3 },
      { noteName: "B", octave: 3 },
      { noteName: "C", octave: 4 },
      { noteName: "D", octave: 4 },
      { noteName: "E", octave: 4 },
      { noteName: "F", octave: 4 },
    ],
  },
  {
    id: "G4-F5",
    label: "G4-F5",
    pitches: [
      { noteName: "G", octave: 4 },
      { noteName: "A", octave: 4 },
      { noteName: "B", octave: 4 },
      { noteName: "C", octave: 5 },
      { noteName: "D", octave: 5 },
      { noteName: "E", octave: 5 },
      { noteName: "F", octave: 5 },
    ],
  },
  {
    id: "G5-G6",
    label: "G5-G6",
    pitches: [
      { noteName: "G", octave: 5 },
      { noteName: "A", octave: 5 },
      { noteName: "B", octave: 5 },
      { noteName: "C", octave: 6 },
      { noteName: "D", octave: 6 },
      { noteName: "E", octave: 6 },
      { noteName: "F", octave: 6 },
      { noteName: "G", octave: 6 },
    ],
  },
];

const LEGACY_GROUP_ID_SEQUENCES = [["C2-B2", "C3-B3", "C4-B4", "C5-B5", "C6-B6"]] as const;

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
  const isInterStaffLedgerSpelling = isLedgerOverlap(noteName, octave) && staff !== getDefaultStaff(octave);
  return {
    id: makeNoteId(noteName, octave, staff),
    pitchId,
    noteName,
    octave,
    groupId,
    staff,
    isInterStaffLedgerSpelling,
  };
}

function makeTargetNotes(noteName: NoteName, octave: Octave, groupId: PracticeGroupId): TargetNote[] {
  const defaultStaff = getDefaultStaff(octave);
  return [
    makeTargetNote(noteName, octave, groupId, defaultStaff),
    makeTargetNote(noteName, octave, groupId, getAlternateStaff(defaultStaff)),
  ];
}

export const PRACTICE_GROUPS: PracticeGroup[] = PRACTICE_GROUP_DEFINITIONS.map((group) => ({
  id: group.id,
  label: group.label,
  notes: group.pitches.flatMap((pitch) => makeTargetNotes(pitch.noteName, pitch.octave, group.id)),
}));

export const ALL_NOTES: TargetNote[] = PRACTICE_GROUPS.flatMap((group) => group.notes);

export const DEFAULT_ENABLED_GROUPS: PracticeGroupId[] = ["G3-F4"];

const CURRENT_GROUP_IDS = PRACTICE_GROUPS.map((group) => group.id);
const CURRENT_GROUP_ID_SET = new Set<string>(CURRENT_GROUP_IDS);
const ALL_NOTES_BY_ID = new Map<TargetNoteId, TargetNote>(ALL_NOTES.map((note) => [note.id, note]));

function isCurrentPracticeGroupId(groupId: string): groupId is PracticeGroupId {
  return CURRENT_GROUP_ID_SET.has(groupId);
}

function currentGroupIdForLegacyPosition(legacyIndex: number, legacyCount: number): PracticeGroupId {
  if (legacyCount <= 1 || CURRENT_GROUP_IDS.length <= 1) {
    return CURRENT_GROUP_IDS[0];
  }
  const currentIndex = Math.round((legacyIndex / (legacyCount - 1)) * (CURRENT_GROUP_IDS.length - 1));
  return CURRENT_GROUP_IDS[Math.max(0, Math.min(CURRENT_GROUP_IDS.length - 1, currentIndex))];
}

export function findNoteById(id: TargetNoteId): TargetNote | undefined {
  return ALL_NOTES_BY_ID.get(id);
}

export function getNoteById(id: TargetNoteId): TargetNote {
  const note = findNoteById(id);
  if (!note) {
    throw new Error(`Unknown target note: ${id}`);
  }
  return note;
}

export function getNotesForGroups(
  groupIds: PracticeGroupId[],
  includeInterStaffLedgerSpellings = true,
  staffNotationMode: StaffNotationMode = "grand",
): TargetNote[] {
  const enabled = new Set(groupIds);
  if (staffNotationMode !== "grand") {
    const staff = staffForSingleClefMode(staffNotationMode);
    return ALL_NOTES.filter((note) => enabled.has(note.groupId) && note.staff === staff);
  }
  return ALL_NOTES.filter(
    (note) =>
      enabled.has(note.groupId) &&
      (note.staff === getDefaultStaff(note.octave) ||
        (includeInterStaffLedgerSpellings && note.isInterStaffLedgerSpelling)),
  );
}

export function getCurrentTargetNoteIdsForGroups(
  groupIds: PracticeGroupId[],
  includeInterStaffLedgerSpellings = true,
  staffNotationMode: StaffNotationMode = "grand",
): Set<TargetNoteId> {
  return new Set(getNotesForGroups(groupIds, includeInterStaffLedgerSpellings, staffNotationMode).map((note) => note.id));
}

export function normalizePracticeGroupIds(groupIds: readonly string[] | undefined): PracticeGroupId[] {
  const normalized = normalizeCurrentPracticeGroupIds(groupIds);
  return normalized.length > 0 ? normalized : DEFAULT_ENABLED_GROUPS;
}

export function normalizeCurrentPracticeGroupIds(groupIds: readonly string[] | undefined): PracticeGroupId[] {
  const selected = new Set<PracticeGroupId>();

  for (const groupId of groupIds ?? []) {
    if (isCurrentPracticeGroupId(groupId)) {
      selected.add(groupId);
      continue;
    }

    for (const legacyGroupIds of LEGACY_GROUP_ID_SEQUENCES) {
      const legacyIndex = (legacyGroupIds as readonly string[]).indexOf(groupId);
      if (legacyIndex >= 0) {
        selected.add(currentGroupIdForLegacyPosition(legacyIndex, legacyGroupIds.length));
        break;
      }
    }
  }

  return CURRENT_GROUP_IDS.filter((groupId) => selected.has(groupId));
}

export function formatStaffLabel(staff: Staff): string {
  return staff === "treble" ? "高音谱号" : "低音谱号";
}

export function formatTargetNoteLabel(
  note: TargetNote,
  effectiveTargetNoteIds?: ReadonlySet<TargetNoteId>,
): string {
  if (effectiveTargetNoteIds) {
    const samePitchCount = [...effectiveTargetNoteIds]
      .map((id) => ALL_NOTES_BY_ID.get(id))
      .filter((candidate) => candidate?.pitchId === note.pitchId).length;
    if (samePitchCount <= 1 && effectiveTargetNoteIds.has(note.id)) {
      return note.pitchId;
    }
  }
  return `${note.pitchId} · ${formatStaffLabel(note.staff)}`;
}

export function noteToVexKey(note: TargetNote): string {
  return `${note.noteName.toLowerCase()}/${note.octave}`;
}

export function noteToToneName(noteName: PianoKeyName, octave: Octave): string {
  return `${noteName}${octave}`;
}
