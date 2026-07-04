import { NOTE_NAMES } from "./notes";
import type { PitchId, TargetNote, TargetNoteId } from "./types";

interface MelodyPitch {
  pitchId: PitchId;
  degree: number;
  notes: TargetNote[];
}

const MELODY_PHRASE_LENGTH = 8;
const MELODY_MOTIF_LENGTH = 4;
const CADENCE_NOTE_NAMES = new Set(["C", "E", "G"]);
const FINAL_CADENCE_NOTE_NAMES = new Set(["C", "G"]);

function noteDegree(note: TargetNote): number {
  return note.octave * NOTE_NAMES.length + NOTE_NAMES.indexOf(note.noteName);
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function getMelodyPitches(notes: TargetNote[]): MelodyPitch[] {
  const byPitch = new Map<PitchId, MelodyPitch>();
  for (const note of notes) {
    const current = byPitch.get(note.pitchId);
    if (current) {
      current.notes.push(note);
      continue;
    }
    byPitch.set(note.pitchId, {
      pitchId: note.pitchId,
      degree: noteDegree(note),
      notes: [note],
    });
  }
  return [...byPitch.values()]
    .map((pitch) => ({ ...pitch, notes: [...pitch.notes].sort((a, b) => a.id.localeCompare(b.id)) }))
    .sort((a, b) => a.degree - b.degree || a.pitchId.localeCompare(b.pitchId));
}

function chooseFromIndexes(indexes: number[], rng: () => number): number {
  return indexes[Math.floor(rng() * indexes.length)] ?? indexes[0];
}

function choosePreferredStartIndex(pitches: MelodyPitch[], rng: () => number): number {
  const preferred = pitches
    .map((pitch, index) => (CADENCE_NOTE_NAMES.has(pitch.notes[0].noteName) ? index : -1))
    .filter((index) => index >= 0);
  return chooseFromIndexes(preferred.length > 0 ? preferred : pitches.map((_, index) => index), rng);
}

function chooseCadenceIndex(
  pitches: MelodyPitch[],
  previousIndex: number,
  isFinalCadence: boolean,
  rng: () => number,
): number {
  const preferredNames = isFinalCadence ? FINAL_CADENCE_NOTE_NAMES : CADENCE_NOTE_NAMES;
  const candidates = pitches
    .map((pitch, index) => (preferredNames.has(pitch.notes[0].noteName) ? index : -1))
    .filter((index) => index >= 0);
  const fallbackCandidates =
    candidates.length > 0
      ? candidates
      : pitches
          .map((pitch, index) => (CADENCE_NOTE_NAMES.has(pitch.notes[0].noteName) ? index : -1))
          .filter((index) => index >= 0);
  const source = fallbackCandidates.length > 0 ? fallbackCandidates : pitches.map((_, index) => index);
  const nearestDistance = Math.min(...source.map((index) => Math.abs(index - previousIndex)));
  return chooseFromIndexes(
    source.filter((index) => Math.abs(index - previousIndex) === nearestDistance),
    rng,
  );
}

function chooseMelodicDelta(rng: () => number): number {
  const roll = rng();
  if (roll < 0.6) {
    return rng() < 0.5 ? -1 : 1;
  }
  if (roll < 0.85) {
    const magnitude = rng() < 0.5 ? 2 : 3;
    return rng() < 0.5 ? -magnitude : magnitude;
  }
  if (roll < 0.95) {
    return 0;
  }
  const magnitude = rng() < 0.5 ? 4 : 5;
  return rng() < 0.5 ? -magnitude : magnitude;
}

function varyMotifDelta(delta: number, rng: () => number): number {
  const roll = rng();
  if (roll < 0.65) {
    return delta;
  }
  if (roll < 0.82) {
    return -delta;
  }
  if (delta === 0) {
    return rng() < 0.5 ? -1 : 1;
  }
  return Math.sign(delta) * Math.max(1, Math.abs(delta) - 1);
}

function moveWithinRange(index: number, delta: number, maxIndex: number): number {
  if (delta === 0 || maxIndex === 0) {
    return index;
  }

  const target = index + delta;
  if (target >= 0 && target <= maxIndex) {
    return target;
  }

  const reflected = index - delta;
  if (reflected >= 0 && reflected <= maxIndex) {
    return reflected;
  }

  return clamp(target, 0, maxIndex);
}

function chooseTargetNoteForPitch(pitch: MelodyPitch, rng: () => number): TargetNote {
  return pitch.notes[Math.floor(rng() * pitch.notes.length)] ?? pitch.notes[0];
}

export function selectMelodyNotes({
  notes,
  count,
  lastTargetNoteId,
  rng = Math.random,
}: {
  notes: TargetNote[];
  count: number;
  lastTargetNoteId?: TargetNoteId;
  rng?: () => number;
}): TargetNote[] {
  if (notes.length === 0) {
    throw new Error("Cannot select a note without enabled groups.");
  }

  const pitches = getMelodyPitches(notes);
  const lastPitchIndex =
    lastTargetNoteId === undefined ? -1 : pitches.findIndex((pitch) => pitch.notes.some((note) => note.id === lastTargetNoteId));
  let previousIndex = lastPitchIndex >= 0 ? lastPitchIndex : choosePreferredStartIndex(pitches, rng);
  let previousDelta = 0;
  let previousWasLargeLeap = false;
  let motifDeltas: number[] = [];
  const selected: TargetNote[] = [];

  for (let index = 0; index < count; index += 1) {
    const positionInPhrase = index % MELODY_PHRASE_LENGTH;
    if (positionInPhrase === 0) {
      motifDeltas = [];
    }

    const shouldUseInitialPitch = index === 0 && lastPitchIndex < 0;
    const isPhraseEnd = (index + 1) % MELODY_PHRASE_LENGTH === 0 || (count > 1 && index === count - 1);
    let nextIndex = previousIndex;

    if (!shouldUseInitialPitch) {
      if (isPhraseEnd) {
        nextIndex = chooseCadenceIndex(pitches, previousIndex, index === count - 1, rng);
      } else {
        const motifDelta = motifDeltas[positionInPhrase - MELODY_MOTIF_LENGTH];
        const delta =
          previousWasLargeLeap && previousDelta !== 0
            ? -Math.sign(previousDelta)
            : motifDelta !== undefined && rng() < 0.72
              ? varyMotifDelta(motifDelta, rng)
              : chooseMelodicDelta(rng);
        nextIndex = moveWithinRange(previousIndex, delta, pitches.length - 1);
      }
    }

    const actualDelta = nextIndex - previousIndex;
    if (positionInPhrase < MELODY_MOTIF_LENGTH && !shouldUseInitialPitch) {
      motifDeltas[positionInPhrase] = actualDelta;
    }
    selected.push(chooseTargetNoteForPitch(pitches[nextIndex], rng));
    previousIndex = nextIndex;
    previousDelta = actualDelta;
    previousWasLargeLeap = Math.abs(actualDelta) >= 4;
  }

  return selected;
}
