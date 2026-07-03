import * as Tone from "tone";
import { noteToToneName } from "../domain/notes";
import type { NoteName, Octave, TargetNote } from "../domain/types";

let synth: Tone.PolySynth | undefined;

function getSynth(): Tone.PolySynth {
  synth ??= new Tone.PolySynth(Tone.Synth, {
    oscillator: { type: "triangle" },
    envelope: { attack: 0.01, decay: 0.18, sustain: 0.35, release: 0.6 },
  }).toDestination();
  return synth;
}

export async function unlockAudio(): Promise<void> {
  await Tone.start();
  getSynth();
}

export async function playPianoNote(noteName: NoteName, octave: Octave): Promise<void> {
  await unlockAudio();
  getSynth().triggerAttackRelease(noteToToneName(noteName, octave), "8n");
}

export async function playTargetNote(note: TargetNote): Promise<void> {
  await playPianoNote(note.noteName, note.octave);
}
