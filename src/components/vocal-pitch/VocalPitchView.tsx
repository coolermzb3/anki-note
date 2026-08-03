import {
  Eraser,
  FolderUp,
  Mic,
  PanelRightOpen,
  Pause,
  Play,
  RotateCcw,
  Save,
  Square,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { createUuid } from "../../domain/id";
import {
  DEFAULT_VOCAL_PITCH_CONFIG,
  describeFrequency,
  detectorConfigChanged,
  formatDuration,
  getLatestVoicedPitchFrame,
  getPitchFrameAtTime,
  normalizeVocalPitchConfig,
  type VocalAudioMaterial,
  type VocalPitchAnalysisConfig,
  type VocalPitchFrame,
} from "../../domain/vocalPitch";
import type { PracticeNavigationExitRequest, PracticeNavigationExitTarget } from "../PracticeView";
import { isInteractiveShortcutTarget } from "../keyboardShortcuts";
import { useLocalStorageState } from "../useLocalStorageState";
import { PitchPreview } from "./PitchPreview";
import { VocalPitchSidebar } from "./VocalPitchSidebar";
import { useAudioPlayback } from "./useAudioPlayback";
import { useVocalSidebarResize } from "./useVocalSidebarResize";
import { VocalPitchDialog, type VocalDialogState } from "./VocalPitchDialog";
import {
  decodeAudioBlob,
  mergeLivePitchFrame,
  type DecodedAudio,
} from "../../vocal-pitch/pitchAnalysis";
import { digestBlob } from "../../data/blobDigest";
import {
  useVocalRecorder,
  type VocalRecordingEndReason,
  type VocalRecordingResult,
} from "../../vocal-pitch/useVocalRecorder";
import { getVocalRecordingSpaceAction } from "../../vocal-pitch/recordingPolicy";
import { listMicrophoneChoices, type MicrophoneChoice } from "../../vocal-pitch/microphones";
import { usePitchAnalysis } from "../../vocal-pitch/usePitchAnalysis";
import { useVocalAudioLibrary } from "../../vocal-pitch/useVocalAudioLibrary";

interface VocalPitchViewProps {
  backupDirectory?: FileSystemDirectoryHandle;
  navigationExitRequest?: PracticeNavigationExitRequest | null;
  onBackupStateChanged: () => void | Promise<void>;
  onNavigationExit: (target: PracticeNavigationExitTarget) => void;
}

const MAX_AUDIO_SECONDS = 10 * 60;

function recordingName(now = new Date()): string {
  const pad = (value: number) => String(value).padStart(2, "0");
  return `录音 ${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} ${pad(now.getHours())}:${pad(now.getMinutes())}`;
}

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === "AbortError";
}

function fileDownloadName(material: VocalAudioMaterial): string {
  const extension = material.originalFileName?.match(/\.([a-z0-9]{1,8})$/i)?.[1]
    ?? (material.mimeType.includes("wav") ? "wav" : material.mimeType.includes("mpeg") ? "mp3" : "webm");
  return material.name.toLowerCase().endsWith(`.${extension.toLowerCase()}`) ? material.name : `${material.name}.${extension}`;
}

function recordingEndMessage(reason: VocalRecordingEndReason): string | null {
  if (reason === "background") return "页面转入后台，录音已停止并保全";
  if (reason === "input-interrupted") return "麦克风输入已中断，录音已停止并保全";
  if (reason === "limit") return "已达到 10 分钟上限";
  if (reason === "unexpected") return "录音意外结束，已保全当前音频";
  return null;
}

function recordingEndedUnexpectedly(reason: VocalRecordingEndReason): boolean {
  return reason === "input-interrupted" || reason === "unexpected";
}

export function VocalPitchView({
  backupDirectory,
  navigationExitRequest,
  onBackupStateChanged,
  onNavigationExit,
}: VocalPitchViewProps): JSX.Element {
  const [material, setMaterial] = useState<VocalAudioMaterial | null>(null);
  const [displayedFrames, setDisplayedFrames] = useState<VocalPitchFrame[]>([]);
  const [config, setConfig] = useState<VocalPitchAnalysisConfig>(DEFAULT_VOCAL_PITCH_CONFIG);
  const [dirty, setDirty] = useState(false);
  const [analysisStale, setAnalysisStale] = useState(false);
  const [dialog, setDialog] = useState<VocalDialogState>(null);
  const [sidebarOpen, setSidebarOpen] = useLocalStorageState("anki-note.vocalPitch.sidebarOpen", true);
  const [selectedMicrophoneId, setSelectedMicrophoneId] = useLocalStorageState("anki-note.vocalPitch.microphoneId", "");
  const [allowBackgroundRecording, setAllowBackgroundRecording] = useLocalStorageState(
    "anki-note.vocalPitch.allowBackgroundRecording",
    false,
  );
  const [microphones, setMicrophones] = useState<MicrophoneChoice[]>([]);
  const [followResetKey, setFollowResetKey] = useState(0);
  const [inlineMessage, setInlineMessage] = useState<string | null>(null);
  const [recordingResultPending, setRecordingResultPending] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const analysisRequestGenerationRef = useRef(0);
  const lastNavigationRequestIdRef = useRef(0);
  const pendingRecordingNavigationTargetRef = useRef<PracticeNavigationExitTarget | null>(null);
  const recordingResultPendingRef = useRef(false);
  const recordingEndedRef = useRef<(result: VocalRecordingResult, reason: VocalRecordingEndReason) => void>(() => undefined);
  const playback = useAudioPlayback(material);
  const {
    beginMouseResize,
    beginTouchResize,
    finishTouchResize,
    moveTouchResize,
    resetSidebarWidth,
    workspaceRef,
  } = useVocalSidebarResize();
  const {
    cancel: cancelPitchAnalysis,
    isRunning: analysisRunning,
    message: analysisMessage,
    progress: analysisProgress,
    run: runPitchAnalysis,
    setMessage: setAnalysisMessage,
  } = usePitchAnalysis();
  const {
    backupStatus,
    materials,
    remove: removeLibraryMaterial,
    rename: renameLibraryMaterial,
    save: saveLibraryMaterial,
  } = useVocalAudioLibrary({
    backupDirectory,
    onBackupStateChanged,
    onMessage: setInlineMessage,
  });
  const cancelAnalysis = useCallback(() => {
    analysisRequestGenerationRef.current += 1;
    cancelPitchAnalysis();
  }, [cancelPitchAnalysis]);

  const refreshMicrophones = useCallback(async () => {
    setMicrophones(await listMicrophoneChoices());
  }, []);

  const recorder = useVocalRecorder({
    allowBackgroundRecording,
    config,
    onPitchFrame: (frame) => {
      setDisplayedFrames((frames) => mergeLivePitchFrame(frames, frame));
    },
    onEnded: (result, reason) => recordingEndedRef.current(result, reason),
  });

  const recordingActive = recorder.status !== "idle";
  const recordingBusy = recordingActive || recordingResultPending;

  useEffect(() => {
    void refreshMicrophones();
  }, [refreshMicrophones]);

  useEffect(() => {
    if (selectedMicrophoneId && microphones.length > 0 && !microphones.some((item) => item.deviceId === selectedMicrophoneId)) {
      setSelectedMicrophoneId("");
    }
  }, [microphones, selectedMicrophoneId, setSelectedMicrophoneId]);

  useEffect(() => {
    setFollowResetKey((value) => value + 1);
  }, [material?.id]);

  useEffect(() => {
    if (!recordingBusy) {
      return undefined;
    }
    const preventUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", preventUnload);
    return () => window.removeEventListener("beforeunload", preventUnload);
  }, [recordingBusy]);

  const analyzeDecoded = useCallback(async (target: VocalAudioMaterial, decoded: DecodedAudio) => {
    try {
      const analysis = await runPitchAnalysis(decoded, target.config);
      const updated = { ...target, durationSeconds: decoded.durationSeconds, analysis, updatedAt: new Date().toISOString() };
      setMaterial(updated);
      setDisplayedFrames(analysis.frames);
      setDirty(true);
      setAnalysisStale(false);
      setAnalysisMessage("分析完成");
    } catch (error) {
      if (!isAbortError(error)) {
        setAnalysisMessage(error instanceof Error ? `分析失败：${error.message}` : "分析失败");
      }
    }
  }, [runPitchAnalysis]);

  const analyzeMaterial = useCallback(async (target: VocalAudioMaterial) => {
    cancelAnalysis();
    const generation = analysisRequestGenerationRef.current;
    try {
      setAnalysisMessage("正在解码音频…");
      const decoded = await decodeAudioBlob(target.audioBlob);
      if (analysisRequestGenerationRef.current !== generation) return;
      await analyzeDecoded(target, decoded);
    } catch (error) {
      if (analysisRequestGenerationRef.current === generation) {
        setAnalysisMessage(error instanceof Error ? `无法分析：${error.message}` : "无法分析音频");
      }
    }
  }, [analyzeDecoded, cancelAnalysis, setAnalysisMessage]);

  const buildRecordingMaterial = useCallback(async (
    result: VocalRecordingResult,
    unexpected: boolean,
  ): Promise<VocalAudioMaterial> => {
    const now = new Date();
    const timestamp = now.toISOString();
    return {
      schemaVersion: 1,
      id: createUuid(),
      name: unexpected ? "录音意外结束" : recordingName(now),
      source: "recording",
      mimeType: result.mimeType,
      size: result.blob.size,
      durationSeconds: result.durationSeconds,
      createdAt: timestamp,
      updatedAt: timestamp,
      contentDigest: await digestBlob(result.blob),
      audioBlob: result.blob,
      config,
    };
  }, [config]);

  const buildAnalyzedRecordingMaterial = useCallback(async (
    result: VocalRecordingResult,
    unexpected: boolean,
  ): Promise<VocalAudioMaterial> => {
    const next = await buildRecordingMaterial(result, unexpected);
    try {
      setAnalysisMessage("正在解码录音…");
      const decoded = await decodeAudioBlob(next.audioBlob);
      const analysis = await runPitchAnalysis(decoded, next.config);
      setAnalysisMessage("分析完成");
      return {
        ...next,
        analysis,
        durationSeconds: decoded.durationSeconds,
        updatedAt: new Date().toISOString(),
      };
    } catch (error) {
      if (!isAbortError(error)) {
        setAnalysisMessage(error instanceof Error ? `分析失败，已保留原始音频：${error.message}` : "分析失败，已保留原始音频");
      }
      return next;
    }
  }, [buildRecordingMaterial, runPitchAnalysis]);

  const acceptRecordingResult = useCallback(async (
    result: VocalRecordingResult,
    reason: VocalRecordingEndReason,
  ) => {
    setInlineMessage(recordingEndMessage(reason));
    const next = await buildRecordingMaterial(result, recordingEndedUnexpectedly(reason));
    setMaterial(next);
    setConfig(next.config);
    setDirty(true);
    setAnalysisStale(false);
    void analyzeMaterial(next);
  }, [analyzeMaterial, buildRecordingMaterial]);

  const loadRecordingResult = useCallback((result: VocalRecordingResult, reason: VocalRecordingEndReason) => {
    recordingResultPendingRef.current = true;
    setRecordingResultPending(true);
    void acceptRecordingResult(result, reason)
      .then(() => {
        const target = pendingRecordingNavigationTargetRef.current;
        pendingRecordingNavigationTargetRef.current = null;
        if (target) {
          setDialog({ kind: "unsaved", after: () => onNavigationExit(target) });
        }
      })
      .catch((error) => {
        pendingRecordingNavigationTargetRef.current = null;
        setInlineMessage(error instanceof Error ? `无法完成录音：${error.message}` : "无法完成录音");
      })
      .finally(() => {
        recordingResultPendingRef.current = false;
        setRecordingResultPending(false);
      });
  }, [acceptRecordingResult, onNavigationExit]);

  recordingEndedRef.current = (result, reason) => {
    const target = pendingRecordingNavigationTargetRef.current;
    pendingRecordingNavigationTargetRef.current = null;
    if (target) {
      setDialog({ kind: "recording-leave", reason, result, target });
      return;
    }
    loadRecordingResult(result, reason);
  };

  const saveCurrentMaterial = useCallback(async (): Promise<VocalAudioMaterial | null> => {
    if (!material) return null;
    const next = { ...material, config, updatedAt: new Date().toISOString() };
    await saveLibraryMaterial(next);
    setMaterial(next);
    setDirty(false);
    return next;
  }, [config, material, saveLibraryMaterial]);

  const runWithReplacementGuard = useCallback((after: () => void | Promise<void>) => {
    if (dirty && material) {
      setDialog({ kind: "unsaved", after });
      return;
    }
    void after();
  }, [dirty, material]);

  const startRecording = useCallback(() => {
    runWithReplacementGuard(async () => {
      playback.pause();
      cancelAnalysis();
      setMaterial(null);
      setDisplayedFrames([]);
      setInlineMessage(null);
      setAnalysisStale(false);
      setDirty(false);
      setFollowResetKey((value) => value + 1);
      try {
        await recorder.start(selectedMicrophoneId || undefined);
        await refreshMicrophones();
      } catch (error) {
        setInlineMessage(error instanceof Error ? `无法开始录音：${error.message}` : "无法开始录音");
      }
    });
  }, [cancelAnalysis, playback, recorder, refreshMicrophones, runWithReplacementGuard, selectedMicrophoneId]);

  const finishRecording = useCallback(() => {
    void recorder.finish().catch((error) => {
      setInlineMessage(error instanceof Error ? error.message : "停止录音失败");
    });
  }, [recorder]);

  const openUploadPicker = useCallback(() => {
    runWithReplacementGuard(() => fileInputRef.current?.click());
  }, [runWithReplacementGuard]);

  const importFile = useCallback(async (file: File) => {
    cancelAnalysis();
    const generation = analysisRequestGenerationRef.current;
    try {
      setInlineMessage("正在读取音频…");
      const decoded = await decodeAudioBlob(file);
      if (analysisRequestGenerationRef.current !== generation) return;
      if (decoded.durationSeconds > MAX_AUDIO_SECONDS + 0.1) {
        throw new Error("文件超过 10 分钟，未导入");
      }
      const contentDigest = await digestBlob(file);
      if (analysisRequestGenerationRef.current !== generation) return;
      const now = new Date().toISOString();
      const next: VocalAudioMaterial = {
        schemaVersion: 1,
        id: createUuid(),
        name: file.name,
        originalFileName: file.name,
        source: "upload",
        mimeType: file.type || "application/octet-stream",
        size: file.size,
        durationSeconds: decoded.durationSeconds,
        createdAt: now,
        updatedAt: now,
        contentDigest,
        audioBlob: file,
        config,
      };
      setMaterial(next);
      setDisplayedFrames([]);
      setDirty(true);
      setAnalysisStale(false);
      setInlineMessage(null);
      await analyzeDecoded(next, decoded);
    } catch (error) {
      if (analysisRequestGenerationRef.current === generation) {
        setInlineMessage(error instanceof Error ? error.message : "无法导入音频文件");
      }
    }
  }, [analyzeDecoded, cancelAnalysis, config]);

  const openMaterial = useCallback((target: VocalAudioMaterial) => {
    runWithReplacementGuard(() => {
      cancelAnalysis();
      setMaterial(target);
      setConfig(target.config);
      setDisplayedFrames(target.analysis?.frames ?? []);
      setDirty(false);
      setAnalysisStale(false);
      setAnalysisMessage(target.analysis ? "已载入分析缓存" : null);
      if (!target.analysis) void analyzeMaterial(target);
    });
  }, [analyzeMaterial, cancelAnalysis, runWithReplacementGuard]);

  const clearWorkspace = useCallback(() => {
    runWithReplacementGuard(() => {
      cancelAnalysis();
      playback.pause();
      setMaterial(null);
      setDisplayedFrames([]);
      setDirty(false);
      setAnalysisStale(false);
      setAnalysisMessage(null);
      setInlineMessage(null);
    });
  }, [cancelAnalysis, playback, runWithReplacementGuard]);

  const togglePlayback = useCallback(async () => {
    if (!material) return;
    if (playback.currentTime >= material.durationSeconds - 0.02) {
      setFollowResetKey((value) => value + 1);
    }
    try {
      await playback.toggle();
    } catch (error) {
      setInlineMessage(error instanceof Error ? `无法播放：${error.message}` : "无法播放音频");
    }
  }, [material, playback]);

  const seek = useCallback((timeSeconds: number) => {
    if (recordingActive) return;
    playback.seek(timeSeconds);
  }, [playback, recordingActive]);

  const changeConfig = useCallback((nextValue: VocalPitchAnalysisConfig) => {
    const next = normalizeVocalPitchConfig(nextValue);
    const requiresAnalysis = detectorConfigChanged(config, next);
    setConfig(next);
    if (material) {
      setMaterial({ ...material, config: next });
      setDirty(true);
      if (requiresAnalysis) {
        if (analysisRunning) cancelAnalysis();
        setAnalysisStale(true);
        setAnalysisMessage("参数已更改，请重新分析");
      }
    }
  }, [analysisRunning, cancelAnalysis, config, material]);

  const reanalyze = useCallback(() => {
    if (analysisRunning) {
      cancelAnalysis();
      setAnalysisMessage("已取消分析，保留原结果");
      return;
    }
    if (!material) return;
    const target = { ...material, config };
    setMaterial(target);
    void analyzeMaterial(target);
  }, [analysisRunning, analyzeMaterial, cancelAnalysis, config, material]);

  const renameMaterial = useCallback(async (target: VocalAudioMaterial, name: string) => {
    const updated = await renameLibraryMaterial(target, name);
    if (material?.id === target.id) setMaterial((current) => current ? { ...current, name, updatedAt: updated.updatedAt } : current);
  }, [material?.id, renameLibraryMaterial]);

  const deleteMaterial = useCallback(async (target: VocalAudioMaterial) => {
    await removeLibraryMaterial(target.id);
    if (material?.id === target.id) {
      cancelAnalysis();
      setMaterial(null);
      setDisplayedFrames([]);
      setDirty(false);
    }
    setDialog(null);
  }, [cancelAnalysis, material?.id, removeLibraryMaterial]);

  const downloadMaterial = useCallback((target: VocalAudioMaterial) => {
    const url = URL.createObjectURL(target.audioBlob);
    const link = document.createElement("a");
    link.href = url;
    link.download = fileDownloadName(target);
    link.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 0);
  }, []);

  useEffect(() => {
    if (!navigationExitRequest || navigationExitRequest.id === lastNavigationRequestIdRef.current) return;
    lastNavigationRequestIdRef.current = navigationExitRequest.id;
    if (recordingActive) {
      pendingRecordingNavigationTargetRef.current = navigationExitRequest.targetView;
      void recorder.finish().catch((error) => {
        pendingRecordingNavigationTargetRef.current = null;
        setInlineMessage(error instanceof Error ? error.message : "停止录音失败");
      });
    } else if (recordingResultPendingRef.current) {
      pendingRecordingNavigationTargetRef.current = navigationExitRequest.targetView;
    } else if (dirty && material) {
      setDialog({ kind: "unsaved", after: () => onNavigationExit(navigationExitRequest.targetView) });
    } else {
      onNavigationExit(navigationExitRequest.targetView);
    }
  }, [dirty, material, navigationExitRequest, onNavigationExit, recorder, recordingActive]);

  useEffect(() => {
    const handleSpace = (event: KeyboardEvent) => {
      if (
        event.key !== " " || event.repeat || event.isComposing || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey ||
        dialog !== null || isInteractiveShortcutTarget(event.target)
      ) return;
      event.preventDefault();
      const action = getVocalRecordingSpaceAction(recorder.status, material !== null);
      if (action === "finish-recording") finishRecording();
      else if (action === "toggle-playback") void togglePlayback();
    };
    window.addEventListener("keydown", handleSpace);
    return () => window.removeEventListener("keydown", handleSpace);
  }, [dialog, finishRecording, material, recorder.status, togglePlayback]);

  const effectiveTime = recordingBusy ? recorder.activeSeconds : playback.currentTime;
  const currentFrame = recordingBusy
    ? getLatestVoicedPitchFrame(displayedFrames)
    : getPitchFrameAtTime(displayedFrames, effectiveTime);
  const currentPitch = describeFrequency(currentFrame?.frequencyHz ?? null, config.referencePitchHz);
  const statusLabel = recordingResultPending
    ? "正在完成录音"
    : recordingActive
      ? recorder.status === "stopping" ? "正在停止" : allowBackgroundRecording ? "录音中 · 后台录音已开启" : "录音中"
    : analysisProgress !== null ? `分析中 ${Math.round(analysisProgress * 100)}%` : material?.analysis ? "已完成" : "等待音频";
  const controlStatusMessage = inlineMessage
    ?? analysisMessage
    ?? recorder.captureNotice
    ?? (analysisStale ? "参数已更改，请重新分析" : null);
  return (
    <div ref={workspaceRef} className="vocal-workspace">
      <section className="vocal-preview-column">
        <header className="vocal-pitch-readout">
          <div className="vocal-current-pitch">
            <strong>{currentPitch?.note ?? "无音高"}</strong>
            <span>{currentPitch ? `${currentPitch.frequencyHz.toFixed(2)} Hz` : "— Hz"}</span>
            <span className={currentPitch && Math.abs(currentPitch.cents) <= 10 ? "in-tune" : undefined}>
              {currentPitch ? `${currentPitch.cents >= 0 ? "+" : ""}${currentPitch.cents.toFixed(1)} ¢` : "— ¢"}
            </span>
            <span>{currentFrame ? `${Math.round(currentFrame.confidence * 100)}%` : "—%"}</span>
          </div>
          <div className="vocal-readout-status">
            <span>{statusLabel}</span>
            <time>{formatDuration(effectiveTime)} / {formatDuration(recordingBusy ? recorder.activeSeconds : material?.durationSeconds ?? 0)}</time>
          </div>
          {!sidebarOpen ? (
            <button className="vocal-sidebar-open icon-button" title="展开边栏" onClick={() => setSidebarOpen(true)}>
              <PanelRightOpen size={19} />
            </button>
          ) : null}
        </header>

        <div className="vocal-preview-stage">
          <PitchPreview
            currentPitchHz={currentFrame?.frequencyHz ?? null}
            currentTime={effectiveTime}
            duration={recordingBusy ? Math.max(0.01, recorder.activeSeconds) : material?.durationSeconds ?? 10}
            followResetKey={followResetKey}
            frames={displayedFrames}
            followEnabled={recordingActive || playback.isPlaying}
            isRecording={recordingActive}
            onSeek={seek}
            referencePitchHz={config.referencePitchHz}
            variant={recordingBusy || !material?.analysis ? "realtime" : "offline"}
          />
          {!material && !recordingBusy ? (
            <div className="vocal-empty-overlay">
              <div className="vocal-empty-actions">
                <button className="record-button" onClick={startRecording}>
                  <Mic size={18} /> 录一段清唱
                </button>
                <button onClick={openUploadPicker}>
                  <FolderUp size={17} /> 上传音频
                </button>
              </div>
              <span>支持最长 10 分钟的单声部人声</span>
            </div>
          ) : null}
        </div>

        <footer className="vocal-controls">
          <button
            className={recordingBusy ? "recording-stop" : "record-button"}
            disabled={recorder.status === "stopping" || recordingResultPending}
            onClick={() => {
              if (recordingActive) {
                finishRecording();
              } else startRecording();
            }}
          >
            {recordingBusy ? <Square size={17} /> : <Mic size={18} />}
            {recordingResultPending ? "正在完成" : recordingActive ? "停止" : "录制"}
            {recordingActive ? <kbd>Space</kbd> : null}
          </button>
          <button
            disabled={recordingBusy || !material}
            onClick={() => void togglePlayback()}
          >
            {playback.isPlaying ? <Pause size={17} /> : <Play size={17} />}
            {playback.isPlaying ? "暂停" : "播放"}
            <kbd>Space</kbd>
          </button>
          <i className="vocal-control-divider" />
          <button disabled={recordingBusy || !material} onClick={reanalyze}>
            <RotateCcw size={17} />
            {analysisProgress !== null ? "取消分析" : "重新分析"}
          </button>
          <button disabled={recordingBusy} onClick={openUploadPicker}>
            <FolderUp size={17} /> 上传文件
          </button>
          <button disabled={recordingBusy || analysisProgress !== null || !material || !dirty} onClick={() => void saveCurrentMaterial()}>
            <Save size={17} /> 保存
          </button>
          {controlStatusMessage || analysisProgress !== null ? (
            <span className="vocal-control-status" aria-live="polite" title={controlStatusMessage ?? undefined}>
              {controlStatusMessage}
              {analysisProgress !== null ? <progress max={1} value={analysisProgress} /> : null}
            </span>
          ) : null}
          <button disabled={recordingBusy || !material} onClick={clearWorkspace}>
            <Eraser size={17} /> 清空
          </button>
          <input
            ref={fileInputRef}
            className="sr-only"
            accept="audio/*"
            type="file"
            onChange={(event) => {
              const file = event.target.files?.[0];
              event.target.value = "";
              if (file) void importFile(file);
            }}
          />
        </footer>
      </section>

      {sidebarOpen ? (
        <>
          <div
            className="vocal-sidebar-resizer"
            onDoubleClick={resetSidebarWidth}
            onMouseDown={beginMouseResize}
            onPointerCancel={finishTouchResize}
            onPointerDown={beginTouchResize}
            onPointerMove={moveTouchResize}
            onPointerUp={finishTouchResize}
          />
          <VocalPitchSidebar
            allowBackgroundRecording={allowBackgroundRecording}
            backupStatus={backupStatus}
            config={config}
            disabled={recordingBusy}
            inputLevel={recorder.inputLevel}
            materials={materials}
            microphones={microphones}
            onCollapse={() => setSidebarOpen(false)}
            onAllowBackgroundRecordingChange={setAllowBackgroundRecording}
            onConfigChange={changeConfig}
            onDelete={(target) => setDialog({ kind: "delete", material: target })}
            onDownload={downloadMaterial}
            onOpen={openMaterial}
            onRefreshMicrophones={() => void refreshMicrophones()}
            onRename={(target, name) => void renameMaterial(target, name)}
            onSelectMicrophone={setSelectedMicrophoneId}
            selectedMicrophoneId={selectedMicrophoneId}
          />
        </>
      ) : null}

      {dialog ? (
        <VocalPitchDialog
          dialog={dialog}
          onCancel={() => {
            if (dialog.kind === "recording-leave") {
              const { reason, result } = dialog;
              setDialog(null);
              loadRecordingResult(result, reason);
              return;
            }
            setDialog(null);
          }}
          onDelete={() => dialog.kind === "delete" && void deleteMaterial(dialog.material)}
          onDiscardUnsaved={() => {
            if (dialog.kind !== "unsaved") return;
            const after = dialog.after;
            setDialog(null);
            setDirty(false);
            void after();
          }}
          onSaveUnsaved={() => {
            if (dialog.kind !== "unsaved") return;
            const after = dialog.after;
            void saveCurrentMaterial().then(() => {
              setDialog(null);
              void after();
            });
          }}
          onResolveRecordingLeave={async (save) => {
            if (dialog.kind !== "recording-leave") return;
            const { reason, result, target } = dialog;
            setDialog(null);
            if (!save) {
              onNavigationExit(target);
              return;
            }
            recordingResultPendingRef.current = true;
            setRecordingResultPending(true);
            try {
              const next = await buildAnalyzedRecordingMaterial(result, recordingEndedUnexpectedly(reason));
              await saveLibraryMaterial(next);
            } catch (error) {
              recordingResultPendingRef.current = false;
              setRecordingResultPending(false);
              setInlineMessage(error instanceof Error ? `无法保存录音：${error.message}` : "无法保存录音");
              setDialog({ kind: "recording-leave", reason, result, target });
              return;
            }
            recordingResultPendingRef.current = false;
            setRecordingResultPending(false);
            onNavigationExit(target);
          }}
        />
      ) : null}
    </div>
  );
}
