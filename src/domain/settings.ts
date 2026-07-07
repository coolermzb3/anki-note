export const DEFAULT_PIANO_VOLUME = 0.8;

export function normalizePianoVolume(value: number | undefined): number {
  if (value === undefined || Number.isNaN(value)) {
    return DEFAULT_PIANO_VOLUME;
  }
  return Math.min(1, Math.max(0, value));
}
