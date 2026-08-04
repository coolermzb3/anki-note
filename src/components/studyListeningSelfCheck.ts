import { getTargetMidiNoteNumber } from "../domain/answerInput";
import { NOTE_NAMES } from "../domain/notes";
import { compareTargetNotePitch, dedupeTargetNotePitches } from "../domain/staffRecall";
import type { NoteName, TargetNote } from "../domain/types";

export type StudyPlaybackMode = "single" | "octaves";
export type ListeningAttemptState = "untouched" | "wrong" | "solved";

export interface HeldNoteSequence {
  cancelled: boolean;
  releases: Array<() => void>;
  settled: Promise<void>;
}

export type ListeningSelfCheckTarget =
  | { mode: "single"; pitch: TargetNote }
  | { mode: "octaves"; noteName: NoteName };

export function beginHeldNoteSequence(
  held: HeldNoteSequence,
  notes: readonly TargetNote[],
  beforeStart: Promise<void>,
  startNote: (note: TargetNote) => Promise<{ release: () => void } | undefined>,
  afterStart?: () => Promise<void> | undefined,
): void {
  held.settled = (async () => {
    await beforeStart;
    for (const note of notes) {
      if (held.cancelled) {
        break;
      }
      const sustained = await startNote(note);
      if (!sustained) {
        continue;
      }
      if (held.cancelled) {
        sustained.release();
        break;
      }
      held.releases.push(sustained.release);
      const pause = afterStart?.();
      if (pause) {
        await pause;
      }
    }
  })();
}

export function releaseHeldNoteSequence(held: HeldNoteSequence): Promise<void> {
  held.cancelled = true;
  held.releases.splice(0).forEach((release) => release());
  return held.settled;
}

export function getUniqueStudyPitches(notes: readonly TargetNote[]): TargetNote[] {
  return dedupeTargetNotePitches([...notes]).sort(compareTargetNotePitch);
}

export function getStudyPitchPoolKey(pitches: readonly TargetNote[]): string {
  return pitches.map((pitch) => pitch.pitchId).join(",");
}

function randomItem<T>(items: readonly T[], random: () => number): T | undefined {
  if (items.length === 0) {
    return undefined;
  }
  return items[Math.min(Math.floor(random() * items.length), items.length - 1)];
}

export function selectListeningSelfCheckTarget(
  mode: StudyPlaybackMode,
  pitches: readonly TargetNote[],
  previous: ListeningSelfCheckTarget | undefined,
  random: () => number = Math.random,
): ListeningSelfCheckTarget | undefined {
  if (mode === "single") {
    const candidates =
      pitches.length > 1 && previous?.mode === "single"
        ? pitches.filter((pitch) => pitch.pitchId !== previous.pitch.pitchId)
        : pitches;
    const pitch = randomItem(candidates, random);
    return pitch ? { mode, pitch } : undefined;
  }

  const availableNames = NOTE_NAMES.filter((noteName) => pitches.some((pitch) => pitch.noteName === noteName));
  const candidates =
    availableNames.length > 1 && previous?.mode === "octaves"
      ? availableNames.filter((noteName) => noteName !== previous.noteName)
      : availableNames;
  const noteName = randomItem(candidates, random);
  return noteName ? { mode, noteName } : undefined;
}

export function selectFreeSinglePitch(
  noteName: NoteName,
  pitches: readonly TargetNote[],
  random: () => number = Math.random,
): TargetNote | undefined {
  return randomItem(pitches.filter((pitch) => pitch.noteName === noteName), random);
}

export function findNearestAnswerPitch(
  noteName: NoteName,
  target: TargetNote,
  pitches: readonly TargetNote[],
): TargetNote | undefined {
  const targetMidi = getTargetMidiNoteNumber(target);
  return pitches
    .filter((pitch) => pitch.noteName === noteName)
    .sort((left, right) => {
      const distance =
        Math.abs(getTargetMidiNoteNumber(left) - targetMidi) -
        Math.abs(getTargetMidiNoteNumber(right) - targetMidi);
      if (distance !== 0) {
        return distance;
      }
      const octavePreference = Number(right.octave === target.octave) - Number(left.octave === target.octave);
      return octavePreference || getTargetMidiNoteNumber(left) - getTargetMidiNoteNumber(right);
    })[0];
}

export function shouldRerollListeningTarget(attempt: ListeningAttemptState): boolean {
  return attempt !== "wrong";
}

export function recordListeningAttempt(
  current: ListeningAttemptState,
  correct: boolean,
): ListeningAttemptState {
  if (current === "solved" || correct) {
    return "solved";
  }
  return "wrong";
}

export function getListeningTargetNoteName(target: ListeningSelfCheckTarget): NoteName {
  return target.mode === "single" ? target.pitch.noteName : target.noteName;
}
