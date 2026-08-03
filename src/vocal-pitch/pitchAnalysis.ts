import type { VocalPitchAnalysis, VocalPitchAnalysisConfig, VocalPitchFrame } from "../domain/vocalPitch";

interface AnalyzeRequest {
  config: VocalPitchAnalysisConfig;
  id: number;
  sampleRate: number;
  samples: ArrayBuffer;
  type: "analyze";
}

interface AnalyzeProgress {
  id: number;
  progress: number;
  type: "progress";
}

interface AnalyzeComplete {
  analysis: VocalPitchAnalysis;
  id: number;
  type: "complete";
}

interface AnalyzeFailure {
  error: string;
  id: number;
  type: "error";
}

type WorkerResponse = AnalyzeProgress | AnalyzeComplete | AnalyzeFailure;

export interface DecodedAudio {
  durationSeconds: number;
  sampleRate: number;
  samples: Float32Array;
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
): PitchAnalysisTask {
  const worker = new Worker(new URL("./pitch.worker.ts", import.meta.url), { type: "module" });
  const id = nextAnalysisId;
  nextAnalysisId += 1;
  let settled = false;
  let rejectTask: ((reason: Error) => void) | null = null;

  const result = new Promise<VocalPitchAnalysis>((resolve, reject) => {
    rejectTask = reject;
    worker.onmessage = (event: MessageEvent<WorkerResponse>) => {
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
    const request: AnalyzeRequest = { type: "analyze", id, samples: sampleBuffer, sampleRate, config };
    worker.postMessage(request, [sampleBuffer]);
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
