import { describe, expect, it } from "vitest";
import {
  getTargetMidiNoteNumber,
  isPracticeAnswerCorrect,
  normalizeAnswerPitchMode,
  resolveAvailableAnswerPitchMode,
} from "./answerInput";

const TARGET = { noteName: "C" as const, octave: 4 as const };

describe("practice answer pitch modes", () => {
  it("falls back to note-name matching while MIDI is unavailable", () => {
    expect(resolveAvailableAnswerPitchMode("exact-pitch", false)).toBe("note-name");
    expect(resolveAvailableAnswerPitchMode("exact-pitch", true)).toBe("exact-pitch");
  });

  it("reads the legacy absolute-pitch value as exact-pitch", () => {
    expect(normalizeAnswerPitchMode("absolute-pitch")).toBe("exact-pitch");
    expect(normalizeAnswerPitchMode("exact-pitch")).toBe("exact-pitch");
  });

  it("accepts the same note name from every input source in note-name mode", () => {
    expect(isPracticeAnswerCorrect({ noteName: "C", octave: 2, source: "midi", midiNoteNumber: 36 }, TARGET, "note-name"))
      .toBe(true);
    expect(isPracticeAnswerCorrect({ noteName: "C", source: "computer-keyboard" }, TARGET, "note-name")).toBe(true);
  });

  it("requires the exact MIDI note in exact-pitch mode", () => {
    expect(getTargetMidiNoteNumber(TARGET)).toBe(60);
    expect(isPracticeAnswerCorrect({ noteName: "C", octave: 4, source: "midi", midiNoteNumber: 60 }, TARGET, "exact-pitch"))
      .toBe(true);
    expect(isPracticeAnswerCorrect({ noteName: "C", octave: 3, source: "midi", midiNoteNumber: 48 }, TARGET, "exact-pitch"))
      .toBe(false);
    expect(isPracticeAnswerCorrect({ noteName: "C", source: "screen-keyboard" }, TARGET, "exact-pitch"))
      .toBe(false);
  });
});
