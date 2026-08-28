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
import { useCallback, useEffect, useRef, useState, type DragEvent as ReactDragEvent } from "react";
import { createUuid } from "../../domain/id";
import {
  DEFAULT_VOCAL_PITCH_CONFIG,
  describeFrequency,
  detectorConfigChanged,
  formatDuration,
  getLatestVoicedPitchFrame,
  getPitchFrameAtTime,
  normalizeVocalPitchConfig,
  vocalAudioFileExtension,
  type VocalAudioMaterial,
  type VocalPitchAnalysis,
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
  prepareEnhancedPitchAudio,
  type DecodedAudio,
  type PitchAnalysisMode,
} from "../../vocal-pitch/pitchAnalysis";
import { digestBlob } from "../../data/blobDigest";
import { encodeMonoWavPcm16 } from "../../vocal-pitch/wavEncode";
import {
  useVocalRecorder,
  type VocalRecordingEndReason,
  type VocalRecordingResult,
} from "../../vocal-pitch/useVocalRecorder";
import { getVocalRecordingSpaceAction } from "../../vocal-pitch/recordingPolicy";
import { consumeVocalRenameRequest, type VocalRenameRequest } from "../../vocal-pitch/renameRequest";
import { listMicrophoneChoices, type MicrophoneChoice } from "../../vocal-pitch/microphones";
import { usePitchAnalysis } from "../../vocal-pitch/usePitchAnalysis";
import { useVocalAudioLibrary } from "../../vocal-pitch/useVocalAudioLibrary";
import {
  areEnhancedPitchModelsCached,
  downloadEnhancedPitchModels,
  isEnhancedPitchReminderSuppressedToday,
  suppressEnhancedPitchReminderToday,
} from "../../vocal-pitch/enhancedPitchModels";

interface VocalPitchViewProps {
  backupDirectory?: FileSystemDirectoryHandle;
  libraryRevision?: string;
  navigationExitRequest?: PracticeNavigationExitRequest | null;
  onBackupStateChanged: () => void | Promise<void>;
  onBeforeLibraryChange: () => Promise<VocalLibraryMutationPreflightResult>;
  onNavigationExit: (target: PracticeNavigationExitTarget) => void;
}

export type VocalLibraryMutationPreflightResult = "backup-updated" | "blocked" | "proceed";

const MAX_AUDIO_SECONDS = 10 * 60;

export function hasDraggedFiles(types: readonly string[]): boolean {
  return types.includes("Files");
}

interface DroppedFileImportActions {
  importFile: (file: File) => Promise<void>;
  runLibraryMutationPreflight: () => Promise<boolean>;
  runWithReplacementGuard: (after: () => void | Promise<void>) => void;
}

export function requestDroppedFileImport(
  file: File | null,
  mutationBusy: boolean,
  actions: DroppedFileImportActions,
): void {
  if (!file || mutationBusy) return;
  actions.runWithReplacementGuard(async () => {
    if (!(await actions.runLibraryMutationPreflight())) return;
    await actions.importFile(file);
  });
}

function recordingName(now = new Date()): string {
  const pad = (value: number) => String(value).padStart(2, "0");
  return `录音 ${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} ${pad(now.getHours())}:${pad(now.getMinutes())}`;
}

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === "AbortError";
}

function fileDownloadName(material: VocalAudioMaterial): string {
  const extension = vocalAudioFileExtension(material);
  const originalExtension = material.originalFileName?.match(/\.([a-z0-9]{1,8})$/i)?.[1];
  const baseName = originalExtension && material.name.toLowerCase().endsWith(`.${originalExtension.toLowerCase()}`)
    ? material.name.slice(0, material.name.length - originalExtension.length - 1)
    : material.name;
  return `${baseName}.${extension}`;
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
  libraryRevision,
  navigationExitRequest,
  onBackupStateChanged,
  onBeforeLibraryChange,
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
  const [playbackVolume, setPlaybackVolume] = useLocalStorageState(
    "anki-note.vocalPitch.playbackVolume",
    1,
  );
  const [microphones, setMicrophones] = useState<MicrophoneChoice[]>([]);
  const [followResetKey, setFollowResetKey] = useState(0);
  const [inlineMessage, setInlineMessage] = useState<string | null>(null);
  const [backupPreflightPending, setBackupPreflightPending] = useState(false);
  const [materialLibraryOutdated, setMaterialLibraryOutdated] = useState(false);
  const [recordingResultPending, setRecordingResultPending] = useState(false);
  const [modelDownloadProgress, setModelDownloadProgress] = useState<number | null>(null);
  const [renameRequest, setRenameRequest] = useState<VocalRenameRequest | null>(null);
  const [fileDragActive, setFileDragActive] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const fileDragDepthRef = useRef(0);
  const analysisRequestGenerationRef = useRef(0);
  const lastNavigationRequestIdRef = useRef(0);
  const materialBaseUpdatedAtRef = useRef<string | null>(null);
  const materialRef = useRef<VocalAudioMaterial | null>(null);
  const modelDownloadProgressRef = useRef<number | null>(null);
  const mountedRef = useRef(false);
  const pendingRecordingNavigationTargetRef = useRef<PracticeNavigationExitTarget | null>(null);
  const preflightGenerationRef = useRef(0);
  const recordingResultPendingRef = useRef(false);
  const recordingEndedRef = useRef<(result: VocalRecordingResult, reason: VocalRecordingEndReason) => void>(() => undefined);
  const playback = useAudioPlayback(material, playbackVolume);
  materialRef.current = material;
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
    refresh: refreshLibrary,
    remove: removeLibraryMaterial,
    rename: renameLibraryMaterial,
    save: saveLibraryMaterial,
    saveLocal: saveLibraryMaterialLocal,
    syncBackup: syncLibraryBackup,
  } = useVocalAudioLibrary({
    backupDirectory,
    libraryRevision,
    onBackupStateChanged,
    onMessage: setInlineMessage,
  });
  const cancelAnalysis = useCallback(() => {
    analysisRequestGenerationRef.current += 1;
    cancelPitchAnalysis();
  }, [cancelPitchAnalysis]);
  const consumeRenameRequest = useCallback((token: number) => {
    setRenameRequest((current) => consumeVocalRenameRequest(current, token));
  }, []);

  const selectAnalysisMode = useCallback(async (
    target: VocalAudioMaterial,
    forceEnhanced = false,
  ): Promise<PitchAnalysisMode> => {
    if (forceEnhanced || await areEnhancedPitchModelsCached()) return "enhanced";
    if (!isEnhancedPitchReminderSuppressedToday() && modelDownloadProgressRef.current === null) {
      setDialog((current) => current ?? { kind: "enhanced-analysis", targetId: target.id });
    }
    return "mpm-c";
  }, []);

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
  const mutationBusy = recordingBusy || backupPreflightPending;

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      preflightGenerationRef.current += 1;
    };
  }, []);

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

  const analyzeDecoded = useCallback(async (
    target: VocalAudioMaterial,
    decoded: DecodedAudio,
    mode: PitchAnalysisMode,
  ) => {
    try {
      const prepared = mode === "enhanced" ? await prepareEnhancedPitchAudio(decoded) : decoded;
      const fallbackSamples = mode === "enhanced" ? prepared.samples.slice() : null;
      let analysis: VocalPitchAnalysis;
      try {
        analysis = await runPitchAnalysis(prepared, target.config, mode);
      } catch (error) {
        if (mode !== "enhanced" || isAbortError(error) || fallbackSamples === null) throw error;
        setAnalysisMessage("增强分析失败，正在回退 MPM-C…");
        analysis = await runPitchAnalysis({ ...decoded, samples: fallbackSamples }, target.config, "mpm-c");
        setInlineMessage("增强分析暂不可用，已使用 MPM-C 完成分析");
      }
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

  const analyzeMaterial = useCallback(async (target: VocalAudioMaterial, forceEnhanced = false) => {
    cancelAnalysis();
    const generation = analysisRequestGenerationRef.current;
    try {
      const mode = await selectAnalysisMode(target, forceEnhanced);
      if (analysisRequestGenerationRef.current !== generation) return;
      setAnalysisMessage("正在解码音频…");
      const decoded = await decodeAudioBlob(target.audioBlob);
      if (analysisRequestGenerationRef.current !== generation) return;
      await analyzeDecoded(target, decoded, mode);
    } catch (error) {
      if (analysisRequestGenerationRef.current === generation) {
        setAnalysisMessage(error instanceof Error ? `无法分析：${error.message}` : "无法分析音频");
      }
    }
  }, [analyzeDecoded, cancelAnalysis, selectAnalysisMode, setAnalysisMessage]);

  const downloadEnhancedAnalysis = useCallback(async (targetId: string) => {
    setDialog(null);
    modelDownloadProgressRef.current = 0;
    setModelDownloadProgress(0);
    try {
      await downloadEnhancedPitchModels((progress) => {
        modelDownloadProgressRef.current = progress;
        setModelDownloadProgress(progress);
      });
      setInlineMessage("增强音高分析模型已缓存，后续将自动使用");
      const current = materialRef.current;
      if (current?.id === targetId) void analyzeMaterial(current, true);
    } catch (error) {
      setInlineMessage(error instanceof Error ? `无法下载增强模型：${error.message}` : "无法下载增强模型");
    } finally {
      modelDownloadProgressRef.current = null;
      setModelDownloadProgress(null);
    }
  }, [analyzeMaterial]);

  const reconcileLibraryAfterBackupImport = useCallback(async (): Promise<void> => {
    const latestMaterials = await refreshLibrary();
    if (!mountedRef.current || !material || materialBaseUpdatedAtRef.current === null) return;
    const latestMaterial = latestMaterials.find((item) => item.id === material.id);
    if (latestMaterial?.updatedAt === materialBaseUpdatedAtRef.current) return;

    if (dirty) {
      setMaterialLibraryOutdated(true);
      setInlineMessage("备份中的当前素材已更新；本次操作已取消，保存前会再次确认");
      return;
    }

    cancelAnalysis();
    playback.pause();
    setMaterialLibraryOutdated(false);
    if (!latestMaterial) {
      materialBaseUpdatedAtRef.current = null;
      setMaterial(null);
      setDisplayedFrames([]);
      setAnalysisStale(false);
      setAnalysisMessage(null);
      setInlineMessage("备份中的当前素材已删除，工作区已清空");
      return;
    }

    const normalizedMaterial = { ...latestMaterial, config: normalizeVocalPitchConfig(latestMaterial.config) };
    materialBaseUpdatedAtRef.current = latestMaterial.updatedAt;
    setMaterial(normalizedMaterial);
    setConfig(normalizedMaterial.config);
    setDisplayedFrames(latestMaterial.analysis?.frames ?? []);
    setAnalysisStale(false);
    setAnalysisMessage(latestMaterial.analysis ? "已载入备份中的分析缓存" : null);
    setInlineMessage("备份中的当前素材已更新，工作区已重新载入");
    if (!latestMaterial.analysis) void analyzeMaterial(normalizedMaterial);
  }, [analyzeMaterial, cancelAnalysis, dirty, material, playback, refreshLibrary, setAnalysisMessage]);

  const runLibraryMutationPreflight = useCallback(async (): Promise<boolean> => {
    const generation = ++preflightGenerationRef.current;
    setBackupPreflightPending(true);
    try {
      const result = await onBeforeLibraryChange();
      if (!mountedRef.current || generation !== preflightGenerationRef.current) return false;
      if (result === "backup-updated") {
        await reconcileLibraryAfterBackupImport();
        return false;
      }
      return result === "proceed";
    } catch (error) {
      if (mountedRef.current && generation === preflightGenerationRef.current) {
        setInlineMessage(error instanceof Error ? error.message : "无法检查备份状态");
      }
      return false;
    } finally {
      if (mountedRef.current && generation === preflightGenerationRef.current) {
        setBackupPreflightPending(false);
      }
    }
  }, [onBeforeLibraryChange, reconcileLibraryAfterBackupImport]);

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
      const analysis = await runPitchAnalysis(decoded, next.config, "mpm-c");
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
    materialBaseUpdatedAtRef.current = null;
    setMaterialLibraryOutdated(false);
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

  const saveCurrentMaterial = useCallback(async (promptRename = false): Promise<VocalAudioMaterial | null> => {
    if (!material) return null;
    if (!(await runLibraryMutationPreflight())) return null;
    if (
      materialLibraryOutdated &&
      !window.confirm("备份中的这条素材已经更新。继续保存会用当前未保存内容覆盖刚导入的版本，是否继续？")
    ) {
      return null;
    }
    const next = { ...material, config, updatedAt: new Date().toISOString() };
    await saveLibraryMaterialLocal(next);
    materialBaseUpdatedAtRef.current = next.updatedAt;
    setMaterialLibraryOutdated(false);
    setMaterial(next);
    setDirty(false);
    if (promptRename) {
      setSidebarOpen(true);
      setRenameRequest({ id: next.id, name: next.name, token: Date.now() });
    }
    void syncLibraryBackup().catch(() => undefined);
    return next;
  }, [config, material, materialLibraryOutdated, runLibraryMutationPreflight, saveLibraryMaterialLocal, setSidebarOpen, syncLibraryBackup]);

  const runWithReplacementGuard = useCallback((after: () => void | Promise<void>) => {
    if (dirty && material) {
      setDialog({ kind: "unsaved", after });
      return;
    }
    void after();
  }, [dirty, material]);

  const startRecording = useCallback(() => {
    runWithReplacementGuard(async () => {
      if (!(await runLibraryMutationPreflight())) return;
      playback.pause();
      cancelAnalysis();
      materialBaseUpdatedAtRef.current = null;
      setMaterialLibraryOutdated(false);
      setMaterial(null);
      setDisplayedFrames([]);
      setInlineMessage(null);
      setAnalysisStale(false);
      setDirty(false);
      setFollowResetKey((value) => value + 1);
      try {
        await recorder.start(selectedMicrophoneId || undefined);
        if (mountedRef.current) await refreshMicrophones();
      } catch (error) {
        if (mountedRef.current) {
          setInlineMessage(error instanceof Error ? `无法开始录音：${error.message}` : "无法开始录音");
        }
      }
    });
  }, [cancelAnalysis, playback, recorder, refreshMicrophones, runLibraryMutationPreflight, runWithReplacementGuard, selectedMicrophoneId]);

  const finishRecording = useCallback(() => {
    void recorder.finish().catch((error) => {
      setInlineMessage(error instanceof Error ? error.message : "停止录音失败");
    });
  }, [recorder]);

  const openUploadPicker = useCallback(() => {
    runWithReplacementGuard(async () => {
      if (await runLibraryMutationPreflight()) fileInputRef.current?.click();
    });
  }, [runLibraryMutationPreflight, runWithReplacementGuard]);

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
      const audioBlob = file.type.startsWith("video/")
        ? encodeMonoWavPcm16(decoded.samples, decoded.sampleRate)
        : file;
      const contentDigest = await digestBlob(audioBlob);
      if (analysisRequestGenerationRef.current !== generation) return;
      const now = new Date().toISOString();
      const next: VocalAudioMaterial = {
        schemaVersion: 1,
        id: createUuid(),
        name: file.name,
        originalFileName: file.name,
        source: "upload",
        mimeType: audioBlob.type || "application/octet-stream",
        size: audioBlob.size,
        durationSeconds: decoded.durationSeconds,
        createdAt: now,
        updatedAt: now,
        contentDigest,
        audioBlob,
        config,
      };
      materialBaseUpdatedAtRef.current = null;
      setMaterialLibraryOutdated(false);
      setMaterial(next);
      setDisplayedFrames([]);
      setDirty(true);
      setAnalysisStale(false);
      setInlineMessage(null);
      const mode = await selectAnalysisMode(next);
      await analyzeDecoded(next, decoded, mode);
    } catch (error) {
      if (analysisRequestGenerationRef.current === generation) {
        setInlineMessage(error instanceof Error ? error.message : "无法导入音频文件");
      }
    }
  }, [analyzeDecoded, cancelAnalysis, config, selectAnalysisMode]);

  const beginFileDrag = useCallback((event: ReactDragEvent<HTMLDivElement>) => {
    if (!hasDraggedFiles(event.dataTransfer.types)) return;
    event.preventDefault();
    fileDragDepthRef.current += 1;
    if (mutationBusy) return;
    event.dataTransfer.dropEffect = "copy";
    setFileDragActive(true);
  }, [mutationBusy]);

  const continueFileDrag = useCallback((event: ReactDragEvent<HTMLDivElement>) => {
    if (!hasDraggedFiles(event.dataTransfer.types)) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = mutationBusy ? "none" : "copy";
  }, [mutationBusy]);

  const endFileDrag = useCallback((event: ReactDragEvent<HTMLDivElement>) => {
    if (!hasDraggedFiles(event.dataTransfer.types)) return;
    fileDragDepthRef.current = Math.max(0, fileDragDepthRef.current - 1);
    if (fileDragDepthRef.current === 0) setFileDragActive(false);
  }, []);

  const dropFile = useCallback((event: ReactDragEvent<HTMLDivElement>) => {
    if (!hasDraggedFiles(event.dataTransfer.types)) return;
    event.preventDefault();
    fileDragDepthRef.current = 0;
    setFileDragActive(false);
    const file = event.dataTransfer.files.item(0);
    requestDroppedFileImport(file, mutationBusy, {
      importFile,
      runLibraryMutationPreflight,
      runWithReplacementGuard,
    });
  }, [importFile, mutationBusy, runLibraryMutationPreflight, runWithReplacementGuard]);

  const openMaterial = useCallback((target: VocalAudioMaterial) => {
    runWithReplacementGuard(() => {
      const normalizedTarget = { ...target, config: normalizeVocalPitchConfig(target.config) };
      cancelAnalysis();
      materialBaseUpdatedAtRef.current = target.updatedAt;
      setMaterialLibraryOutdated(false);
      setMaterial(normalizedTarget);
      setConfig(normalizedTarget.config);
      setDisplayedFrames(target.analysis?.frames ?? []);
      setDirty(false);
      setAnalysisStale(false);
      setAnalysisMessage(target.analysis ? "已载入分析缓存" : null);
      if (!target.analysis) void analyzeMaterial(normalizedTarget);
    });
  }, [analyzeMaterial, cancelAnalysis, runWithReplacementGuard]);

  const clearWorkspace = useCallback(() => {
    runWithReplacementGuard(() => {
      cancelAnalysis();
      playback.pause();
      materialBaseUpdatedAtRef.current = null;
      setMaterialLibraryOutdated(false);
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
    if (!(await runLibraryMutationPreflight())) return;
    const updated = await renameLibraryMaterial(target, name);
    if (material?.id === target.id) {
      materialBaseUpdatedAtRef.current = updated.updatedAt;
      setMaterial((current) => current ? { ...current, name, updatedAt: updated.updatedAt } : current);
    }
  }, [material?.id, renameLibraryMaterial, runLibraryMutationPreflight]);

  const deleteMaterial = useCallback(async (target: VocalAudioMaterial) => {
    if (!(await runLibraryMutationPreflight())) {
      setDialog(null);
      return;
    }
    await removeLibraryMaterial(target.id);
    if (material?.id === target.id) {
      cancelAnalysis();
      materialBaseUpdatedAtRef.current = null;
      setMaterialLibraryOutdated(false);
      setMaterial(null);
      setDisplayedFrames([]);
      setDirty(false);
    }
    setDialog(null);
  }, [cancelAnalysis, material?.id, removeLibraryMaterial, runLibraryMutationPreflight]);

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
  const statusLabel = modelDownloadProgress !== null
    ? `下载增强模型 ${Math.round(modelDownloadProgress * 100)}%`
    : recordingResultPending
    ? "正在完成录音"
    : backupPreflightPending
      ? "正在检查备份"
    : recordingActive
      ? recorder.status === "stopping" ? "正在停止" : allowBackgroundRecording ? "录音中 · 后台录音已开启" : "录音中"
    : analysisProgress !== null ? `分析中 ${Math.round(analysisProgress * 100)}%` : material?.analysis ? "已完成" : "等待音频";
  const controlStatusMessage = modelDownloadProgress !== null
    ? `正在下载增强模型 ${Math.round(modelDownloadProgress * 100)}%`
    : (backupPreflightPending ? "正在检查备份状态…" : inlineMessage)
    ?? analysisMessage
    ?? recorder.captureNotice
    ?? (playback.isPreparing ? "正在准备回放音量…" : null)
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

        <div
          className="vocal-preview-stage"
          onDragEnter={beginFileDrag}
          onDragLeave={endFileDrag}
          onDragOver={continueFileDrag}
          onDrop={dropFile}
        >
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
                <button className="record-button" disabled={backupPreflightPending} onClick={startRecording}>
                  <Mic size={18} /> 录一段清唱
                </button>
                <button disabled={backupPreflightPending} onClick={openUploadPicker}>
                  <FolderUp size={17} /> 上传音视频
                </button>
              </div>
              <span>支持最长 10 分钟的单声部人声</span>
            </div>
          ) : null}
          {fileDragActive ? (
            <div className="vocal-file-drop-overlay" role="status">
              <FolderUp size={28} />
              <strong>松开以上传音视频</strong>
            </div>
          ) : null}
        </div>

        <footer className="vocal-controls">
          <button
            className={recordingBusy ? "recording-stop" : "record-button"}
            disabled={backupPreflightPending || recorder.status === "stopping" || recordingResultPending}
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
            disabled={mutationBusy || playback.isPreparing || !material}
            onClick={() => void togglePlayback()}
          >
            {playback.isPlaying ? <Pause size={17} /> : <Play size={17} />}
            {playback.isPlaying ? "暂停" : "播放"}
            {recordingActive ? null : <kbd>Space</kbd>}
          </button>
          <i className="vocal-control-divider" />
          <button disabled={mutationBusy || !material} onClick={reanalyze}>
            <RotateCcw size={17} />
            {analysisProgress !== null ? "取消分析" : "重新分析"}
          </button>
          <button disabled={mutationBusy} onClick={openUploadPicker}>
            <FolderUp size={17} /> 上传音视频
          </button>
          <button disabled={mutationBusy || analysisProgress !== null || !material || !dirty} onClick={() => void saveCurrentMaterial(true)}>
            <Save size={17} /> 保存
          </button>
          {controlStatusMessage || analysisProgress !== null ? (
            <span className="vocal-control-status" aria-live="polite" title={controlStatusMessage ?? undefined}>
              {controlStatusMessage}
              {analysisProgress !== null ? <progress max={1} value={analysisProgress} /> : null}
            </span>
          ) : null}
          <button disabled={mutationBusy || !material} onClick={clearWorkspace}>
            <Eraser size={17} /> 清空
          </button>
          <input
            ref={fileInputRef}
            className="sr-only"
            accept="audio/*,video/*"
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
            currentMaterialId={material?.id ?? null}
            disabled={mutationBusy}
            inputLevel={recorder.inputLevel}
            materials={materials}
            microphones={microphones}
            playbackVolume={playbackVolume}
            onCollapse={() => setSidebarOpen(false)}
            onAllowBackgroundRecordingChange={setAllowBackgroundRecording}
            onConfigChange={changeConfig}
            onDelete={(target) => setDialog({ kind: "delete", material: target })}
            onDownload={downloadMaterial}
            onOpen={openMaterial}
            onPlaybackVolumeChange={setPlaybackVolume}
            onRefreshMicrophones={() => void refreshMicrophones()}
            onRename={(target, name) => void renameMaterial(target, name)}
            onRenameRequestConsumed={consumeRenameRequest}
            onSelectMicrophone={setSelectedMicrophoneId}
            renameRequest={renameRequest}
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
          onDownloadEnhanced={() => {
            if (dialog.kind === "enhanced-analysis") void downloadEnhancedAnalysis(dialog.targetId);
          }}
          onPostponeEnhanced={() => setDialog(null)}
          onSaveUnsaved={() => {
            if (dialog.kind !== "unsaved") return;
            const after = dialog.after;
            void saveCurrentMaterial().then((saved) => {
              if (!saved) return;
              setDialog(null);
              void after();
            });
          }}
          onSuppressEnhancedToday={() => {
            suppressEnhancedPitchReminderToday();
            setDialog(null);
          }}
          onResolveRecordingLeave={async (save) => {
            if (dialog.kind !== "recording-leave") return;
            const { reason, result, target } = dialog;
            setDialog(null);
            if (!save) {
              onNavigationExit(target);
              return;
            }
            if (!(await runLibraryMutationPreflight())) {
              setDialog({ kind: "recording-leave", reason, result, target });
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
