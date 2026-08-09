import {
  VOCAL_PITCH_MAX_FREQUENCY_HZ,
  VOCAL_PITCH_MIN_FREQUENCY_HZ,
  type VocalPitchAnalysisConfig,
  type VocalPitchFrame,
} from "../domain/vocalPitch";
import type { PitchFrameCandidate, PitchFrameDetector } from "./pitchFrameDetector";

export interface ClassifiedPitchFrame {
  alternativeCandidate?: PitchFrameCandidate;
  candidate: PitchFrameCandidate;
  frame: VocalPitchFrame;
  rms: number;
}

export const MIN_VOICED_RMS = 0.0018;

function calculateRms(samples: Float32Array): number {
  let energy = 0;
  for (const sample of samples) {
    energy += sample * sample;
  }
  return Math.sqrt(energy / samples.length);
}

export function classifyPitchFrame(
  detector: PitchFrameDetector,
  samples: Float32Array,
  sampleRate: number,
  config: VocalPitchAnalysisConfig,
  timeSeconds: number,
): ClassifiedPitchFrame {
  const { fallback, primary } = detector.detect(samples, sampleRate);
  const candidate = fallback;
  const { clarity, frequencyHz } = candidate;
  const rms = calculateRms(samples);
  const voiced =
    rms >= MIN_VOICED_RMS &&
    clarity >= config.voicingThreshold &&
    frequencyHz >= VOCAL_PITCH_MIN_FREQUENCY_HZ &&
    frequencyHz <= VOCAL_PITCH_MAX_FREQUENCY_HZ;
  return {
    alternativeCandidate: primary,
    candidate,
    frame: {
      confidence: Math.min(1, Math.max(0, clarity)),
      frequencyHz: voiced ? frequencyHz : null,
      timeSeconds,
    },
    rms,
  };
}
