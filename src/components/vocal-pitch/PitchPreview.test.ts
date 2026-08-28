import { describe, expect, it } from "vitest";
import {
  chooseTimeGridStep,
  getPitchPreviewMidi,
  getPitchRowHighlight,
  updateAuditionedPointers,
} from "./PitchPreview";

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

  it("keeps every held pointer highlighted until that pointer is released", () => {
    let pointers: ReadonlyMap<number, number> = new Map();
    pointers = updateAuditionedPointers(pointers, 1, 60);
    pointers = updateAuditionedPointers(pointers, 2, 64);
    expect(getPitchRowHighlight(60, 64, pointers)).toBe("auditioned");
    expect(getPitchRowHighlight(64, 64, pointers)).toBe("auditioned");

    pointers = updateAuditionedPointers(pointers, 2, null);
    expect(getPitchRowHighlight(60, 64, pointers)).toBe("auditioned");
    expect(getPitchRowHighlight(64, 64, pointers)).toBe("current");
  });

  it("keeps a shared pitch highlighted while another pointer still holds it", () => {
    let pointers: ReadonlyMap<number, number> = new Map([[1, 60], [2, 60]]);
    pointers = updateAuditionedPointers(pointers, 1, null);
    expect(getPitchRowHighlight(60, 64, pointers)).toBe("auditioned");
    pointers = updateAuditionedPointers(pointers, 2, null);
    expect(getPitchRowHighlight(60, 64, pointers)).toBeNull();
  });

  it("adapts time grid steps to the visible span and width", () => {
    expect(chooseTimeGridStep(6, 600)).toBe(1);
    expect(chooseTimeGridStep(20, 640)).toBe(2);
    expect(chooseTimeGridStep(30, 640)).toBe(5);
    expect(chooseTimeGridStep(300, 600)).toBe(50);
  });
});
