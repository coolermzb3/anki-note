import { describe, expect, it } from "vitest";
import { DEFAULT_VOCAL_PITCH_CONFIG } from "../domain/vocalPitch";
import { analyzePitchSamples } from "./pitchDetection";

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

  it("does not invent pitch in silence or low-level noise", () => {
    const analysis = analyzePitchSamples(new Float32Array(16_000), 16_000, DEFAULT_VOCAL_PITCH_CONFIG);
    expect(analysis.frames.every((frame) => frame.frequencyHz === null)).toBe(true);
    const noise = addDeterministicNoise(new Float32Array(16_000), 0.001);
    expect(analyzePitchSamples(noise, 16_000, DEFAULT_VOCAL_PITCH_CONFIG).frames.every((frame) => frame.frequencyHz === null)).toBe(true);
  });

  it("rejects detected frequencies outside the configured range", () => {
    const config = { ...DEFAULT_VOCAL_PITCH_CONFIG, minFrequencyHz: 230, maxFrequencyHz: 300, smoothing: 0 };
    const analysis = analyzePitchSamples(sineWave(220, 1, 16_000), 16_000, config);
    expect(analysis.frames.every((frame) => frame.frequencyHz === null)).toBe(true);
  });
});
