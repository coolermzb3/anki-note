export interface VocalPitchFrame {
  confidence: number;
  frequencyHz: number | null;
  timeSeconds: number;
}

export interface VocalPitchAnalysisConfig {
  /** Fixed detector bound, retained in saved analysis metadata and legacy backups. */
  maxFrequencyHz: number;
  /** Fixed detector bound, retained in saved analysis metadata and legacy backups. */
  minFrequencyHz: number;
  referencePitchHz: number;
  /** Kept only while reading legacy saved materials. It no longer changes analysis. */
  smoothing?: number;
  voicingThreshold: number;
}

export interface VocalPitchAnalysis {
  analyzedAt: string;
  config: VocalPitchAnalysisConfig;
  detectorId: "mpm-c" | "mpm-c-swiftf0-fcpe" | "pitchy-mpm";
  detectorVersion: number;
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

export function vocalAudioFileExtension(material: Pick<VocalAudioMaterial, "mimeType" | "originalFileName">): string {
  if (material.mimeType.startsWith("audio/")) {
    if (material.mimeType.includes("wav")) return "wav";
    if (material.mimeType.includes("mpeg")) return "mp3";
    if (material.mimeType.includes("mp4")) return "m4a";
    if (material.mimeType.includes("ogg")) return "ogg";
    if (material.mimeType.includes("webm")) return "webm";
  }
  const originalExtension = material.originalFileName?.match(/\.([a-z0-9]{1,8})$/i)?.[1];
  return originalExtension ? originalExtension.toLowerCase() : "webm";
}

export const VOCAL_PITCH_MIN_FREQUENCY_HZ = 65.406;
export const VOCAL_PITCH_MAX_FREQUENCY_HZ = 1975.5;

export const DEFAULT_VOCAL_PITCH_CONFIG: VocalPitchAnalysisConfig = {
  referencePitchHz: 440,
  minFrequencyHz: VOCAL_PITCH_MIN_FREQUENCY_HZ,
  maxFrequencyHz: VOCAL_PITCH_MAX_FREQUENCY_HZ,
  voicingThreshold: 0.85,
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
  return {
    referencePitchHz: Math.min(460, Math.max(420, config.referencePitchHz)),
    minFrequencyHz: VOCAL_PITCH_MIN_FREQUENCY_HZ,
    maxFrequencyHz: VOCAL_PITCH_MAX_FREQUENCY_HZ,
    voicingThreshold: Math.min(0.99, Math.max(0.2, config.voicingThreshold)),
  };
}

export function detectorConfigChanged(
  previous: VocalPitchAnalysisConfig,
  next: VocalPitchAnalysisConfig,
): boolean {
  return previous.voicingThreshold !== next.voicingThreshold;
}

export function formatDuration(seconds: number): string {
  const safeSeconds = Math.max(0, Math.floor(seconds));
  const minutes = Math.floor(safeSeconds / 60);
  return `${minutes}:${String(safeSeconds % 60).padStart(2, "0")}`;
}
