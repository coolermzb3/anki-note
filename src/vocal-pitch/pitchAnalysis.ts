import type { VocalPitchAnalysis, VocalPitchAnalysisConfig, VocalPitchFrame } from "../domain/vocalPitch";
import type { PitchAnalysisMode, PitchWorkerAnalyzeRequest, PitchWorkerResponse } from "./pitchWorkerProtocol";

export type { PitchAnalysisMode } from "./pitchWorkerProtocol";

export interface DecodedAudio {
  durationSeconds: number;
  modelSamples?: Float32Array;
  sampleRate: number;
  samples: Float32Array;
}

export async function prepareEnhancedPitchAudio(decoded: DecodedAudio): Promise<DecodedAudio> {
  if (decoded.sampleRate === 16_000 || typeof OfflineAudioContext === "undefined") return decoded;
  const outputLength = Math.max(1, Math.round(decoded.samples.length * 16_000 / decoded.sampleRate));
  const context = new OfflineAudioContext(1, outputLength, 16_000);
  const buffer = context.createBuffer(1, decoded.samples.length, decoded.sampleRate);
  buffer.getChannelData(0).set(decoded.samples);
  const source = context.createBufferSource();
  source.buffer = buffer;
  source.connect(context.destination);
  source.start();
  const rendered = await context.startRendering();
  return { ...decoded, modelSamples: rendered.getChannelData(0).slice() };
}

export interface PitchAnalysisTask {
  cancel: () => void;
  result: Promise<VocalPitchAnalysis>;
}

let nextAnalysisId = 1;

export async function decodeAudioBlob(blob: Blob): Promise<DecodedAudio> {
  const context = new AudioContext();
  try {
    const decoded = await context.decodeAudioData(await blob.arrayBuffer());
    const samples = new Float32Array(decoded.length);
    for (let channel = 0; channel < decoded.numberOfChannels; channel += 1) {
      const source = decoded.getChannelData(channel);
      for (let index = 0; index < samples.length; index += 1) {
        samples[index] += source[index] / decoded.numberOfChannels;
      }
    }
    return { durationSeconds: decoded.duration, sampleRate: decoded.sampleRate, samples };
  } finally {
    await context.close().catch(() => undefined);
  }
}

export function startPitchAnalysis(
  samples: Float32Array,
  sampleRate: number,
  config: VocalPitchAnalysisConfig,
  onProgress: (progress: number) => void,
  mode: PitchAnalysisMode = "mpm-c",
  modelSamples?: Float32Array,
): PitchAnalysisTask {
  const worker = new Worker(new URL("./pitch.worker.ts", import.meta.url), { type: "module" });
  const id = nextAnalysisId;
  nextAnalysisId += 1;
  let settled = false;
  let rejectTask: ((reason: Error) => void) | null = null;

  const result = new Promise<VocalPitchAnalysis>((resolve, reject) => {
    rejectTask = reject;
    worker.onmessage = (event: MessageEvent<PitchWorkerResponse>) => {
      if (event.data.id !== id) {
        return;
      }
      if (event.data.type === "progress") {
        onProgress(event.data.progress);
        return;
      }
      settled = true;
      worker.terminate();
      if (event.data.type === "complete") {
        resolve(event.data.analysis);
      } else {
        reject(new Error(event.data.error));
      }
    };
    worker.onerror = (event) => {
      settled = true;
      worker.terminate();
      reject(new Error(event.message || "分析线程发生错误"));
    };
    const sampleBuffer = samples.buffer instanceof ArrayBuffer ? samples.buffer : samples.slice().buffer;
    const modelSampleBuffer = modelSamples
      ? modelSamples.buffer instanceof ArrayBuffer ? modelSamples.buffer : modelSamples.slice().buffer
      : undefined;
    const request: PitchWorkerAnalyzeRequest = {
      type: "analyze",
      id,
      samples: sampleBuffer,
      sampleRate,
      config,
      mode,
      modelSamples: modelSampleBuffer,
    };
    worker.postMessage(request, modelSampleBuffer ? [sampleBuffer, modelSampleBuffer] : [sampleBuffer]);
  });

  return {
    result,
    cancel: () => {
      if (settled) {
        return;
      }
      settled = true;
      worker.terminate();
      rejectTask?.(new DOMException("分析已取消", "AbortError"));
    },
  };
}

export function mergeLivePitchFrame(
  frames: readonly VocalPitchFrame[],
  frame: VocalPitchFrame,
): VocalPitchFrame[] {
  const previous = frames.at(-1);
  if (previous && frame.timeSeconds <= previous.timeSeconds) {
    return [...frames.slice(0, -1), frame];
  }
  return [...frames, frame];
}
