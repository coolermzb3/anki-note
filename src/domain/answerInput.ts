import type { AnswerPitchMode, NoteName, TargetNote } from "./types";

const NOTE_NAME_SEMITONES: Record<NoteName, number> = {
  C: 0,
  D: 2,
  E: 4,
  F: 5,
  G: 7,
  A: 9,
  B: 11,
};

export type AnswerInputSource = "computer-keyboard" | "midi" | "screen-keyboard";

export interface PracticeAnswerInput {
  diagnosticSampleId?: number;
  midiNoteNumber?: number;
  noteName: NoteName;
  octave?: number;
  source: AnswerInputSource;
}

export function normalizeAnswerPitchMode(
  value: unknown,
  fallback: AnswerPitchMode = "note-name",
): AnswerPitchMode {
  if (value === "exact-pitch" || value === "absolute-pitch") {
    return "exact-pitch";
  }
  return value === "note-name" ? "note-name" : fallback;
}

export function resolveAvailableAnswerPitchMode(
  configuredMode: AnswerPitchMode,
  midiConnected: boolean,
): AnswerPitchMode {
  return midiConnected ? configuredMode : "note-name";
}

export function getTargetMidiNoteNumber(target: Pick<TargetNote, "noteName" | "octave">): number {
  return (target.octave + 1) * 12 + NOTE_NAME_SEMITONES[target.noteName];
}

export function isPracticeAnswerCorrect(
  answer: PracticeAnswerInput,
  target: Pick<TargetNote, "noteName" | "octave">,
  mode: AnswerPitchMode,
): boolean {
  if (answer.noteName !== target.noteName) {
    return false;
  }
  if (mode === "note-name") {
    return true;
  }
  return answer.source === "midi" && answer.midiNoteNumber === getTargetMidiNoteNumber(target);
}
