import { describe, expect, it } from "vitest";
import {
  DEFAULT_VOCAL_PITCH_CONFIG,
  describeFrequency,
  detectorConfigChanged,
  formatDuration,
  formatMidiNote,
  frequencyToMidi,
  getLatestVoicedPitchFrame,
  getPitchFrameAtTime,
  midiToFrequency,
  normalizeVocalPitchConfig,
  VOCAL_PITCH_MAX_FREQUENCY_HZ,
  VOCAL_PITCH_MIN_FREQUENCY_HZ,
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

  it("normalizes editable settings and replaces legacy detector bounds", () => {
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
      minFrequencyHz: VOCAL_PITCH_MIN_FREQUENCY_HZ,
      maxFrequencyHz: VOCAL_PITCH_MAX_FREQUENCY_HZ,
      voicingThreshold: 0.99,
    });
  });

  it("requires redetection only for an editable detector setting", () => {
    const config = normalizeVocalPitchConfig({
      referencePitchHz: 440,
      minFrequencyHz: 65,
      maxFrequencyHz: 1047,
      voicingThreshold: 0.85,
    });
    expect(detectorConfigChanged(config, { ...config, referencePitchHz: 442 })).toBe(false);
    expect(detectorConfigChanged(config, { ...config, smoothing: 0.6 })).toBe(false);
    expect(detectorConfigChanged(config, { ...config, minFrequencyHz: 30, maxFrequencyHz: 4000 })).toBe(false);
    expect(detectorConfigChanged(config, { ...config, voicingThreshold: 0.9 })).toBe(true);
    expect(DEFAULT_VOCAL_PITCH_CONFIG.maxFrequencyHz).toBe(VOCAL_PITCH_MAX_FREQUENCY_HZ);
    expect(formatDuration(65.9)).toBe("1:05");
  });
});
