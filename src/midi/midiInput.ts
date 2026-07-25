import type { PianoKeyName } from "../domain/types";

const PIANO_KEY_NAMES: readonly PianoKeyName[] = [
  "C",
  "C#",
  "D",
  "D#",
  "E",
  "F",
  "F#",
  "G",
  "G#",
  "A",
  "A#",
  "B",
];

export const MIDI_START_NOTE_NUMBER = 60;

export type MidiAccessStatus =
  | "denied"
  | "error"
  | "idle"
  | "insecure-context"
  | "ready"
  | "requesting"
  | "unsupported";

export interface MidiNoteInput {
  keyId: string;
  keyName: PianoKeyName;
  midiNoteNumber: number;
  octave: number;
}

export type MidiNoteInputEvent =
  | { note: MidiNoteInput; type: "press" | "release" }
  | { type: "reset" };

export function isPianoKeyName(value: string): value is PianoKeyName {
  return PIANO_KEY_NAMES.includes(value as PianoKeyName);
}

export function makeMidiKeyId(inputId: string, channel: number, midiNoteNumber: number): string {
  return `${inputId}:${channel}:${midiNoteNumber}`;
}

export function registerMidiPress<T>(pressed: Map<string, T>, keyId: string, value: T): boolean {
  if (pressed.has(keyId)) {
    return false;
  }
  pressed.set(keyId, value);
  return true;
}

export function getInitialMidiAccessStatus(
  isSecureContext: boolean,
  hasNativeMidiAccess: boolean,
): MidiAccessStatus {
  if (!isSecureContext) {
    return "insecure-context";
  }
  return hasNativeMidiAccess ? "idle" : "unsupported";
}
