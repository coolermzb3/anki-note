import type { VocalPitchAnalysis, VocalPitchAnalysisConfig } from "../domain/vocalPitch";

export type PitchAnalysisMode = "enhanced" | "mpm-c";

export interface PitchWorkerAnalyzeRequest {
  config: VocalPitchAnalysisConfig;
  id: number;
  mode: PitchAnalysisMode;
  modelSamples?: ArrayBuffer;
  sampleRate: number;
  samples: ArrayBuffer;
  type: "analyze";
}

export type PitchWorkerResponse =
  | { id: number; progress: number; type: "progress" }
  | { analysis: VocalPitchAnalysis; id: number; type: "complete" }
  | { error: string; id: number; type: "error" };
