import {
  normalizeVocalPitchConfig,
  VOCAL_PITCH_MAX_FREQUENCY_HZ,
  VOCAL_PITCH_MIN_FREQUENCY_HZ,
  type VocalPitchAnalysis,
  type VocalPitchAnalysisConfig,
  type VocalPitchFrame,
} from "../domain/vocalPitch";
import {
  createPitchFrameDetector,
  getPitchFrameSize,
  type PitchFrameCandidate,
  VOCAL_PITCH_DETECTOR_ID,
  VOCAL_PITCH_DETECTOR_VERSION,
} from "./pitchFrameDetector";
import {
  classifyPitchFrame,
  MIN_VOICED_RMS,
  type ClassifiedPitchFrame,
} from "./pitchFrameClassifier";

const MAX_RELIABLE_GAP_FRAMES = 6;
const MAX_SHORT_OCTAVE_EXCURSION_FRAMES = 4;
const ALTERNATIVE_CANDIDATE_COST = 0.1;
const FREE_TRANSITION_SEMITONES = 1.5;
const TRANSITION_COST_PER_SEMITONE = 0.5;

function semitonesApart(left: number, right: number): number {
  return Math.abs(12 * Math.log2(left / right));
}

function isVoicedCandidate(
  candidate: ClassifiedPitchFrame["candidate"],
  rms: number,
  config: VocalPitchAnalysisConfig,
): boolean {
  return (
    rms >= MIN_VOICED_RMS &&
    candidate.clarity >= config.voicingThreshold &&
    candidate.frequencyHz >= VOCAL_PITCH_MIN_FREQUENCY_HZ &&
    candidate.frequencyHz <= VOCAL_PITCH_MAX_FREQUENCY_HZ
  );
}

interface CandidatePathOption {
  candidate: ClassifiedPitchFrame["candidate"];
  observationCost: number;
}

function getCandidatePathOptions(
  classification: ClassifiedPitchFrame,
  config: VocalPitchAnalysisConfig,
): CandidatePathOption[] {
  const options: CandidatePathOption[] = [];
  if (isVoicedCandidate(classification.candidate, classification.rms, config)) {
    options.push({ candidate: classification.candidate, observationCost: 0 });
  }
  const alternative = classification.alternativeCandidate;
  if (
    options.length > 0 &&
    alternative &&
    isVoicedCandidate(alternative, classification.rms, config) &&
    semitonesApart(alternative.frequencyHz, options[0].candidate.frequencyHz) > 0.2
  ) {
    options.push({
      candidate: alternative,
      observationCost: ALTERNATIVE_CANDIDATE_COST,
    });
  }
  return options;
}

function transitionCost(previous: PitchFrameCandidate, next: PitchFrameCandidate): number {
  return TRANSITION_COST_PER_SEMITONE * Math.max(0, semitonesApart(previous.frequencyHz, next.frequencyHz) - FREE_TRANSITION_SEMITONES);
}

function selectContinuousCandidates(
  classifications: ClassifiedPitchFrame[],
  config: VocalPitchAnalysisConfig,
): VocalPitchFrame[] {
  const result = classifications.map((classification) => classification.frame);
  let index = 0;
  while (index < classifications.length) {
    const segmentOptions: CandidatePathOption[][] = [];
    while (index < classifications.length && getCandidatePathOptions(classifications[index], config).length === 0) {
      index += 1;
    }
    const segmentStart = index;
    while (index < classifications.length) {
      const options = getCandidatePathOptions(classifications[index], config);
      if (options.length === 0) {
        break;
      }
      segmentOptions.push(options);
      index += 1;
    }
    if (segmentOptions.length === 0) {
      continue;
    }

    let costs = segmentOptions[0].map((option) => option.observationCost);
    const backPointers: number[][] = [];
    for (let segmentIndex = 1; segmentIndex < segmentOptions.length; segmentIndex += 1) {
      const previousOptions = segmentOptions[segmentIndex - 1];
      const nextCosts: number[] = [];
      const nextBackPointers: number[] = [];
      for (const option of segmentOptions[segmentIndex]) {
        const candidateCosts = previousOptions.map(
          (previous, previousIndex) => costs[previousIndex] + transitionCost(previous.candidate, option.candidate),
        );
        const bestPreviousIndex = candidateCosts.reduce(
          (best, cost, candidateIndex) => (cost < candidateCosts[best] ? candidateIndex : best),
          0,
        );
        nextCosts.push(candidateCosts[bestPreviousIndex] + option.observationCost);
        nextBackPointers.push(bestPreviousIndex);
      }
      costs = nextCosts;
      backPointers.push(nextBackPointers);
    }

    const selectedStates = new Array<number>(segmentOptions.length);
    selectedStates[selectedStates.length - 1] = costs.reduce(
      (best, cost, candidateIndex) => (cost < costs[best] ? candidateIndex : best),
      0,
    );
    for (let segmentIndex = selectedStates.length - 1; segmentIndex > 0; segmentIndex -= 1) {
      selectedStates[segmentIndex - 1] = backPointers[segmentIndex - 1][selectedStates[segmentIndex]];
    }
    for (let segmentIndex = 0; segmentIndex < segmentOptions.length; segmentIndex += 1) {
      const candidate = segmentOptions[segmentIndex][selectedStates[segmentIndex]].candidate;
      const frameIndex = segmentStart + segmentIndex;
      result[frameIndex] = {
        ...result[frameIndex],
        confidence: Math.min(1, Math.max(0, candidate.clarity)),
        frequencyHz: candidate.frequencyHz,
      };
    }
  }
  return result;
}

function suppressShortOctaveExcursions(frames: VocalPitchFrame[]): VocalPitchFrame[] {
  const result = [...frames];
  let index = 1;
  while (index < result.length - 1) {
    const previous = result[index - 1].frequencyHz;
    const current = result[index].frequencyHz;
    if (previous == null || current == null) {
      index += 1;
      continue;
    }
    const jump = 12 * Math.log2(current / previous);
    if (Math.abs(jump) < 8.5 || Math.abs(jump) > 15.5) {
      index += 1;
      continue;
    }
    const octaveScale = jump > 0 ? 0.5 : 2;
    let excursionEnd: number | null = null;
    const lastCandidate = Math.min(result.length - 1, index + MAX_SHORT_OCTAVE_EXCURSION_FRAMES);
    for (let candidateIndex = index + 1; candidateIndex <= lastCandidate; candidateIndex += 1) {
      const candidate = result[candidateIndex].frequencyHz;
      if (candidate == null) {
        break;
      }
      if (semitonesApart(candidate, previous) <= 2) {
        excursionEnd = candidateIndex;
        break;
      }
      if (semitonesApart(candidate * octaveScale, previous) > 3) {
        break;
      }
    }
    if (excursionEnd === null) {
      index += 1;
      continue;
    }
    for (let excursionIndex = index; excursionIndex < excursionEnd; excursionIndex += 1) {
      result[excursionIndex] = {
        ...result[excursionIndex],
        frequencyHz: (result[excursionIndex].frequencyHz ?? 0) * octaveScale,
      };
    }
    index = excursionEnd;
  }
  return result;
}

function nearestOctave(
  frequencyHz: number,
  expectedFrequencyHz: number,
): number | null {
  const options = [frequencyHz / 2, frequencyHz, frequencyHz * 2].filter(
    (candidate) => candidate >= VOCAL_PITCH_MIN_FREQUENCY_HZ && candidate <= VOCAL_PITCH_MAX_FREQUENCY_HZ,
  );
  if (options.length === 0) {
    return null;
  }
  return options.reduce((best, candidate) =>
    semitonesApart(candidate, expectedFrequencyHz) < semitonesApart(best, expectedFrequencyHz) ? candidate : best,
  );
}

function bridgeReliableShortGaps(
  classifications: ClassifiedPitchFrame[],
  frames: VocalPitchFrame[],
  config: VocalPitchAnalysisConfig,
): VocalPitchFrame[] {
  const result = [...frames];
  const relaxedThreshold = Math.max(0.55, config.voicingThreshold - 0.12);
  let index = 0;
  while (index < result.length) {
    if (result[index].frequencyHz !== null) {
      index += 1;
      continue;
    }
    const start = index;
    while (index < result.length && result[index].frequencyHz === null) {
      index += 1;
    }
    const end = index;
    const gapSize = end - start;
    if (start === 0 || end === result.length || gapSize > MAX_RELIABLE_GAP_FRAMES) {
      continue;
    }
    const left = result[start - 1].frequencyHz;
    const right = result[end].frequencyHz;
    if (left == null || right == null || semitonesApart(left, right) > 2.5) {
      continue;
    }

    const replacements: number[] = [];
    for (let gapIndex = start; gapIndex < end; gapIndex += 1) {
      const progress = (gapIndex - start + 1) / (gapSize + 1);
      const expectedFrequencyHz = 2 ** ((1 - progress) * Math.log2(left) + progress * Math.log2(right));
      const classification = classifications[gapIndex];
      if (classification.rms < MIN_VOICED_RMS) {
        replacements.length = 0;
        break;
      }
      const replacement = [classification.candidate, classification.alternativeCandidate]
        .filter(
          (candidate): candidate is PitchFrameCandidate =>
            candidate !== undefined && candidate.clarity >= relaxedThreshold && candidate.frequencyHz > 0,
        )
        .map((candidate) => nearestOctave(candidate.frequencyHz, expectedFrequencyHz))
        .filter((candidate): candidate is number => candidate !== null)
        .reduce<number | null>(
          (best, candidate) =>
            best === null || semitonesApart(candidate, expectedFrequencyHz) < semitonesApart(best, expectedFrequencyHz)
              ? candidate
              : best,
          null,
        );
      if (replacement === null || semitonesApart(replacement, expectedFrequencyHz) > 1.5) {
        replacements.length = 0;
        break;
      }
      replacements.push(replacement);
    }
    if (replacements.length === gapSize) {
      for (let gapIndex = start; gapIndex < end; gapIndex += 1) {
        result[gapIndex] = { ...result[gapIndex], frequencyHz: replacements[gapIndex - start] };
      }
    }
  }
  return result;
}

export function postProcessPitchFrames(
  classifications: ClassifiedPitchFrame[],
  config: VocalPitchAnalysisConfig,
): VocalPitchFrame[] {
  return bridgeReliableShortGaps(
    classifications,
    suppressShortOctaveExcursions(selectContinuousCandidates(classifications, config)),
    config,
  );
}

export function analyzePitchSamples(
  samples: Float32Array,
  sampleRate: number,
  config: VocalPitchAnalysisConfig,
  onProgress: (progress: number) => void = () => undefined,
): VocalPitchAnalysis {
  const normalizedConfig = normalizeVocalPitchConfig(config);
  const frameSize = getPitchFrameSize(sampleRate);
  const hopSize = Math.max(1, Math.round(sampleRate / 100));
  const detector = createPitchFrameDetector(frameSize);
  const frame = new Float32Array(frameSize);
  const classifications: ClassifiedPitchFrame[] = [];
  const frameCount = Math.max(1, Math.ceil(Math.max(0, samples.length - frameSize) / hopSize) + 1);

  for (let frameIndex = 0; frameIndex < frameCount; frameIndex += 1) {
    const offset = frameIndex * hopSize;
    frame.fill(0);
    frame.set(samples.subarray(offset, Math.min(samples.length, offset + frameSize)));
    classifications.push(classifyPitchFrame(detector, frame, sampleRate, normalizedConfig, (offset + frameSize / 2) / sampleRate));
    if (frameIndex % 500 === 0) {
      onProgress(frameIndex / frameCount);
    }
  }

  return {
    schemaVersion: 1,
    analyzedAt: new Date().toISOString(),
    detectorId: VOCAL_PITCH_DETECTOR_ID,
    detectorVersion: VOCAL_PITCH_DETECTOR_VERSION,
    config: normalizedConfig,
    frames: postProcessPitchFrames(classifications, normalizedConfig),
    hopSeconds: hopSize / sampleRate,
    sampleRate,
  };
}
