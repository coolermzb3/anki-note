import { PitchDetector } from "pitchy";

export const VOCAL_PITCH_DETECTOR_ID = "pitchy-mpm";
export const VOCAL_PITCH_DETECTOR_VERSION = 1;

export interface PitchFrameCandidate {
  clarity: number;
  frequencyHz: number;
}

export interface PitchFrameDetector {
  detect: (samples: Float32Array, sampleRate: number) => PitchFrameCandidate;
}

function nextPowerOfTwo(value: number): number {
  return 2 ** Math.ceil(Math.log2(value));
}

export function getPitchFrameSize(sampleRate: number, minFrequencyHz: number): number {
  return Math.min(16384, Math.max(2048, nextPowerOfTwo((sampleRate / minFrequencyHz) * 3)));
}

export function createPitchFrameDetector(frameSize: number): PitchFrameDetector {
  const detector = PitchDetector.forFloat32Array(frameSize);
  return {
    detect: (samples, sampleRate) => {
      const [frequencyHz, clarity] = detector.findPitch(samples, sampleRate);
      return { clarity, frequencyHz };
    },
  };
}
