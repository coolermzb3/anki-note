import type { VocalPitchAnalysis, VocalPitchAnalysisConfig, VocalPitchFrame } from "../domain/vocalPitch";
import {
  createPitchFrameDetector,
  getPitchFrameSize,
  VOCAL_PITCH_DETECTOR_ID,
  VOCAL_PITCH_DETECTOR_VERSION,
} from "./pitchFrameDetector";
import { classifyPitchFrame } from "./pitchFrameClassifier";

function median(values: number[]): number {
  values.sort((left, right) => left - right);
  return values[Math.floor(values.length / 2)];
}

function smoothFrames(frames: VocalPitchFrame[], smoothing: number): VocalPitchFrame[] {
  const radius = Math.round(smoothing * 4);
  if (radius === 0) {
    return frames;
  }
  return frames.map((frame, index) => {
    if (frame.frequencyHz === null) {
      return frame;
    }
    const nearby: number[] = [];
    for (let offset = -radius; offset <= radius; offset += 1) {
      const candidate = frames[index + offset];
      if (candidate?.frequencyHz != null && Math.abs(candidate.timeSeconds - frame.timeSeconds) <= 0.08) {
        nearby.push(Math.log2(candidate.frequencyHz));
      }
    }
    return nearby.length < 2 ? frame : { ...frame, frequencyHz: 2 ** median(nearby) };
  });
}

function suppressIsolatedOctaveJumps(frames: VocalPitchFrame[]): VocalPitchFrame[] {
  return frames.map((frame, index) => {
    const previous = frames[index - 1]?.frequencyHz;
    const next = frames[index + 1]?.frequencyHz;
    if (frame.frequencyHz === null || previous == null || next == null) {
      return frame;
    }
    const neighborsApart = Math.abs(12 * Math.log2(previous / next));
    const currentApart = Math.abs(12 * Math.log2(frame.frequencyHz / Math.sqrt(previous * next)));
    if (neighborsApart > 1.5 || currentApart < 7) {
      return frame;
    }
    const options = [frame.frequencyHz / 2, frame.frequencyHz * 2];
    const replacement = options.reduce((best, candidate) =>
      Math.abs(Math.log2(candidate / previous)) < Math.abs(Math.log2(best / previous)) ? candidate : best,
    );
    return Math.abs(12 * Math.log2(replacement / previous)) <= 1.5 ? { ...frame, frequencyHz: replacement } : frame;
  });
}

export function analyzePitchSamples(
  samples: Float32Array,
  sampleRate: number,
  config: VocalPitchAnalysisConfig,
  onProgress: (progress: number) => void = () => undefined,
): VocalPitchAnalysis {
  const frameSize = getPitchFrameSize(sampleRate, config.minFrequencyHz);
  const hopSize = Math.max(1, Math.round(sampleRate / 100));
  const detector = createPitchFrameDetector(frameSize);
  const frame = new Float32Array(frameSize);
  const frames: VocalPitchFrame[] = [];
  const frameCount = Math.max(1, Math.ceil(Math.max(0, samples.length - frameSize) / hopSize) + 1);

  for (let frameIndex = 0; frameIndex < frameCount; frameIndex += 1) {
    const offset = frameIndex * hopSize;
    frame.fill(0);
    frame.set(samples.subarray(offset, Math.min(samples.length, offset + frameSize)));
    frames.push(classifyPitchFrame(detector, frame, sampleRate, config, (offset + frameSize / 2) / sampleRate).frame);
    if (frameIndex % 500 === 0) {
      onProgress(frameIndex / frameCount);
    }
  }

  return {
    schemaVersion: 1,
    analyzedAt: new Date().toISOString(),
    detectorId: VOCAL_PITCH_DETECTOR_ID,
    detectorVersion: VOCAL_PITCH_DETECTOR_VERSION,
    config,
    frames: smoothFrames(suppressIsolatedOctaveJumps(frames), config.smoothing),
    hopSeconds: hopSize / sampleRate,
    sampleRate,
  };
}
