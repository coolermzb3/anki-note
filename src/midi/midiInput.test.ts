import { describe, expect, it } from "vitest";
import {
  getInitialMidiAccessStatus,
  isMidiPermissionGranted,
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

  it("only auto-connects after MIDI permission has already been granted", async () => {
    const permissions = (state: PermissionState): Pick<Permissions, "query"> => ({
      query: async () => ({ state }) as PermissionStatus,
    });

    await expect(isMidiPermissionGranted(permissions("granted"))).resolves.toBe(true);
    await expect(isMidiPermissionGranted(permissions("prompt"))).resolves.toBe(false);
    await expect(isMidiPermissionGranted(permissions("denied"))).resolves.toBe(false);
    await expect(isMidiPermissionGranted(undefined)).resolves.toBe(false);
  });

  it("silently skips auto-connect when the Permissions API rejects MIDI queries", async () => {
    const permissions: Pick<Permissions, "query"> = {
      query: async () => {
        throw new TypeError("MIDI permission queries are unsupported");
      },
    };

    await expect(isMidiPermissionGranted(permissions)).resolves.toBe(false);
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
