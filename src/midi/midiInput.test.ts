import { describe, expect, it } from "vitest";
import {
  getInitialMidiAccessStatus,
  makeMidiKeyId,
  MIDI_START_NOTE_NUMBER,
  registerMidiPress,
} from "./midiInput";

describe("MIDI environment detection", () => {
  it("distinguishes insecure pages from unsupported browsers", () => {
    expect(getInitialMidiAccessStatus(false, false)).toBe("insecure-context");
    expect(getInitialMidiAccessStatus(true, false)).toBe("unsupported");
    expect(getInitialMidiAccessStatus(true, true)).toBe("idle");
  });
});

describe("MIDI pressed-note tracking", () => {
  it("uses middle C as the start shortcut", () => {
    expect(MIDI_START_NOTE_NUMBER).toBe(60);
  });

  it("emits only a new down transition without requiring other keys to be released", () => {
    const pressed = new Map<string, number>();
    const c = makeMidiKeyId("device", 1, 60);
    const d = makeMidiKeyId("device", 1, 62);

    expect(registerMidiPress(pressed, c, 60)).toBe(true);
    expect(registerMidiPress(pressed, c, 60)).toBe(false);
    expect(registerMidiPress(pressed, d, 62)).toBe(true);
    expect([...pressed.values()]).toEqual([60, 62]);

    pressed.delete(c);
    expect(registerMidiPress(pressed, c, 60)).toBe(true);
  });
});
