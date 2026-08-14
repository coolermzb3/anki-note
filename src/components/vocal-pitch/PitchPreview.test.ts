import { describe, expect, it } from "vitest";
import { getPitchPreviewMidi } from "./PitchPreview";

describe("pitch preview note playback", () => {
  it("maps the pointer height to the corresponding semitone row", () => {
    expect(getPitchPreviewMidi(100, 100, 240, 60, 12)).toBe(72);
    expect(getPitchPreviewMidi(220, 100, 240, 60, 12)).toBe(66);
    expect(getPitchPreviewMidi(340, 100, 240, 60, 12)).toBe(60);
  });

  it("keeps playback inside the piano range", () => {
    expect(getPitchPreviewMidi(0, 100, 100, 100, 20)).toBe(108);
    expect(getPitchPreviewMidi(300, 100, 100, 20, 20)).toBe(24);
  });
});
