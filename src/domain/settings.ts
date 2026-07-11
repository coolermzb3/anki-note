export const DEFAULT_PIANO_VOLUME = 0.8;
export const DEFAULT_ANSWER_KEYBOARD_SCALE = 1;
export const MIN_ANSWER_KEYBOARD_SCALE = 0.7;
export const MAX_ANSWER_KEYBOARD_SCALE = 1.5;

export function normalizeAnswerKeyboardScale(value: number | undefined): number {
  if (value === undefined || !Number.isFinite(value)) {
    return DEFAULT_ANSWER_KEYBOARD_SCALE;
  }
  return Math.min(MAX_ANSWER_KEYBOARD_SCALE, Math.max(MIN_ANSWER_KEYBOARD_SCALE, value));
}

export function normalizePianoVolume(value: number | undefined): number {
  if (value === undefined || Number.isNaN(value)) {
    return DEFAULT_PIANO_VOLUME;
  }
  return Math.min(1, Math.max(0, value));
}
