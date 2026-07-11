import { DatabaseBackup, Download, FolderOpen, Upload } from "lucide-react";
import { type WheelEvent, useEffect, useRef, useState } from "react";
import {
  chooseBackupDirectory,
  restoreBackupFromDirectory,
  supportsFileBackups,
  writeBrowserDataToBackupDirectory,
  type BackupDirectorySelectionResult,
} from "../data/backup";
import { getBackupState } from "../data/db";
import { backupText, formatBackupConflictDetail, getBackupConflictDataSummaries } from "../domain/backupText";
import { normalizeAnswerKeyboardScale, normalizePianoVolume } from "../domain/settings";
import type { AppSettings, BackupState } from "../domain/types";
import { BackupConflictActionContent } from "./BackupConflictActionContent";
import { PlayableKeyboardPreview } from "./PlayableKeyboardPreview";

type StoredBackupState = BackupState & { restoreRequiredBeforeBackup?: boolean };
const PIANO_VOLUME_STEP = 0.05;

function truncateStart(value: string, maxLength = 24): string {
  if (value.length <= maxLength) {
    return value;
  }
  return `...${value.slice(-(maxLength - 3))}`;
}

function isUserAbort(error: unknown): boolean {
  return error instanceof DOMException && error.name === "AbortError";
}

interface SettingsViewProps {
  settings: AppSettings;
  backupState: BackupState;
  hasBrowserData: boolean;
  onSettingsSaved: (settings: AppSettings) => void | Promise<void>;
  onDataChanged: () => Promise<void>;
}

export function SettingsView({
  settings,
  backupState,
  hasBrowserData,
  onSettingsSaved,
  onDataChanged,
}: SettingsViewProps): JSX.Element {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [pianoVolumeDraft, setPianoVolumeDraft] = useState(() => normalizePianoVolume(settings.pianoVolume));
  const [answerKeyboardScaleDraft, setAnswerKeyboardScaleDraft] = useState(() =>
    normalizeAnswerKeyboardScale(settings.answerKeyboardScale),
  );
  const pianoVolumeRef = useRef(pianoVolumeDraft);
  const answerKeyboardScaleRef = useRef(answerKeyboardScaleDraft);
  const storedBackupState = backupState as StoredBackupState;
  const backupBlockedUntilSync = Boolean(
    backupState.dataConflictBeforeBackup ?? backupState.syncRequiredBeforeBackup ?? storedBackupState.restoreRequiredBeforeBackup,
  );
  const hasBackupSnapshot = Boolean(backupBlockedUntilSync || backupState.lastSeenBackupVersion);
  const backupConflictSummaries = backupBlockedUntilSync ? getBackupConflictDataSummaries(backupState) : null;
  const pianoVolumePercent = Math.round(pianoVolumeDraft * 100);
  const answerKeyboardScalePercent = Math.round(answerKeyboardScaleDraft * 100);

  useEffect(() => {
    const nextPianoVolume = normalizePianoVolume(settings.pianoVolume);
    pianoVolumeRef.current = nextPianoVolume;
    setPianoVolumeDraft(nextPianoVolume);
  }, [settings.pianoVolume]);

  useEffect(() => {
    const nextScale = normalizeAnswerKeyboardScale(settings.answerKeyboardScale);
    answerKeyboardScaleRef.current = nextScale;
    setAnswerKeyboardScaleDraft(nextScale);
  }, [settings.answerKeyboardScale]);

  async function saveSettings(next: AppSettings): Promise<void> {
    await onSettingsSaved(next);
  }

  function savePianoVolume(nextVolume: number): void {
    const normalizedVolume = normalizePianoVolume(nextVolume);
    if (normalizedVolume === pianoVolumeRef.current) {
      return;
    }
    pianoVolumeRef.current = normalizedVolume;
    setPianoVolumeDraft(normalizedVolume);
    void saveSettings({ ...settings, pianoVolume: normalizedVolume });
  }

  function handlePianoVolumeWheel(event: WheelEvent<HTMLLabelElement>): void {
    event.preventDefault();
    savePianoVolume(pianoVolumeRef.current + (event.deltaY < 0 ? PIANO_VOLUME_STEP : -PIANO_VOLUME_STEP));
  }

  function saveAnswerKeyboardScale(nextScale: number): void {
    const normalizedScale = normalizeAnswerKeyboardScale(nextScale);
    if (normalizedScale === answerKeyboardScaleRef.current) {
      return;
    }
    answerKeyboardScaleRef.current = normalizedScale;
    setAnswerKeyboardScaleDraft(normalizedScale);
    void saveSettings({ ...settings, answerKeyboardScale: normalizedScale });
  }

  function describeDirectorySelection(result: BackupDirectorySelectionResult, selectedBackupState: BackupState): string {
    if (result === "diverged") {
      return formatBackupConflictDetail(selectedBackupState);
    }
    if (result === "synced-up") {
      return backupText.messages.importSuccessDetail;
    }
    return backupText.messages.directorySelected;
  }

  async function runBusy(action: () => Promise<string | void>, doneMessage: string): Promise<void> {
    setBusy(true);
    setMessage(null);
    try {
      const resultMessage = await action();
      setMessage(resultMessage ?? doneMessage);
      await onDataChanged();
    } catch (error) {
      if (isUserAbort(error)) {
        setMessage(null);
        return;
      }
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="settings-shell">
      <div className="stats-header">
        <div>
          <h1>设置</h1>
          <p>全局偏好和备份</p>
        </div>
        <DatabaseBackup size={24} />
      </div>

      <div className="panel settings-panel">
        <div className="setting-row">
          <div>
            <strong>离开阈值</strong>
            <span>聚焦但无输入后标记中断</span>
          </div>
          <select
            value={settings.inactivityThresholdSeconds}
            onChange={(event) =>
              void saveSettings({ ...settings, inactivityThresholdSeconds: Number(event.target.value) })
            }
          >
            <option value={15}>15 秒</option>
            <option value={30}>30 秒</option>
            <option value={45}>45 秒</option>
            <option value={60}>60 秒</option>
          </select>
        </div>

        <div className="setting-row">
          <div>
            <strong>正确后延迟</strong>
            <span>答对后自动进入下一题</span>
          </div>
          <select
            value={settings.correctDelayMs}
            onChange={(event) => void saveSettings({ ...settings, correctDelayMs: Number(event.target.value) })}
          >
            <option value={0}>0ms</option>
            <option value={300}>300ms</option>
            <option value={400}>400ms</option>
            <option value={500}>500ms</option>
            <option value={800}>800ms</option>
          </select>
        </div>

        <div className="setting-row">
          <div>
            <strong>音量</strong>
            <span>目标音、学习页和琴键预览播放音量</span>
          </div>
          <label className="volume-control" onWheel={handlePianoVolumeWheel}>
            <input
              aria-label="音量"
              max={100}
              min={0}
              step={5}
              type="range"
              value={pianoVolumePercent}
              onChange={(event) => savePianoVolume(Number(event.target.value) / 100)}
            />
            <span>{pianoVolumePercent}%</span>
          </label>
        </div>
      </div>

      <div className="panel settings-panel keyboard-settings-panel">
        <div className="setting-row keyboard-size-row">
          <div>
            <strong>琴键大小</strong>
            <span>练习页以此尺寸为基准</span>
          </div>
          <label className="volume-control">
            <input
              aria-label="琴键大小"
              max={150}
              min={70}
              step={5}
              type="range"
              value={answerKeyboardScalePercent}
              onChange={(event) => saveAnswerKeyboardScale(Number(event.target.value) / 100)}
            />
            <span>{answerKeyboardScalePercent}%</span>
          </label>
        </div>
        <p className="keyboard-settings-description">
          预览音区 C4–B4，可按住多键试听和弦；练习页仅白键可作答，空间不足时会先缩空白，再缩小琴键。
        </p>
        <PlayableKeyboardPreview scale={answerKeyboardScaleDraft} />
      </div>

      <div className="panel settings-panel">
        <div className="backup-status">
          <div>
            <strong>备份目录</strong>
            <span title={backupState.directoryName}>
              {backupState.directoryName ? truncateStart(backupState.directoryName) : backupText.status.unselected}
            </span>
          </div>
          <div>
            <strong>数据更新</strong>
            <span>{backupState.backupDataModifiedAt ? new Date(backupState.backupDataModifiedAt).toLocaleString() : "-"}</span>
          </div>
          <div>
            <strong>状态</strong>
            <span>{backupState.lastError ?? backupText.status.normal}</span>
          </div>
        </div>
        <div className="action-row">
          <button
            className={backupBlockedUntilSync ? "backup-decision-button backup-directory-choice-button" : undefined}
            disabled={!supportsFileBackups() || busy}
            onClick={() =>
              void runBusy(async () => {
                const result = await chooseBackupDirectory();
                return describeDirectorySelection(result, await getBackupState());
              }, backupText.messages.directorySelected)
            }
          >
            {backupBlockedUntilSync ? (
              <span className="backup-action-heading">
                <FolderOpen size={18} />
                <span>{backupText.labels.chooseDirectory}</span>
              </span>
            ) : (
              <>
                <FolderOpen size={18} />
                {backupText.labels.chooseDirectory}
              </>
            )}
          </button>
          <button
            className={
              backupBlockedUntilSync
                ? `backup-decision-button${backupConflictSummaries?.highlighted === "backup" ? " primary" : ""}`
                : undefined
            }
            disabled={!backupState.directoryHandle || !hasBackupSnapshot || busy}
            onClick={() => {
              if (!backupState.directoryHandle) {
                return;
              }
              if (!hasBrowserData || window.confirm(backupText.messages.browserDataWillBeReplaced)) {
                void runBusy(() => restoreBackupFromDirectory(backupState.directoryHandle!), backupText.titles.importSuccess);
              }
            }}
          >
            {backupBlockedUntilSync ? (
              <BackupConflictActionContent
                icon={<Upload size={18} />}
                label={backupText.labels.keepBackupData}
                summary={backupConflictSummaries!.backup}
              />
            ) : (
              <>
                <Upload size={18} />
                {backupText.labels.importBackup}
              </>
            )}
          </button>
          {backupBlockedUntilSync ? (
            <button
              className={`backup-decision-button${backupConflictSummaries?.highlighted === "browser" ? " primary" : ""}`}
              disabled={!backupState.directoryHandle || busy}
              onClick={() => {
                if (!window.confirm(backupText.messages.backupDirectoryWillBeReplaced)) {
                  return;
                }
                void runBusy(writeBrowserDataToBackupDirectory, backupText.messages.browserDataWrittenToBackup);
              }}
            >
              <BackupConflictActionContent
                icon={<Download size={18} />}
                label={backupText.labels.keepBrowserData}
                summary={backupConflictSummaries!.browser}
              />
            </button>
          ) : null}
        </div>
        {backupBlockedUntilSync ? (
          <div className="status-line warning">{formatBackupConflictDetail(backupState)}</div>
        ) : backupState.directoryHandle && !hasBackupSnapshot ? (
          <div className="status-line">{backupText.messages.emptyBackupDirectory}</div>
        ) : backupState.directoryHandle ? (
          <div className="status-line">{backupText.messages.backupEnabled}</div>
        ) : null}
        {message ? <div className="status-line">{message}</div> : null}
        {!supportsFileBackups() ? <div className="status-line">{backupText.status.unsupportedFileSystemAccess}</div> : null}
      </div>
    </section>
  );
}
