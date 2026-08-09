/// <reference lib="webworker" />

import { analyzePitchSamples } from "./pitchDetection";
import type { PitchWorkerAnalyzeRequest, PitchWorkerResponse } from "./pitchWorkerProtocol";

const postResponse = (response: PitchWorkerResponse) => self.postMessage(response);

self.onmessage = async (event: MessageEvent<PitchWorkerAnalyzeRequest>) => {
  try {
    const samples = new Float32Array(event.data.samples);
    const reportProgress = (progress: number) => postResponse({ type: "progress", id: event.data.id, progress });
    const analysis = event.data.mode === "enhanced"
      ? await (await import("./enhancedPitchDetection")).analyzeEnhancedPitchSamples(
        samples,
        event.data.sampleRate,
        event.data.config,
        reportProgress,
        event.data.modelSamples ? new Float32Array(event.data.modelSamples) : undefined,
      )
      : analyzePitchSamples(samples, event.data.sampleRate, event.data.config, reportProgress);
    postResponse({ type: "complete", id: event.data.id, analysis });
  } catch (error) {
    postResponse({
      type: "error",
      id: event.data.id,
      error: error instanceof Error ? error.message : String(error),
    });
  }
};
