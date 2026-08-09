import { describe, expect, it } from "vitest";
import {
  DEFAULT_VOCAL_PITCH_CONFIG,
  VOCAL_PITCH_MAX_FREQUENCY_HZ,
  VOCAL_PITCH_MIN_FREQUENCY_HZ,
} from "../domain/vocalPitch";
import type { ClassifiedPitchFrame } from "./pitchFrameClassifier";
import { createPitchFrameDetector } from "./pitchFrameDetector";
import { analyzePitchSamples, postProcessPitchFrames } from "./pitchDetection";

function sineWave(frequencyHz: number, seconds: number, sampleRate: number): Float32Array {
  return Float32Array.from(
    { length: Math.floor(seconds * sampleRate) },
    (_, index) => Math.sin((index / sampleRate) * frequencyHz * 2 * Math.PI) * 0.5,
  );
}

function sineSweep(startFrequencyHz: number, endFrequencyHz: number, seconds: number, sampleRate: number): Float32Array {
  const samples = new Float32Array(Math.floor(seconds * sampleRate));
  let phase = 0;
  for (let index = 0; index < samples.length; index += 1) {
    const progress = index / Math.max(1, samples.length - 1);
    const frequencyHz = startFrequencyHz + (endFrequencyHz - startFrequencyHz) * progress;
    phase += (frequencyHz * 2 * Math.PI) / sampleRate;
    samples[index] = Math.sin(phase) * 0.5;
  }
  return samples;
}

function addDeterministicNoise(samples: Float32Array, amplitude: number): Float32Array {
  let state = 0x12345678;
  return samples.map((sample) => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return sample + ((state / 0x1_0000_0000) * 2 - 1) * amplitude;
  });
}

function harmonicRichFrame(frequencyHz: number, sampleRate: number): Float32Array {
  return Float32Array.from(
    { length: 2048 },
    (_, index) => {
      const phase = (index / sampleRate) * frequencyHz * 2 * Math.PI;
      return Math.sin(phase) * 0.02 + Math.sin(phase * 2) * 0.1;
    },
  );
}

function classifiedFrame(
  frequencyHz: number | null,
  candidateFrequencyHz: number,
  clarity = 0.8,
  timeSeconds = 0,
  alternativeFrequencyHz?: number,
): ClassifiedPitchFrame {
  return {
    alternativeCandidate:
      alternativeFrequencyHz === undefined ? undefined : { clarity: 0.99, frequencyHz: alternativeFrequencyHz },
    candidate: { clarity, frequencyHz: candidateFrequencyHz },
    frame: { confidence: clarity, frequencyHz, timeSeconds },
    rms: 0.1,
  };
}

describe("MPM pitch detection baseline", () => {
  it("tracks a stable synthetic tone without octave errors", () => {
    const analysis = analyzePitchSamples(sineWave(220, 1, 16_000), 16_000, DEFAULT_VOCAL_PITCH_CONFIG);
    const voiced = analysis.frames.flatMap((frame) => frame.frequencyHz ?? []);
    expect(voiced.length).toBeGreaterThan(70);
    expect(Math.min(...voiced)).toBeGreaterThan(218);
    expect(Math.max(...voiced)).toBeLessThan(222);
    expect(analysis.hopSeconds).toBeCloseTo(0.01);
    expect(analysis.frames[0].timeSeconds).toBeCloseTo(0.064);
    expect(analysis.frames[1].timeSeconds - analysis.frames[0].timeSeconds).toBeCloseTo(analysis.hopSeconds);
    expect(analysis.detectorId).toBe("mpm-c");
    expect(analysis.detectorVersion).toBe(4);
  });

  it("tracks a synthetic sweep and a tone with light noise", () => {
    const sweep = analyzePitchSamples(sineSweep(180, 260, 2, 16_000), 16_000, DEFAULT_VOCAL_PITCH_CONFIG);
    const early = sweep.frames.filter((frame) => frame.frequencyHz !== null && frame.timeSeconds >= 0.2 && frame.timeSeconds <= 0.5);
    const late = sweep.frames.filter((frame) => frame.frequencyHz !== null && frame.timeSeconds >= 1.5 && frame.timeSeconds <= 1.8);
    expect(early.length).toBeGreaterThan(10);
    expect(late.length).toBeGreaterThan(10);
    expect(early.reduce((sum, frame) => sum + (frame.frequencyHz ?? 0), 0) / early.length).toBeLessThan(210);
    expect(late.reduce((sum, frame) => sum + (frame.frequencyHz ?? 0), 0) / late.length).toBeGreaterThan(235);

    const noisy = analyzePitchSamples(
      addDeterministicNoise(sineWave(220, 1, 16_000), 0.03),
      16_000,
      DEFAULT_VOCAL_PITCH_CONFIG,
    );
    const noisyVoiced = noisy.frames.flatMap((frame) => frame.frequencyHz ?? []);
    expect(noisyVoiced.length).toBeGreaterThan(70);
    expect(noisyVoiced.reduce((sum, frequencyHz) => sum + frequencyHz, 0) / noisyVoiced.length).toBeCloseTo(220, 0);
  });

  it("provides a stronger fundamental candidate for a harmonic-rich frame", () => {
    const detector = createPitchFrameDetector(2048);
    const detection = detector.detect(harmonicRichFrame(220, 16_000), 16_000);
    expect(detection.primary.frequencyHz).toBeCloseTo(220, 0);
    expect(detection.fallback.frequencyHz).toBeCloseTo(440, 0);
  });

  it("repairs only short octave excursions and evidence-backed gaps", () => {
    const config = DEFAULT_VOCAL_PITCH_CONFIG;
    const repaired = postProcessPitchFrames(
      [
        classifiedFrame(220, 220, 0.99, 0),
        classifiedFrame(440, 440, 0.99, 0.01),
        classifiedFrame(440, 440, 0.99, 0.02),
        classifiedFrame(220, 220, 0.99, 0.03),
        classifiedFrame(null, 219, 0.8, 0.04),
        classifiedFrame(null, 221, 0.8, 0.05),
        classifiedFrame(220, 220, 0.99, 0.06),
      ],
      config,
    );
    expect(repaired.map((frame) => frame.frequencyHz)).toEqual([220, 220, 220, 220, 219, 221, 220]);

    const unsupportedGap = postProcessPitchFrames(
      [
        classifiedFrame(220, 220, 0.99, 0),
        classifiedFrame(null, 219, 0.5, 0.01),
        classifiedFrame(220, 220, 0.99, 0.02),
      ],
      config,
    );
    expect(unsupportedGap[1].frequencyHz).toBeNull();

    const sustainedOctave = postProcessPitchFrames(
      [220, 440, 440, 440, 440, 440, 220].map((frequencyHz, index) =>
        classifiedFrame(frequencyHz, frequencyHz, 0.99, index / 100),
      ),
      config,
    );
    expect(sustainedOctave.slice(1, 6).every((frame) => frame.frequencyHz === 440)).toBe(true);

    const candidatePath = postProcessPitchFrames(
      [
        classifiedFrame(220, 220, 0.99, 0),
        ...Array.from({ length: 20 }, (_, index) => classifiedFrame(440, 440, 0.99, (index + 1) / 100, 220)),
        classifiedFrame(220, 220, 0.99, 0.21),
      ],
      config,
    );
    expect(candidatePath.every((frame) => frame.frequencyHz === 220)).toBe(true);
  });

  it("does not invent pitch in silence or low-level noise", () => {
    const analysis = analyzePitchSamples(new Float32Array(16_000), 16_000, DEFAULT_VOCAL_PITCH_CONFIG);
    expect(analysis.frames.every((frame) => frame.frequencyHz === null)).toBe(true);
    const noise = addDeterministicNoise(new Float32Array(16_000), 0.001);
    expect(analyzePitchSamples(noise, 16_000, DEFAULT_VOCAL_PITCH_CONFIG).frames.every((frame) => frame.frequencyHz === null)).toBe(true);
  });

  it("replaces legacy configured ranges with the fixed detector range", () => {
    const config = { ...DEFAULT_VOCAL_PITCH_CONFIG, minFrequencyHz: 230, maxFrequencyHz: 300 };
    const analysis = analyzePitchSamples(sineWave(220, 1, 16_000), 16_000, config);
    expect(analysis.frames.filter((frame) => frame.frequencyHz !== null).length).toBeGreaterThan(70);
    expect(analysis.config.minFrequencyHz).toBe(VOCAL_PITCH_MIN_FREQUENCY_HZ);
    expect(analysis.config.maxFrequencyHz).toBe(VOCAL_PITCH_MAX_FREQUENCY_HZ);
  });
});
