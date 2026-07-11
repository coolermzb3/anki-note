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

export interface StaffPageBeamRun {
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

export function getBarlineGapCenter(previousRight: number, nextLeft: number): number | undefined {
  return previousRight < nextLeft ? (previousRight + nextLeft) / 2 : undefined;
}

export function getStaffPageBeamRuns(
  notes: readonly (Pick<TargetNote, "staff"> | undefined)[],
  noteDuration: PromptNoteDuration,
): StaffPageBeamRun[] {
  const config = PROMPT_NOTE_DURATION_CONFIG[noteDuration];
  const groupSize = config.beamGroupSize;
  if (groupSize === undefined) {
    return [];
  }

  const runs: StaffPageBeamRun[] = [];
  for (let groupStart = 0; groupStart < notes.length; groupStart += groupSize) {
    const groupEnd = Math.min(notes.length, groupStart + groupSize);
    let runStaff: Staff | undefined;
    let runStart = groupStart;
    for (let index = groupStart; index <= groupEnd; index += 1) {
      const staff = index < groupEnd ? notes[index]?.staff : undefined;
      if (staff === runStaff) {
        continue;
      }
      if (runStaff !== undefined && index - runStart >= 2) {
        runs.push({ size: index - runStart, staff: runStaff, startIndex: runStart });
      }
      runStaff = staff;
      runStart = index;
    }
  }
  return runs;
}
