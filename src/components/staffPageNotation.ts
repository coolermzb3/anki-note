import type { PromptNoteDuration, Staff, TargetNote } from "../domain/types";

export const PROMPT_NOTE_DURATIONS: readonly PromptNoteDuration[] = [
  "whole",
  "quarter",
  "eighth",
  "sixteenth",
];

interface PromptNoteDurationConfig {
  barlineInterval: number;
  beamGroupSize?: number;
  quarterNoteBeats: number;
  vexDuration: "w" | "q" | "8" | "16";
}

const PROMPT_NOTE_DURATION_CONFIG: Record<PromptNoteDuration, PromptNoteDurationConfig> = {
  whole: { barlineInterval: 4, quarterNoteBeats: 4, vexDuration: "w" },
  quarter: { barlineInterval: 4, quarterNoteBeats: 1, vexDuration: "q" },
  eighth: { barlineInterval: 8, beamGroupSize: 2, quarterNoteBeats: 0.5, vexDuration: "8" },
  sixteenth: { barlineInterval: 8, beamGroupSize: 4, quarterNoteBeats: 0.25, vexDuration: "16" },
};

export interface StaffPageBeamGroup {
  size: number;
  staff: Staff;
  startIndex: number;
}

export function getVexNoteDuration(noteDuration: PromptNoteDuration): PromptNoteDurationConfig["vexDuration"] {
  return PROMPT_NOTE_DURATION_CONFIG[noteDuration].vexDuration;
}

export function getQuarterNoteBeats(noteDuration: PromptNoteDuration): number {
  return PROMPT_NOTE_DURATION_CONFIG[noteDuration].quarterNoteBeats;
}

export function getStaffPageBarlineInterval(noteDuration: PromptNoteDuration): number {
  return PROMPT_NOTE_DURATION_CONFIG[noteDuration].barlineInterval;
}

export function getCompleteStaffPageBeamGroups(
  notes: readonly (Pick<TargetNote, "staff"> | undefined)[],
  noteDuration: PromptNoteDuration,
): StaffPageBeamGroup[] {
  const size = PROMPT_NOTE_DURATION_CONFIG[noteDuration].beamGroupSize;
  if (size === undefined) {
    return [];
  }

  const groups: StaffPageBeamGroup[] = [];
  for (let startIndex = 0; startIndex < notes.length; startIndex += size) {
    const group = notes.slice(startIndex, startIndex + size);
    const firstNote = group[0];
    if (
      group.length === size &&
      firstNote !== undefined &&
      group.every((note) => note !== undefined && note.staff === firstNote.staff)
    ) {
      groups.push({ size, staff: firstNote.staff, startIndex });
    }
  }
  return groups;
}
