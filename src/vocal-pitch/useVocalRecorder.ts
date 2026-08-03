import { useCallback, useEffect, useRef, useState } from "react";
import type { VocalPitchAnalysisConfig, VocalPitchFrame } from "../domain/vocalPitch";
import {
  createPitchFrameDetector,
  getPitchFrameSize,
  type PitchFrameDetector,
} from "./pitchFrameDetector";
import { classifyPitchFrame } from "./pitchFrameClassifier";
import {
  shouldFinishVocalRecordingWhenHidden,
  type VocalRecorderStatus,
  type VocalRecordingEndReason,
} from "./recordingPolicy";

export type { VocalRecorderStatus, VocalRecordingEndReason } from "./recordingPolicy";

export interface VocalRecordingResult {
  blob: Blob;
  durationSeconds: number;
  mimeType: string;
}

interface UseVocalRecorderOptions {
  allowBackgroundRecording: boolean;
  config: VocalPitchAnalysisConfig;
  onEnded: (result: VocalRecordingResult, reason: VocalRecordingEndReason) => void;
  onPitchFrame: (frame: VocalPitchFrame) => void;
}

const MAX_RECORDING_SECONDS = 10 * 60;

function preferredRecordingMimeType(): string | undefined {
  if (typeof MediaRecorder === "undefined") {
    return undefined;
  }
  return ["audio/webm;codecs=opus", "audio/webm"].find((mimeType) => MediaRecorder.isTypeSupported(mimeType));
}

export function useVocalRecorder({ allowBackgroundRecording, config, onEnded, onPitchFrame }: UseVocalRecorderOptions) {
  const [status, setStatus] = useState<VocalRecorderStatus>("idle");
  const [activeSeconds, setActiveSeconds] = useState(0);
  const [inputLevel, setInputLevel] = useState(0);
  const [captureNotice, setCaptureNotice] = useState<string | null>(null);
  const statusRef = useRef<VocalRecorderStatus>("idle");
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const animationRef = useRef<number | null>(null);
  const limitTimeoutRef = useRef<number | null>(null);
  const liveBufferRef = useRef(new Float32Array(0));
  const pitchDetectorRef = useRef<PitchFrameDetector | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const finalDurationSecondsRef = useRef(0);
  const recordingStartedAtRef = useRef<number | null>(null);
  const finishPromiseRef = useRef<Promise<VocalRecordingResult> | null>(null);
  const finishResolveRef = useRef<((result: VocalRecordingResult) => void) | null>(null);
  const endReasonRef = useRef<VocalRecordingEndReason | null>(null);
  const callbacksRef = useRef({ allowBackgroundRecording, config, onEnded, onPitchFrame });
  callbacksRef.current = { allowBackgroundRecording, config, onEnded, onPitchFrame };

  const updateStatus = useCallback((nextStatus: VocalRecorderStatus) => {
    statusRef.current = nextStatus;
    setStatus(nextStatus);
  }, []);

  const currentActiveSeconds = useCallback((): number => {
    const recordingStartedAt = recordingStartedAtRef.current;
    return recordingStartedAt === null
      ? finalDurationSecondsRef.current
      : (performance.now() - recordingStartedAt) / 1000;
  }, []);

  const releaseDevices = useCallback(() => {
    if (animationRef.current !== null) {
      cancelAnimationFrame(animationRef.current);
      animationRef.current = null;
    }
    if (limitTimeoutRef.current !== null) {
      window.clearTimeout(limitTimeoutRef.current);
      limitTimeoutRef.current = null;
    }
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    analyserRef.current = null;
    pitchDetectorRef.current = null;
    const context = audioContextRef.current;
    audioContextRef.current = null;
    if (context) {
      void context.close().catch(() => undefined);
    }
    setInputLevel(0);
  }, []);

  const finalizeFromRecorder = useCallback(() => {
    const recorder = mediaRecorderRef.current;
    const mimeType = recorder?.mimeType || chunksRef.current[0]?.type || "audio/webm";
    const result: VocalRecordingResult = {
      blob: new Blob(chunksRef.current, { type: mimeType }),
      durationSeconds: finalDurationSecondsRef.current,
      mimeType,
    };
    mediaRecorderRef.current = null;
    releaseDevices();
    updateStatus("idle");
    setActiveSeconds(result.durationSeconds);
    finishResolveRef.current?.(result);
    finishResolveRef.current = null;
    finishPromiseRef.current = null;
    const reason = endReasonRef.current ?? "unexpected";
    endReasonRef.current = null;
    callbacksRef.current.onEnded(result, reason);
  }, [releaseDevices, updateStatus]);

  const finish = useCallback((reason: VocalRecordingEndReason = "manual"): Promise<VocalRecordingResult> => {
    if (finishPromiseRef.current) {
      return finishPromiseRef.current;
    }
    const recorder = mediaRecorderRef.current;
    if (!recorder || statusRef.current !== "recording") {
      return Promise.reject(new Error("当前没有录音"));
    }
    finalDurationSecondsRef.current = currentActiveSeconds();
    recordingStartedAtRef.current = null;
    setActiveSeconds(finalDurationSecondsRef.current);
    setInputLevel(0);
    endReasonRef.current = reason;
    updateStatus("stopping");
    const promise = new Promise<VocalRecordingResult>((resolve) => {
      finishResolveRef.current = resolve;
    });
    finishPromiseRef.current = promise;
    if (recorder.state === "inactive") {
      finalizeFromRecorder();
    } else {
      recorder.stop();
    }
    return promise;
  }, [currentActiveSeconds, finalizeFromRecorder, updateStatus]);

  const runLiveAnalysis = useCallback(() => {
    const analyser = analyserRef.current;
    const detector = pitchDetectorRef.current;
    if (analyser && detector && statusRef.current === "recording") {
      const samples = liveBufferRef.current;
      analyser.getFloatTimeDomainData(samples);
      const currentConfig = callbacksRef.current.config;
      const elapsed = currentActiveSeconds();
      const detection = classifyPitchFrame(detector, samples, analyser.context.sampleRate, currentConfig, elapsed);
      setInputLevel(Math.min(1, detection.rms * 8));
      callbacksRef.current.onPitchFrame(detection.frame);
      setActiveSeconds(elapsed);
      if (elapsed >= MAX_RECORDING_SECONDS && !endReasonRef.current) {
        void finish("limit");
      }
    }
    if (statusRef.current !== "idle") {
      animationRef.current = requestAnimationFrame(runLiveAnalysis);
    }
  }, [currentActiveSeconds, finish]);

  const start = useCallback(async (deviceId?: string): Promise<void> => {
    if (statusRef.current !== "idle") {
      return;
    }
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") {
      throw new Error("当前浏览器不支持录音");
    }
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        ...(deviceId ? { deviceId: { exact: deviceId } } : {}),
        autoGainControl: false,
        echoCancellation: false,
        noiseSuppression: false,
        channelCount: 1,
      },
    });
    const settings = stream.getAudioTracks()[0]?.getSettings();
    const enabledProcessing = [
      settings?.echoCancellation ? "回声消除" : null,
      settings?.autoGainControl ? "自动增益" : null,
      settings?.noiseSuppression ? "降噪" : null,
    ].filter(Boolean);
    setCaptureNotice(enabledProcessing.length > 0 ? `浏览器仍启用了${enabledProcessing.join("、")}` : null);
    const context = new AudioContext();
    await context.resume();
    const source = context.createMediaStreamSource(stream);
    const analyser = context.createAnalyser();
    const frameSize = getPitchFrameSize(context.sampleRate, callbacksRef.current.config.minFrequencyHz);
    analyser.fftSize = frameSize;
    analyser.smoothingTimeConstant = 0;
    source.connect(analyser);
    liveBufferRef.current = new Float32Array(frameSize);
    pitchDetectorRef.current = createPitchFrameDetector(frameSize);

    const mimeType = preferredRecordingMimeType();
    const recorder = new MediaRecorder(stream, {
      ...(mimeType ? { mimeType } : {}),
      audioBitsPerSecond: 96_000,
    });
    chunksRef.current = [];
    finalDurationSecondsRef.current = 0;
    recordingStartedAtRef.current = performance.now();
    endReasonRef.current = null;
    setActiveSeconds(0);
    streamRef.current = stream;
    audioContextRef.current = context;
    analyserRef.current = analyser;
    mediaRecorderRef.current = recorder;

    recorder.ondataavailable = (event) => {
      if (event.data.size > 0) {
        chunksRef.current.push(event.data);
      }
      if (statusRef.current === "recording" && currentActiveSeconds() >= MAX_RECORDING_SECONDS) {
        void finish("limit");
      }
    };
    recorder.onstop = finalizeFromRecorder;
    recorder.onerror = () => {
      if (statusRef.current === "recording") {
        void finish("unexpected");
      }
    };
    for (const track of stream.getAudioTracks()) {
      track.addEventListener("mute", () => {
        if (statusRef.current === "recording") void finish("input-interrupted");
      });
      track.addEventListener("ended", () => {
        if (statusRef.current === "recording") void finish("input-interrupted");
      });
    }
    recorder.start(1000);
    updateStatus("recording");
    limitTimeoutRef.current = window.setTimeout(() => {
      if (statusRef.current === "recording") void finish("limit");
    }, MAX_RECORDING_SECONDS * 1000);
    animationRef.current = requestAnimationFrame(runLiveAnalysis);
  }, [currentActiveSeconds, finalizeFromRecorder, finish, runLiveAnalysis, updateStatus]);

  useEffect(() => {
    const finishForVisibility = () => {
      if (
        document.hidden &&
        shouldFinishVocalRecordingWhenHidden(statusRef.current, callbacksRef.current.allowBackgroundRecording)
      ) {
        void finish("background");
      }
    };
    document.addEventListener("visibilitychange", finishForVisibility);
    return () => {
      document.removeEventListener("visibilitychange", finishForVisibility);
    };
  }, [finish]);

  useEffect(() => {
    return () => {
      const recorder = mediaRecorderRef.current;
      if (recorder && recorder.state !== "inactive") {
        recorder.onstop = null;
        recorder.stop();
      }
      releaseDevices();
    };
  }, [releaseDevices]);

  return {
    activeSeconds,
    captureNotice,
    finish,
    inputLevel,
    start,
    status,
  };
}
