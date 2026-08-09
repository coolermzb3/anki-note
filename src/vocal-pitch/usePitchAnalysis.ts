import { useCallback, useEffect, useRef, useState } from "react";
import type { VocalPitchAnalysis, VocalPitchAnalysisConfig } from "../domain/vocalPitch";
import {
  startPitchAnalysis,
  type DecodedAudio,
  type PitchAnalysisMode,
  type PitchAnalysisTask,
} from "./pitchAnalysis";

export function usePitchAnalysis() {
  const [progress, setProgress] = useState<number | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const taskRef = useRef<PitchAnalysisTask | null>(null);
  const generationRef = useRef(0);

  const cancel = useCallback(() => {
    taskRef.current?.cancel();
    taskRef.current = null;
    generationRef.current += 1;
    setProgress(null);
    setMessage(null);
  }, []);

  useEffect(() => () => cancel(), [cancel]);

  const run = useCallback(async (
    decoded: DecodedAudio,
    config: VocalPitchAnalysisConfig,
    mode: PitchAnalysisMode = "mpm-c",
  ): Promise<VocalPitchAnalysis> => {
    cancel();
    const generation = generationRef.current + 1;
    generationRef.current = generation;
    setProgress(0);
    setMessage(mode === "enhanced" ? "正在进行增强音高分析…" : "正在使用 MPM-C 分析音高…");
    const task = startPitchAnalysis(decoded.samples, decoded.sampleRate, config, setProgress, mode, decoded.modelSamples);
    taskRef.current = task;
    try {
      const analysis = await task.result;
      if (generationRef.current !== generation) {
        throw new DOMException("分析已取消", "AbortError");
      }
      return analysis;
    } finally {
      if (generationRef.current === generation) {
        taskRef.current = null;
        setProgress(null);
      }
    }
  }, [cancel]);

  return {
    cancel,
    isRunning: progress !== null,
    message,
    progress,
    run,
    setMessage,
  };
}
