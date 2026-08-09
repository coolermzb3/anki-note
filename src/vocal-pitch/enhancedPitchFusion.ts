import {
  frequencyToMidi,
  midiToFrequency,
  type VocalPitchAnalysis,
  type VocalPitchAnalysisConfig,
  type VocalPitchFrame,
} from "../domain/vocalPitch";

const CONSENSUS_CLUSTER_SEMITONES = 1;
const ENHANCED_HOP_SECONDS = 0.01;
const MAX_GAP_FRAMES = 5;
const MAX_GAP_RESIDUAL_SEMITONES = 1;

export interface NeuralPitchTrack {
  confidence: Float32Array;
  frequenciesHz: Float32Array;
  timesSeconds: Float32Array;
}

function alignedFrequency(track: NeuralPitchTrack, timeSeconds: number): number | null {
  if (track.timesSeconds.length === 0) return null;
  let low = 0;
  let high = track.timesSeconds.length - 1;
  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    if (track.timesSeconds[middle] < timeSeconds) low = middle + 1;
    else high = middle;
  }
  const right = low;
  const left = Math.max(0, right - 1);
  const nearest = Math.abs(track.timesSeconds[left] - timeSeconds) <= Math.abs(track.timesSeconds[right] - timeSeconds)
    ? left
    : right;
  const hopSeconds = track.timesSeconds.length > 1 ? track.timesSeconds[1] - track.timesSeconds[0] : ENHANCED_HOP_SECONDS;
  if (Math.abs(track.timesSeconds[nearest] - timeSeconds) > Math.max(0.006, hopSeconds * 0.6)) return null;
  const frequencyHz = track.frequenciesHz[nearest];
  return Number.isFinite(frequencyHz) && frequencyHz > 0 ? frequencyHz : null;
}

function analysisTrack(analysis: VocalPitchAnalysis): NeuralPitchTrack {
  return {
    confidence: Float32Array.from(analysis.frames, (frame) => frame.confidence),
    frequenciesHz: Float32Array.from(analysis.frames, (frame) => frame.frequencyHz ?? Number.NaN),
    timesSeconds: Float32Array.from(analysis.frames, (frame) => frame.timeSeconds),
  };
}

function consensusMidi(frequenciesHz: readonly (number | null)[]): { midi: number; votes: number } | null {
  const voiced = frequenciesHz.flatMap((frequencyHz) => frequencyHz === null ? [] : [frequencyToMidi(frequencyHz)]);
  if (voiced.length < 2) return null;
  voiced.sort((left, right) => left - right);
  let bestStart = 0;
  let bestEnd = 0;
  let left = 0;
  for (let right = 0; right < voiced.length; right += 1) {
    while (voiced[right] - voiced[left] > CONSENSUS_CLUSTER_SEMITONES) left += 1;
    if (right - left > bestEnd - bestStart) {
      bestStart = left;
      bestEnd = right;
    }
  }
  const votes = bestEnd - bestStart + 1;
  if (votes < 2 || votes <= voiced.length / 2) return null;
  const cluster = voiced.slice(bestStart, bestEnd + 1);
  const middle = Math.floor(cluster.length / 2);
  const midi = cluster.length % 2 === 0 ? (cluster[middle - 1] + cluster[middle]) / 2 : cluster[middle];
  return { midi, votes };
}

function nearestAnchoredFcpe(fcpeHz: number | null, referenceMidi: number): number | null {
  if (fcpeHz === null) return null;
  const fcpeMidi = frequencyToMidi(fcpeHz);
  const options = [fcpeMidi - 12, fcpeMidi, fcpeMidi + 12];
  const best = options.reduce((current, candidate) =>
    Math.abs(candidate - referenceMidi) < Math.abs(current - referenceMidi) ? candidate : current,
  );
  return Math.abs(best - referenceMidi) <= CONSENSUS_CLUSTER_SEMITONES ? midiToFrequency(best) : null;
}

export function fillReliableFcpeGaps(
  frames: readonly VocalPitchFrame[],
  rawFcpeHz: readonly (number | null)[],
): VocalPitchFrame[] {
  const result = frames.map((frame) => ({ ...frame }));
  let index = 0;
  while (index < result.length) {
    if (result[index].frequencyHz !== null) {
      index += 1;
      continue;
    }
    const start = index;
    while (index < result.length && result[index].frequencyHz === null) index += 1;
    const end = index;
    if (start === 0 || end === result.length || end - start > MAX_GAP_FRAMES) continue;
    const leftMidi = frequencyToMidi(result[start - 1].frequencyHz!);
    const rightMidi = frequencyToMidi(result[end].frequencyHz!);
    const replacements: number[] = [];
    for (let gapIndex = start; gapIndex < end; gapIndex += 1) {
      const fcpeHz = rawFcpeHz[gapIndex];
      if (fcpeHz === null || !Number.isFinite(fcpeHz) || fcpeHz <= 0) {
        replacements.length = 0;
        break;
      }
      const progress = (gapIndex - start + 1) / (end - start + 1);
      const expectedMidi = leftMidi + (rightMidi - leftMidi) * progress;
      if (Math.abs(frequencyToMidi(fcpeHz) - expectedMidi) > MAX_GAP_RESIDUAL_SEMITONES) {
        replacements.length = 0;
        break;
      }
      replacements.push(fcpeHz);
    }
    if (replacements.length !== end - start) continue;
    for (let gapIndex = start; gapIndex < end; gapIndex += 1) {
      result[gapIndex] = { ...result[gapIndex], confidence: 1 / 3, frequencyHz: replacements[gapIndex - start] };
    }
  }
  return result;
}

export function fuseEnhancedPitchTracks(
  mpmAnalysis: VocalPitchAnalysis,
  swiftf0: NeuralPitchTrack,
  fcpe: NeuralPitchTrack,
  durationSeconds: number,
): VocalPitchFrame[] {
  const mpm = analysisTrack(mpmAnalysis);
  const frameCount = Math.max(1, Math.ceil(durationSeconds / ENHANCED_HOP_SECONDS));
  const frames: VocalPitchFrame[] = [];
  const alignedFcpe: (number | null)[] = [];

  for (let frameIndex = 0; frameIndex < frameCount; frameIndex += 1) {
    const timeSeconds = frameIndex * ENHANCED_HOP_SECONDS;
    const mpmHz = alignedFrequency(mpm, timeSeconds);
    const swiftHz = alignedFrequency(swiftf0, timeSeconds);
    const fcpeHz = alignedFrequency(fcpe, timeSeconds);
    alignedFcpe.push(fcpeHz);
    const consensus = consensusMidi([mpmHz, swiftHz, fcpeHz]);
    let frequencyHz: number | null = null;
    let confidence = 0;
    if (consensus) {
      frequencyHz = nearestAnchoredFcpe(fcpeHz, consensus.midi);
      if (frequencyHz === null && swiftHz !== null && Math.abs(frequencyToMidi(swiftHz) - consensus.midi) <= 1) {
        frequencyHz = swiftHz;
      }
      confidence = frequencyHz === null ? 0 : consensus.votes / 3;
    } else if (fcpeHz !== null && mpmHz === null && swiftHz === null) {
      frequencyHz = fcpeHz;
      confidence = 1 / 3;
    }
    frames.push({ confidence, frequencyHz, timeSeconds });
  }
  return fillReliableFcpeGaps(frames, alignedFcpe);
}

export function createEnhancedPitchAnalysis(
  mpmAnalysis: VocalPitchAnalysis,
  swiftf0: NeuralPitchTrack,
  fcpe: NeuralPitchTrack,
  durationSeconds: number,
  config: VocalPitchAnalysisConfig,
): VocalPitchAnalysis {
  return {
    schemaVersion: 1,
    analyzedAt: new Date().toISOString(),
    config,
    detectorId: "mpm-c-swiftf0-fcpe",
    detectorVersion: 2,
    frames: fuseEnhancedPitchTracks(mpmAnalysis, swiftf0, fcpe, durationSeconds),
    hopSeconds: ENHANCED_HOP_SECONDS,
    sampleRate: mpmAnalysis.sampleRate,
  };
}
