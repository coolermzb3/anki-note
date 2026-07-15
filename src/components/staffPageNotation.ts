import type { PromptNoteDuration, TargetNote } from "../domain/types";

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
  startIndex: number;
}

export type StaffPageStemDirection = "down" | "up";

export interface StaffPageVisibleYBounds {
  bottomY: number;
  topY: number;
}

function getNoteYRange(notes: readonly { y: number }[]): { bottomY: number; topY: number; ys: number[] } {
  const ys = notes.map((note) => note.y);
  return { bottomY: Math.max(...ys), topY: Math.min(...ys), ys };
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
    let runStart: number | undefined;
    for (let index = groupStart; index <= groupEnd; index += 1) {
      if (index < groupEnd && notes[index] !== undefined) {
        runStart ??= index;
        continue;
      }
      if (runStart !== undefined && index - runStart >= 2) {
        runs.push({ size: index - runStart, startIndex: runStart });
      }
      runStart = undefined;
    }
  }
  return runs;
}

export function getCrossStaffOuterStemDirection(
  notes: readonly { y: number }[],
): StaffPageStemDirection {
  const { bottomY, topY, ys } = getNoteYRange(notes);
  const upwardStemCost = ys.reduce((sum, y) => sum + y - topY, 0);
  const downwardStemCost = ys.reduce((sum, y) => sum + bottomY - y, 0);
  return upwardStemCost <= downwardStemCost ? "up" : "down";
}

export function getVisibleBeamStemDirection(
  notes: readonly { y: number }[],
  visibleBounds: StaffPageVisibleYBounds,
  minimumClearance: number,
): StaffPageStemDirection | undefined {
  const { bottomY, topY } = getNoteYRange(notes);
  const upwardSpace = topY - visibleBounds.topY;
  const downwardSpace = visibleBounds.bottomY - bottomY;
  const upwardFits = upwardSpace >= minimumClearance;
  const downwardFits = downwardSpace >= minimumClearance;
  if (upwardFits !== downwardFits) {
    return upwardFits ? "up" : "down";
  }
  if (!upwardFits && upwardSpace !== downwardSpace) {
    return upwardSpace > downwardSpace ? "up" : "down";
  }
  return undefined;
}
