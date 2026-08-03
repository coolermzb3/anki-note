import { describe, expect, it } from "vitest";
import {
  describeFrequency,
  detectorConfigChanged,
  formatDuration,
  formatMidiNote,
  frequencyToMidi,
  getLatestVoicedPitchFrame,
  getPitchFrameAtTime,
  midiToFrequency,
  normalizeVocalPitchConfig,
  type VocalPitchFrame,
} from "./vocalPitch";

describe("vocal pitch helpers", () => {
  it("converts frequencies and note labels with a configurable reference", () => {
    expect(frequencyToMidi(440)).toBeCloseTo(69);
    expect(midiToFrequency(69)).toBeCloseTo(440);
    expect(formatMidiNote(60)).toBe("C4");
    expect(describeFrequency(445, 440)?.cents).toBeCloseTo(19.56, 1);
  });

  it("finds the latest frame at or before the requested time", () => {
    const frames: VocalPitchFrame[] = [
      { confidence: 1, frequencyHz: 220, timeSeconds: 0 },
      { confidence: 1, frequencyHz: 221, timeSeconds: 0.1 },
      { confidence: 1, frequencyHz: null, timeSeconds: 0.2 },
    ];
    expect(getPitchFrameAtTime(frames, -0.01)).toBeNull();
    expect(getPitchFrameAtTime(frames, 0.19)).toEqual(frames[1]);
    expect(getPitchFrameAtTime([], 1)).toBeNull();
    expect(getLatestVoicedPitchFrame(frames)).toEqual(frames[1]);
    expect(getLatestVoicedPitchFrame([frames[2]])).toBeNull();
  });

  it("normalizes unsafe configuration without inverting the range", () => {
    expect(
      normalizeVocalPitchConfig({
        referencePitchHz: 900,
        minFrequencyHz: 0,
        maxFrequencyHz: 10,
        voicingThreshold: 2,
        smoothing: -1,
      }),
    ).toEqual({
      referencePitchHz: 460,
      minFrequencyHz: 30,
      maxFrequencyHz: 31,
      voicingThreshold: 0.99,
      smoothing: 0,
    });
  });

  it("does not require redetection for a reference-pitch-only change", () => {
    const config = normalizeVocalPitchConfig({
      referencePitchHz: 440,
      minFrequencyHz: 65,
      maxFrequencyHz: 1047,
      voicingThreshold: 0.85,
      smoothing: 0.4,
    });
    expect(detectorConfigChanged(config, { ...config, referencePitchHz: 442 })).toBe(false);
    expect(detectorConfigChanged(config, { ...config, smoothing: 0.6 })).toBe(true);
    expect(formatDuration(65.9)).toBe("1:05");
  });
});
