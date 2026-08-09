import { describe, expect, it } from "vitest";
import { DEFAULT_VOCAL_PITCH_CONFIG, midiToFrequency, type VocalPitchAnalysis } from "../domain/vocalPitch";
import {
  fillReliableFcpeGaps,
  fuseEnhancedPitchTracks,
  type NeuralPitchTrack,
} from "./enhancedPitchFusion";

function track(midi: readonly (number | null)[]): NeuralPitchTrack {
  return {
    confidence: Float32Array.from(midi, (value) => value === null ? 0 : 1),
    frequenciesHz: Float32Array.from(midi, (value) => value === null ? Number.NaN : midiToFrequency(value)),
    timesSeconds: Float32Array.from(midi, (_, index) => index / 100),
  };
}

function mpm(midi: readonly (number | null)[]): VocalPitchAnalysis {
  return {
    schemaVersion: 1,
    analyzedAt: "2026-08-09T00:00:00.000Z",
    config: DEFAULT_VOCAL_PITCH_CONFIG,
    detectorId: "mpm-c",
    detectorVersion: 3,
    frames: midi.map((value, index) => ({
      confidence: value === null ? 0 : 1,
      frequencyHz: value === null ? null : midiToFrequency(value),
      timeSeconds: index / 100,
    })),
    hopSeconds: 0.01,
    sampleRate: 16_000,
  };
}

function outputMidi(production: readonly (number | null)[], swift: readonly (number | null)[], fcpe: readonly (number | null)[]) {
  return fuseEnhancedPitchTracks(mpm(production), track(swift), track(fcpe), production.length / 100)
    .map((frame) => frame.frequencyHz === null ? null : 69 + 12 * Math.log2(frame.frequencyHz / 440));
}

describe("enhanced pitch fusion", () => {
  it("keeps the FCPE contour after anchoring it to the three-model consensus", () => {
    const output = outputMidi([60, 60.1], [60.2, 60.2], [60.4, 72.3]);
    expect(output[0]).toBeCloseTo(60.4, 3);
    expect(output[1]).toBeCloseTo(60.3, 3);
  });

  it("falls back to SwiftF0 when FCPE cannot enter the consensus cluster", () => {
    const output = outputMidi([60], [60.1], [65]);
    expect(output[0]).toBeCloseTo(60.1, 3);
  });

  it("keeps FCPE only when both other voters are unvoiced", () => {
    expect(outputMidi([null], [null], [60])[0]).toBeCloseTo(60, 3);
    expect(outputMidi([72], [null], [60])[0]).toBeNull();
  });

  it("requires a strict voiced pitch majority", () => {
    expect(outputMidi([60], [62], [64])[0]).toBeNull();
    expect(outputMidi([60], [60.8], [61.6])[0]).toBeCloseTo(60.8, 3);
  });

  it("fills at most five FCPE-backed frames that stay within one semitone of the endpoint trend", () => {
    const frames = [60, null, null, null, null, null, 66].map((value, index) => ({
      confidence: value === null ? 0 : 1,
      frequencyHz: value === null ? null : midiToFrequency(value),
      timeSeconds: index / 100,
    }));
    const rawFcpe = [60, 61, 62, 63, 64, 65, 66].map((value) => midiToFrequency(value));
    expect(fillReliableFcpeGaps(frames, rawFcpe).every((frame) => frame.frequencyHz !== null)).toBe(true);

    const tooLong = [60, null, null, null, null, null, null, 67].map((value, index) => ({
      confidence: value === null ? 0 : 1,
      frequencyHz: value === null ? null : midiToFrequency(value),
      timeSeconds: index / 100,
    }));
    expect(
      fillReliableFcpeGaps(tooLong, [60, 61, 62, 63, 64, 65, 66, 67].map((value) => midiToFrequency(value)))[1]
        .frequencyHz,
    ).toBeNull();

    const offTrend = [...rawFcpe];
    offTrend[3] = midiToFrequency(70);
    expect(fillReliableFcpeGaps(frames, offTrend)[3].frequencyHz).toBeNull();
  });
});
