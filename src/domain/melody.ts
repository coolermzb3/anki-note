import { NOTE_NAMES } from "./notes";
import type { PitchId, TargetNote, TargetNoteId } from "./types";

interface MelodyPitch {
  pitchId: PitchId;
  degree: number;
  notes: TargetNote[];
}

interface MelodyRegister {
  endIndex: number;
  startIndex: number;
}

export interface MelodyGenerationState {
  currentRegisterIndex?: number;
  motifDeltas: number[];
  phrasePosition: number;
  pitchVisitCounts: Partial<Record<PitchId, number>>;
  registerVisitCounts: number[];
  transitionPitchIds: PitchId[];
}

const MELODY_PHRASE_LENGTH = 8;
const MELODY_MOTIF_LENGTH = 4;
const REGISTER_TRANSFER_RATE = 0.5;
const NEAREST_REGISTER_RATE = 0.7;
const DIATONIC_DEGREES_PER_REGISTER = 7;
const CADENCE_NOTE_NAMES = new Set(["C", "E", "G"]);
const FINAL_CADENCE_NOTE_NAMES = new Set(["C", "G"]);

export function createMelodyGenerationState(): MelodyGenerationState {
  return {
    motifDeltas: [],
    phrasePosition: 0,
    pitchVisitCounts: {},
    registerVisitCounts: [],
    transitionPitchIds: [],
  };
}

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

function getMelodyRegisters(pitches: MelodyPitch[]): MelodyRegister[] {
  const span = pitches[pitches.length - 1].degree - pitches[0].degree;
  const registerCount = Math.max(1, Math.round(span / DIATONIC_DEGREES_PER_REGISTER));
  return Array.from({ length: registerCount }, (_, index) => ({
    startIndex: Math.floor((index * pitches.length) / registerCount),
    endIndex: Math.floor(((index + 1) * pitches.length) / registerCount) - 1,
  }));
}

function indexesForRegister(register: MelodyRegister): number[] {
  return Array.from({ length: register.endIndex - register.startIndex + 1 }, (_, offset) => register.startIndex + offset);
}

function chooseFromIndexes(indexes: number[], rng: () => number): number {
  return indexes[Math.floor(rng() * indexes.length)] ?? indexes[0];
}

function chooseRegisterAnchorIndex(
  pitches: MelodyPitch[],
  register: MelodyRegister,
  pitchVisitCounts: MelodyGenerationState["pitchVisitCounts"],
  rng: () => number,
): number {
  const indexes = indexesForRegister(register);
  const stableIndexes = indexes.filter((index) => CADENCE_NOTE_NAMES.has(pitches[index].notes[0].noteName));
  const source = stableIndexes.length > 0 ? stableIndexes : indexes;
  const minimumVisits = Math.min(...source.map((index) => pitchVisitCounts[pitches[index].pitchId] ?? 0));
  return chooseFromIndexes(
    source.filter((index) => (pitchVisitCounts[pitches[index].pitchId] ?? 0) === minimumVisits),
    rng,
  );
}

function chooseCadenceIndex(
  pitches: MelodyPitch[],
  register: MelodyRegister,
  previousIndex: number,
  isFinalCadence: boolean,
  rng: () => number,
): number {
  const indexes = indexesForRegister(register);
  const preferredNames = isFinalCadence ? FINAL_CADENCE_NOTE_NAMES : CADENCE_NOTE_NAMES;
  const preferred = indexes.filter((index) => preferredNames.has(pitches[index].notes[0].noteName));
  const fallback = preferred.length > 0
    ? preferred
    : indexes.filter((index) => CADENCE_NOTE_NAMES.has(pitches[index].notes[0].noteName));
  const source = fallback.length > 0 ? fallback : indexes;
  const nearestDistance = Math.min(...source.map((index) => Math.abs(index - previousIndex)));
  return chooseFromIndexes(
    source.filter((index) => Math.abs(index - previousIndex) === nearestDistance),
    rng,
  );
}

function chooseCoverageAwareMelodicIndex(
  pitches: MelodyPitch[],
  register: MelodyRegister,
  previousIndex: number,
  pitchVisitCounts: MelodyGenerationState["pitchVisitCounts"],
  rng: () => number,
): number {
  const roll = rng();
  if (roll >= 0.9) {
    return previousIndex;
  }
  const magnitude = roll < 0.65 ? 1 : rng() < 0.5 ? 2 : 3;
  const candidates = [previousIndex - magnitude, previousIndex + magnitude].filter(
    (index) => index >= register.startIndex && index <= register.endIndex,
  );
  if (candidates.length === 0) {
    return previousIndex;
  }
  const weights = candidates.map((index) => 1 / (1 + (pitchVisitCounts[pitches[index].pitchId] ?? 0)));
  let cursor = rng() * weights.reduce((sum, weight) => sum + weight, 0);
  for (let index = 0; index < candidates.length; index += 1) {
    cursor -= weights[index];
    if (cursor <= 0) {
      return candidates[index];
    }
  }
  return candidates[candidates.length - 1];
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

function moveWithinRange(index: number, delta: number, minIndex: number, maxIndex: number): number {
  if (delta === 0 || minIndex === maxIndex) {
    return index;
  }
  const target = index + delta;
  if (target >= minIndex && target <= maxIndex) {
    return target;
  }
  const reflected = index - delta;
  if (reflected >= minIndex && reflected <= maxIndex) {
    return reflected;
  }
  return clamp(target, minIndex, maxIndex);
}

function chooseNextRegisterIndex(
  currentRegisterIndex: number,
  registerVisitCounts: number[],
  rng: () => number,
): number {
  const otherIndexes = registerVisitCounts.map((_, index) => index).filter((index) => index !== currentRegisterIndex);
  const minimumVisits = Math.min(...otherIndexes.map((index) => registerVisitCounts[index]));
  const leastVisited = otherIndexes.filter((index) => registerVisitCounts[index] === minimumVisits);
  if (rng() >= NEAREST_REGISTER_RATE) {
    return chooseFromIndexes(leastVisited, rng);
  }
  const nearestDistance = Math.min(...leastVisited.map((index) => Math.abs(index - currentRegisterIndex)));
  return chooseFromIndexes(
    leastVisited.filter((index) => Math.abs(index - currentRegisterIndex) === nearestDistance),
    rng,
  );
}

function chooseTransitionIntermediateCount(rng: () => number): number {
  const roll = rng();
  if (roll < 0.4) {
    return 0;
  }
  if (roll < 0.7) {
    return 1;
  }
  if (roll < 0.9) {
    return 2;
  }
  return 3;
}

function chooseTransitionPitchIds(
  pitches: MelodyPitch[],
  startIndex: number,
  targetIndex: number,
  rng: () => number,
): PitchId[] {
  const direction = Math.sign(targetIndex - startIndex);
  const candidates = Array.from(
    { length: Math.max(0, Math.abs(targetIndex - startIndex) - 1) },
    (_, offset) => startIndex + direction * (offset + 1),
  );
  const count = Math.min(chooseTransitionIntermediateCount(rng), candidates.length);
  const selected: number[] = [];
  for (let index = 0; index < count; index += 1) {
    const candidateIndex = Math.floor(rng() * candidates.length);
    selected.push(candidates.splice(candidateIndex, 1)[0]);
  }
  selected.sort((a, b) => direction * (a - b));
  return [...selected, targetIndex].map((index) => pitches[index].pitchId);
}

function chooseTargetNoteForPitch(pitch: MelodyPitch, rng: () => number): TargetNote {
  return pitch.notes[Math.floor(rng() * pitch.notes.length)] ?? pitch.notes[0];
}

export function selectMelodyNotes({
  notes,
  count,
  lastTargetNoteId,
  state = createMelodyGenerationState(),
  rng = Math.random,
}: {
  notes: TargetNote[];
  count: number;
  lastTargetNoteId?: TargetNoteId;
  state?: MelodyGenerationState;
  rng?: () => number;
}): TargetNote[] {
  if (notes.length === 0) {
    throw new Error("Cannot select a note without enabled groups.");
  }

  const pitches = getMelodyPitches(notes);
  const registers = getMelodyRegisters(pitches);
  if (state.registerVisitCounts.length !== registers.length) {
    state.currentRegisterIndex = undefined;
    state.registerVisitCounts = Array.from({ length: registers.length }, () => 0);
  }
  let previousIndex = lastTargetNoteId === undefined
    ? -1
    : pitches.findIndex((pitch) => pitch.notes.some((note) => note.id === lastTargetNoteId));
  const selected: TargetNote[] = [];

  for (let index = 0; index < count; index += 1) {
    const positionInPhrase = state.phrasePosition;
    let initialPitch = false;
    let transitionPitch = false;

    if (positionInPhrase === 0) {
      state.motifDeltas = [];
      state.transitionPitchIds = [];
      if (state.currentRegisterIndex === undefined) {
        state.currentRegisterIndex = previousIndex >= 0
          ? registers.findIndex((register) => previousIndex >= register.startIndex && previousIndex <= register.endIndex)
          : Math.floor(rng() * registers.length);
      } else if (registers.length > 1 && rng() < REGISTER_TRANSFER_RATE) {
        const nextRegisterIndex = chooseNextRegisterIndex(state.currentRegisterIndex, state.registerVisitCounts, rng);
        const targetIndex = chooseRegisterAnchorIndex(
          pitches,
          registers[nextRegisterIndex],
          state.pitchVisitCounts,
          rng,
        );
        if (previousIndex >= 0) {
          state.transitionPitchIds = chooseTransitionPitchIds(pitches, previousIndex, targetIndex, rng);
        }
        state.currentRegisterIndex = nextRegisterIndex;
      }
      state.registerVisitCounts[state.currentRegisterIndex] += 1;
    }

    const register = registers[state.currentRegisterIndex ?? 0];
    let nextIndex = previousIndex;
    const transitionPitchId = state.transitionPitchIds.shift();
    if (transitionPitchId !== undefined) {
      nextIndex = pitches.findIndex((pitch) => pitch.pitchId === transitionPitchId);
      transitionPitch = true;
    } else if (previousIndex < 0) {
      nextIndex = chooseRegisterAnchorIndex(pitches, register, state.pitchVisitCounts, rng);
      initialPitch = true;
    } else if (positionInPhrase === MELODY_PHRASE_LENGTH - 1 || (count > 1 && index === count - 1)) {
      nextIndex = chooseCadenceIndex(pitches, register, previousIndex, index === count - 1, rng);
    } else {
      const motifDelta = state.motifDeltas[positionInPhrase - MELODY_MOTIF_LENGTH];
      nextIndex = motifDelta !== undefined && rng() < 0.72
        ? moveWithinRange(
            previousIndex,
            varyMotifDelta(motifDelta, rng),
            register.startIndex,
            register.endIndex,
          )
        : chooseCoverageAwareMelodicIndex(pitches, register, previousIndex, state.pitchVisitCounts, rng);
    }

    const actualDelta = previousIndex < 0 ? 0 : nextIndex - previousIndex;
    if (positionInPhrase < MELODY_MOTIF_LENGTH && !initialPitch && !transitionPitch) {
      state.motifDeltas[positionInPhrase] = actualDelta;
    }
    const pitch = pitches[nextIndex];
    state.pitchVisitCounts[pitch.pitchId] = (state.pitchVisitCounts[pitch.pitchId] ?? 0) + 1;
    selected.push(chooseTargetNoteForPitch(pitch, rng));
    previousIndex = nextIndex;
    state.phrasePosition = (positionInPhrase + 1) % MELODY_PHRASE_LENGTH;
  }

  return selected;
}
