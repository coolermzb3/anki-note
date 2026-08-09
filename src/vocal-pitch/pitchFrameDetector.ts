import { PitchDetector } from "pitchy";
import { VOCAL_PITCH_MIN_FREQUENCY_HZ } from "../domain/vocalPitch";

export const VOCAL_PITCH_DETECTOR_ID = "mpm-c";
export const VOCAL_PITCH_DETECTOR_VERSION = 4;

const FALLBACK_PEAK_THRESHOLD = 0.9;
const PRIMARY_PEAK_THRESHOLD = 0.95;

export interface PitchFrameCandidate {
  clarity: number;
  frequencyHz: number;
}

export interface PitchFrameDetection {
  fallback: PitchFrameCandidate;
  primary: PitchFrameCandidate;
}

export interface PitchFrameDetector {
  detect: (samples: Float32Array, sampleRate: number) => PitchFrameDetection;
}

function nextPowerOfTwo(value: number): number {
  return 2 ** Math.ceil(Math.log2(value));
}

export function getPitchFrameSize(sampleRate: number): number {
  return Math.min(16384, Math.max(2048, nextPowerOfTwo((sampleRate / VOCAL_PITCH_MIN_FREQUENCY_HZ) * 3)));
}

export function createPitchFrameDetector(frameSize: number): PitchFrameDetector {
  const primaryDetector = PitchDetector.forFloat32Array(frameSize);
  const fallbackDetector = PitchDetector.forFloat32Array(frameSize);
  primaryDetector.clarityThreshold = PRIMARY_PEAK_THRESHOLD;
  fallbackDetector.clarityThreshold = FALLBACK_PEAK_THRESHOLD;
  return {
    detect: (samples, sampleRate) => {
      const [frequencyHz, clarity] = primaryDetector.findPitch(samples, sampleRate);
      const [fallbackFrequencyHz, fallbackClarity] = fallbackDetector.findPitch(samples, sampleRate);
      return {
        primary: { clarity, frequencyHz },
        fallback: { clarity: fallbackClarity, frequencyHz: fallbackFrequencyHz },
      };
    },
  };
}
