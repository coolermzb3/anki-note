import { describe, expect, it } from "vitest";
import { peakNormalizationGain, playbackGainIsPreparing, PLAYBACK_MAX_BOOST } from "./playbackGain";

describe("playbackGainIsPreparing", () => {
  const first = new Blob(["first"]);
  const second = new Blob(["second"]);

  it("waits until the current blob gain is prepared", () => {
    expect(playbackGainIsPreparing(first, null)).toBe(true);
    expect(playbackGainIsPreparing(first, second)).toBe(true);
    expect(playbackGainIsPreparing(first, first)).toBe(false);
  });

  it("does not prepare when no material is loaded", () => {
    expect(playbackGainIsPreparing(null, first)).toBe(false);
  });
});

describe("peakNormalizationGain", () => {
  const targetPeak = 10 ** (-3 / 20);

  it("boosts quiet samples so the peak reaches -3 dB", () => {
    const samples = new Float32Array([0, 0.2, -0.2, 0.05]);
    expect(peakNormalizationGain(samples)).toBeCloseTo(targetPeak / 0.2);
  });

  it("attenuates loud samples down to -3 dB", () => {
    const samples = new Float32Array([0, 0.9, -0.9]);
    expect(peakNormalizationGain(samples)).toBeCloseTo(targetPeak / 0.9);
  });

  it("leaves a sample already at -3 dB untouched", () => {
    const samples = new Float32Array([targetPeak, -targetPeak]);
    expect(peakNormalizationGain(samples)).toBeCloseTo(1);
  });

  it("caps the boost for near-silent recordings", () => {
    const samples = new Float32Array([0.0001, -0.0001]);
    expect(peakNormalizationGain(samples)).toBe(PLAYBACK_MAX_BOOST);
  });

  it("returns 1 for silence", () => {
    expect(peakNormalizationGain(new Float32Array(100))).toBe(1);
    expect(peakNormalizationGain(new Float32Array(0))).toBe(1);
  });
});
