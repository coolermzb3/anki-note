import * as ort from "onnxruntime-web/webgpu";
import ortWasmUrl from "onnxruntime-web/ort-wasm-simd-threaded.asyncify.wasm?url";
import type { VocalPitchAnalysis, VocalPitchAnalysisConfig } from "../domain/vocalPitch";
import { createEnhancedPitchAnalysis, type NeuralPitchTrack } from "./enhancedPitchFusion";
import { loadEnhancedPitchModel } from "./enhancedPitchModels";
import { analyzePitchSamples } from "./pitchDetection";

const MODEL_SAMPLE_RATE = 16_000;
const CHUNK_SECONDS = 30;
const FCPE_CONTEXT_SECONDS = 1;
const FCPE_THRESHOLD = 0.006;
const SWIFTF0_CONTEXT_SECONDS = 0.25;
const SWIFTF0_CONFIDENCE_THRESHOLD = 0.9;

ort.env.wasm.numThreads = 1;
ort.env.wasm.simd = true;
ort.env.wasm.wasmPaths = { wasm: new URL(ortWasmUrl, globalThis.location.href).href };

function resampleLinear(samples: Float32Array, sourceRate: number): Float32Array {
  if (sourceRate === MODEL_SAMPLE_RATE) return samples.slice();
  const outputLength = Math.max(1, Math.round(samples.length * MODEL_SAMPLE_RATE / sourceRate));
  const result = new Float32Array(outputLength);
  const sourceStep = sourceRate / MODEL_SAMPLE_RATE;
  for (let index = 0; index < outputLength; index += 1) {
    const position = index * sourceStep;
    const left = Math.min(samples.length - 1, Math.floor(position));
    const right = Math.min(samples.length - 1, left + 1);
    const fraction = position - left;
    result[index] = samples[left] + (samples[right] - samples[left]) * fraction;
  }
  return result;
}

function attenuateCodecOvershoot(samples: Float32Array): Float32Array {
  let peak = 0;
  for (const sample of samples) peak = Math.max(peak, Math.abs(sample));
  if (peak <= 0.99) return samples;
  const gain = 0.99 / peak;
  for (let index = 0; index < samples.length; index += 1) samples[index] *= gain;
  return samples;
}

async function createSession(model: ArrayBuffer): Promise<ort.InferenceSession> {
  try {
    return await ort.InferenceSession.create(model, { executionProviders: ["webgpu", "wasm"] });
  } catch {
    return ort.InferenceSession.create(model, { executionProviders: ["wasm"] });
  }
}

function chunkBounds(coreStart: number, durationSeconds: number, contextSeconds: number) {
  const coreEnd = Math.min(durationSeconds, coreStart + CHUNK_SECONDS);
  const inputStart = Math.max(0, coreStart - contextSeconds);
  const inputEnd = Math.min(durationSeconds, coreEnd + contextSeconds);
  return {
    coreEnd,
    inputEndSample: Math.min(Math.round(inputEnd * MODEL_SAMPLE_RATE), Math.round(durationSeconds * MODEL_SAMPLE_RATE)),
    inputStart,
    inputStartSample: Math.max(0, Math.round(inputStart * MODEL_SAMPLE_RATE)),
  };
}

function decodeFcpeLatent(latent: Float32Array): { confidence: Float32Array; frequenciesHz: Float32Array } {
  const bins = 360;
  const frameCount = latent.length / bins;
  const minCent = 1200 * Math.log2(32.7 / 10);
  const maxCent = 1200 * Math.log2(1975.5 / 10);
  const step = (maxCent - minCent) / (bins - 1);
  const confidence = new Float32Array(frameCount);
  const frequenciesHz = new Float32Array(frameCount);
  for (let frame = 0; frame < frameCount; frame += 1) {
    const offset = frame * bins;
    let maxIndex = 0;
    for (let bin = 1; bin < bins; bin += 1) {
      if (latent[offset + bin] > latent[offset + maxIndex]) maxIndex = bin;
    }
    const peak = latent[offset + maxIndex];
    confidence[frame] = peak;
    if (peak <= FCPE_THRESHOLD) continue;
    let weightedCent = 0;
    let weight = 0;
    for (let relative = -4; relative <= 4; relative += 1) {
      const bin = Math.max(0, Math.min(bins - 1, maxIndex + relative));
      weightedCent += (minCent + bin * step) * latent[offset + bin];
      weight += latent[offset + bin];
    }
    frequenciesHz[frame] = 10 * 2 ** (weightedCent / weight / 1200);
  }
  return { confidence, frequenciesHz };
}

async function runFcpe(
  session: ort.InferenceSession,
  samples: Float32Array,
  onProgress: (progress: number) => void,
): Promise<NeuralPitchTrack> {
  const durationSeconds = samples.length / MODEL_SAMPLE_RATE;
  const times: number[] = [];
  const frequencies: number[] = [];
  const confidence: number[] = [];
  const chunkCount = Math.max(1, Math.ceil(durationSeconds / CHUNK_SECONDS));
  for (let chunkIndex = 0; chunkIndex < chunkCount; chunkIndex += 1) {
    const coreStart = chunkIndex * CHUNK_SECONDS;
    const bounds = chunkBounds(coreStart, durationSeconds, FCPE_CONTEXT_SECONDS);
    let chunk = samples.subarray(bounds.inputStartSample, bounds.inputEndSample);
    if (chunk.length < 1024) {
      const padded = new Float32Array(1024);
      padded.set(chunk);
      chunk = padded;
    }
    const output = await session.run({
      [session.inputNames[0]]: new ort.Tensor("float32", chunk, [1, chunk.length, 1]),
    });
    const latent = output[session.outputNames[0]].data as Float32Array;
    const decoded = decodeFcpeLatent(latent);
    for (let frame = 0; frame < decoded.frequenciesHz.length; frame += 1) {
      const timeSeconds = bounds.inputStart + frame * 0.01;
      if (timeSeconds + 1e-7 < coreStart || timeSeconds >= bounds.coreEnd - 1e-7) continue;
      times.push(timeSeconds);
      frequencies.push(decoded.frequenciesHz[frame] || Number.NaN);
      confidence.push(decoded.confidence[frame]);
    }
    onProgress((chunkIndex + 1) / chunkCount);
  }
  return {
    confidence: Float32Array.from(confidence),
    frequenciesHz: Float32Array.from(frequencies),
    timesSeconds: Float32Array.from(times),
  };
}

async function runSwiftF0(
  session: ort.InferenceSession,
  samples: Float32Array,
  onProgress: (progress: number) => void,
): Promise<NeuralPitchTrack> {
  const durationSeconds = samples.length / MODEL_SAMPLE_RATE;
  const times: number[] = [];
  const frequencies: number[] = [];
  const confidence: number[] = [];
  const chunkCount = Math.max(1, Math.ceil(durationSeconds / CHUNK_SECONDS));
  for (let chunkIndex = 0; chunkIndex < chunkCount; chunkIndex += 1) {
    const coreStart = chunkIndex * CHUNK_SECONDS;
    const bounds = chunkBounds(coreStart, durationSeconds, SWIFTF0_CONTEXT_SECONDS);
    let chunk = samples.subarray(bounds.inputStartSample, bounds.inputEndSample);
    if (chunk.length < 256) {
      const padded = new Float32Array(256);
      padded.set(chunk);
      chunk = padded;
    }
    const output = await session.run({
      [session.inputNames[0]]: new ort.Tensor("float32", chunk, [1, chunk.length]),
    });
    const pitchHz = output[session.outputNames[0]].data as Float32Array;
    const modelConfidence = output[session.outputNames[1]].data as Float32Array;
    for (let frame = 0; frame < pitchHz.length; frame += 1) {
      const timeSeconds = bounds.inputStart + (frame * 256 + 127.5) / MODEL_SAMPLE_RATE;
      if (timeSeconds + 1e-7 < coreStart || timeSeconds >= bounds.coreEnd - 1e-7) continue;
      const voiced = modelConfidence[frame] > SWIFTF0_CONFIDENCE_THRESHOLD &&
        pitchHz[frame] >= 46.875 && pitchHz[frame] <= 2093.75;
      times.push(timeSeconds);
      frequencies.push(voiced ? pitchHz[frame] : Number.NaN);
      confidence.push(modelConfidence[frame]);
    }
    onProgress((chunkIndex + 1) / chunkCount);
  }
  return {
    confidence: Float32Array.from(confidence),
    frequenciesHz: Float32Array.from(frequencies),
    timesSeconds: Float32Array.from(times),
  };
}

export async function analyzeEnhancedPitchSamples(
  samples: Float32Array,
  sampleRate: number,
  config: VocalPitchAnalysisConfig,
  onProgress: (progress: number) => void,
  preparedSamples16k?: Float32Array,
): Promise<VocalPitchAnalysis> {
  const mpmAnalysis = analyzePitchSamples(samples, sampleRate, config, (progress) => onProgress(progress * 0.35));
  const samples16k = attenuateCodecOvershoot(preparedSamples16k ?? resampleLinear(samples, sampleRate));
  onProgress(0.36);
  const [fcpeModel, swiftModel] = await Promise.all([
    loadEnhancedPitchModel("fcpe"),
    loadEnhancedPitchModel("swiftf0"),
  ]);
  const fcpeSession = await createSession(fcpeModel);
  const swiftSession = await createSession(swiftModel);
  try {
    onProgress(0.42);
    const fcpe = await runFcpe(fcpeSession, samples16k, (progress) => onProgress(0.42 + progress * 0.4));
    const swiftf0 = await runSwiftF0(swiftSession, samples16k, (progress) => onProgress(0.82 + progress * 0.18));
    return createEnhancedPitchAnalysis(mpmAnalysis, swiftf0, fcpe, samples16k.length / MODEL_SAMPLE_RATE, mpmAnalysis.config);
  } finally {
    await Promise.all([fcpeSession.release(), swiftSession.release()]);
  }
}
