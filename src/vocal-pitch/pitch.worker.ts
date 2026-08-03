/// <reference lib="webworker" />

import type { VocalPitchAnalysisConfig } from "../domain/vocalPitch";
import { analyzePitchSamples } from "./pitchDetection";

interface AnalyzeRequest {
  config: VocalPitchAnalysisConfig;
  id: number;
  sampleRate: number;
  samples: ArrayBuffer;
  type: "analyze";
}

self.onmessage = (event: MessageEvent<AnalyzeRequest>) => {
  try {
    const analysis = analyzePitchSamples(
      new Float32Array(event.data.samples),
      event.data.sampleRate,
      event.data.config,
      (progress) => self.postMessage({ type: "progress", id: event.data.id, progress }),
    );
    self.postMessage({ type: "complete", id: event.data.id, analysis });
  } catch (error) {
    self.postMessage({
      type: "error",
      id: event.data.id,
      error: error instanceof Error ? error.message : String(error),
    });
  }
};
