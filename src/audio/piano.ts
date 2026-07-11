import * as Tone from "tone";
import { noteToToneName } from "../domain/notes";
import { DEFAULT_PIANO_VOLUME, normalizePianoVolume } from "../domain/settings";
import type { Octave, PianoKeyName, TargetNote } from "../domain/types";

const PIANO_SAMPLE_BASE_URL = "https://tonejs.github.io/audio/salamander/";
const PIANO_SAMPLE_URLS = {
  A0: "A0.mp3",
  C1: "C1.mp3",
  "D#1": "Ds1.mp3",
  "F#1": "Fs1.mp3",
  A1: "A1.mp3",
  C2: "C2.mp3",
  "D#2": "Ds2.mp3",
  "F#2": "Fs2.mp3",
  A2: "A2.mp3",
  C3: "C3.mp3",
  "D#3": "Ds3.mp3",
  "F#3": "Fs3.mp3",
  A3: "A3.mp3",
  C4: "C4.mp3",
  "D#4": "Ds4.mp3",
  "F#4": "Fs4.mp3",
  A4: "A4.mp3",
  C5: "C5.mp3",
  "D#5": "Ds5.mp3",
  "F#5": "Fs5.mp3",
  A5: "A5.mp3",
  C6: "C6.mp3",
  "D#6": "Ds6.mp3",
  "F#6": "Fs6.mp3",
  A6: "A6.mp3",
  C7: "C7.mp3",
} as const;

type SamplerStatus = "idle" | "loading" | "loaded" | "failed";
interface GetSamplerOptions {
  retryFailed?: boolean;
}

export interface SustainedPianoNote {
  release: () => void;
}

let sampler: Tone.Sampler | undefined;
let samplerLoadPromise: Promise<void> | undefined;
let samplerStatus: SamplerStatus = "idle";
let fallbackSynth: Tone.PolySynth | undefined;
let pianoVolume = DEFAULT_PIANO_VOLUME;

function normalizeError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}

function getFallbackSynth(): Tone.PolySynth {
  fallbackSynth ??= new Tone.PolySynth(Tone.Synth, {
    oscillator: { type: "triangle" },
    envelope: { attack: 0.01, decay: 0.18, sustain: 0.35, release: 0.6 },
  }).toDestination();
  return fallbackSynth;
}

function resetFailedSampler(): void {
  sampler?.dispose();
  sampler = undefined;
  samplerLoadPromise = undefined;
  samplerStatus = "idle";
}

function getSampler({ retryFailed = false }: GetSamplerOptions = {}): Tone.Sampler | undefined {
  if (samplerStatus === "failed") {
    if (!retryFailed) {
      return undefined;
    }
    resetFailedSampler();
  }
  if (sampler) {
    return sampler;
  }

  samplerStatus = "loading";
  samplerLoadPromise = new Promise<void>((resolve, reject) => {
    const markLoaded = (): void => {
      if (samplerStatus === "failed") {
        return;
      }
      samplerStatus = "loaded";
      resolve();
    };
    const markFailed = (error: unknown): void => {
      samplerStatus = "failed";
      sampler?.dispose();
      sampler = undefined;
      reject(normalizeError(error));
    };

    try {
      // Salamander Grand Piano samples by Alexander Holm, CC BY 3.0. See THIRD_PARTY_AUDIO.md.
      sampler = new Tone.Sampler({
        urls: PIANO_SAMPLE_URLS,
        baseUrl: PIANO_SAMPLE_BASE_URL,
        release: 0.8,
        onload: markLoaded,
        onerror: markFailed,
      }).toDestination();
    } catch (error) {
      markFailed(error);
    }
  });
  samplerLoadPromise.catch(() => undefined);

  return sampler;
}

function getLoadedSampler(): Tone.Sampler | undefined {
  const currentSampler = getSampler();
  if (!currentSampler || samplerStatus === "failed") {
    return undefined;
  }
  if (currentSampler.loaded || samplerStatus === "loaded") {
    return currentSampler;
  }
  return undefined;
}

export function preloadPianoSamples(): void {
  getSampler();
}

export function setPianoVolume(volume: number): void {
  pianoVolume = normalizePianoVolume(volume);
}

export async function unlockAudio(): Promise<void> {
  await Tone.start();
  getSampler({ retryFailed: true });
}

export async function playPianoNote(noteName: PianoKeyName, octave: Octave): Promise<void> {
  await unlockAudio();
  const note = noteToToneName(noteName, octave);
  const sampledPiano = getLoadedSampler();
  if (sampledPiano) {
    sampledPiano.triggerAttackRelease(note, "8n", undefined, pianoVolume);
    return;
  }
  getFallbackSynth().triggerAttackRelease(note, "8n", undefined, pianoVolume);
}

export async function startPianoNote(noteName: PianoKeyName, octave: Octave): Promise<SustainedPianoNote> {
  await unlockAudio();
  const note = noteToToneName(noteName, octave);
  const sampledPiano = getLoadedSampler();
  let released = false;

  if (sampledPiano) {
    sampledPiano.triggerAttack(note, undefined, pianoVolume);
    return {
      release: () => {
        if (released) {
          return;
        }
        released = true;
        sampledPiano.triggerRelease(note);
      },
    };
  }

  const synth = getFallbackSynth();
  synth.triggerAttack(note, undefined, pianoVolume);
  return {
    release: () => {
      if (released) {
        return;
      }
      released = true;
      synth.triggerRelease(note);
    },
  };
}

export async function playTargetNote(note: TargetNote): Promise<void> {
  await playPianoNote(note.noteName, note.octave);
}

export async function startTargetNote(note: TargetNote): Promise<SustainedPianoNote> {
  return startPianoNote(note.noteName, note.octave);
}
