export interface VocalPitchFrame {
  confidence: number;
  frequencyHz: number | null;
  timeSeconds: number;
}

export interface VocalPitchAnalysisConfig {
  maxFrequencyHz: number;
  minFrequencyHz: number;
  referencePitchHz: number;
  smoothing: number;
  voicingThreshold: number;
}

export interface VocalPitchAnalysis {
  analyzedAt: string;
  config: VocalPitchAnalysisConfig;
  detectorId: "pitchy-mpm";
  detectorVersion: 1;
  frames: VocalPitchFrame[];
  hopSeconds: number;
  sampleRate: number;
  schemaVersion: 1;
}

export type VocalAudioSource = "recording" | "upload";

export interface VocalAudioCounts {
  materialCount: number;
  recordingCount: number;
  uploadCount: number;
}

export interface VocalAudioMaterial {
  analysis?: VocalPitchAnalysis;
  audioBlob: Blob;
  config: VocalPitchAnalysisConfig;
  contentDigest: string;
  createdAt: string;
  durationSeconds: number;
  id: string;
  mimeType: string;
  name: string;
  originalFileName?: string;
  schemaVersion: 1;
  size: number;
  source: VocalAudioSource;
  updatedAt: string;
}

export const DEFAULT_VOCAL_PITCH_CONFIG: VocalPitchAnalysisConfig = {
  referencePitchHz: 440,
  minFrequencyHz: 65.406,
  maxFrequencyHz: 1046.502,
  voicingThreshold: 0.85,
  smoothing: 0.35,
};

const SHARP_NOTE_NAMES = ["C", "C♯", "D", "D♯", "E", "F", "F♯", "G", "G♯", "A", "A♯", "B"] as const;

export function frequencyToMidi(frequencyHz: number, referencePitchHz = 440): number {
  return 69 + 12 * Math.log2(frequencyHz / referencePitchHz);
}

export function midiToFrequency(midi: number, referencePitchHz = 440): number {
  return referencePitchHz * 2 ** ((midi - 69) / 12);
}

export function formatMidiNote(midi: number): string {
  const rounded = Math.round(midi);
  const noteIndex = ((rounded % 12) + 12) % 12;
  const octave = Math.floor(rounded / 12) - 1;
  return `${SHARP_NOTE_NAMES[noteIndex]}${octave}`;
}

export function describeFrequency(
  frequencyHz: number | null,
  referencePitchHz: number,
): { cents: number; frequencyHz: number; note: string } | null {
  if (frequencyHz === null || !Number.isFinite(frequencyHz) || frequencyHz <= 0) {
    return null;
  }
  const midi = frequencyToMidi(frequencyHz, referencePitchHz);
  return {
    cents: (midi - Math.round(midi)) * 100,
    frequencyHz,
    note: formatMidiNote(midi),
  };
}

export function getPitchFrameAtTime(
  frames: readonly VocalPitchFrame[],
  timeSeconds: number,
): VocalPitchFrame | null {
  if (frames.length === 0) {
    return null;
  }
  if (timeSeconds < frames[0].timeSeconds) {
    return null;
  }
  let low = 0;
  let high = frames.length - 1;
  while (low < high) {
    const middle = Math.floor((low + high + 1) / 2);
    if (frames[middle].timeSeconds <= timeSeconds) {
      low = middle;
    } else {
      high = middle - 1;
    }
  }
  return frames[low];
}

export function getLatestVoicedPitchFrame(frames: readonly VocalPitchFrame[]): VocalPitchFrame | null {
  for (let index = frames.length - 1; index >= 0; index -= 1) {
    if (frames[index].frequencyHz !== null) {
      return frames[index];
    }
  }
  return null;
}

export function normalizeVocalPitchConfig(config: VocalPitchAnalysisConfig): VocalPitchAnalysisConfig {
  const minFrequencyHz = Math.min(2000, Math.max(30, config.minFrequencyHz));
  return {
    referencePitchHz: Math.min(460, Math.max(420, config.referencePitchHz)),
    minFrequencyHz,
    maxFrequencyHz: Math.min(4000, Math.max(minFrequencyHz + 1, config.maxFrequencyHz)),
    voicingThreshold: Math.min(0.99, Math.max(0.2, config.voicingThreshold)),
    smoothing: Math.min(1, Math.max(0, config.smoothing)),
  };
}

export function detectorConfigChanged(
  previous: VocalPitchAnalysisConfig,
  next: VocalPitchAnalysisConfig,
): boolean {
  return (
    previous.minFrequencyHz !== next.minFrequencyHz ||
    previous.maxFrequencyHz !== next.maxFrequencyHz ||
    previous.voicingThreshold !== next.voicingThreshold ||
    previous.smoothing !== next.smoothing
  );
}

export function formatDuration(seconds: number): string {
  const safeSeconds = Math.max(0, Math.floor(seconds));
  const minutes = Math.floor(safeSeconds / 60);
  return `${minutes}:${String(safeSeconds % 60).padStart(2, "0")}`;
}
