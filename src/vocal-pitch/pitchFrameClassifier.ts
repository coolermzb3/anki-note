import type { VocalPitchAnalysisConfig, VocalPitchFrame } from "../domain/vocalPitch";
import type { PitchFrameDetector } from "./pitchFrameDetector";

export interface ClassifiedPitchFrame {
  frame: VocalPitchFrame;
  rms: number;
}

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
  const { clarity, frequencyHz } = detector.detect(samples, sampleRate);
  const rms = calculateRms(samples);
  const voiced =
    rms >= 0.0018 &&
    clarity >= config.voicingThreshold &&
    frequencyHz >= config.minFrequencyHz &&
    frequencyHz <= config.maxFrequencyHz;
  return {
    frame: {
      confidence: Math.min(1, Math.max(0, clarity)),
      frequencyHz: voiced ? frequencyHz : null,
      timeSeconds,
    },
    rms,
  };
}
