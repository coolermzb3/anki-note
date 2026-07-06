import { DatabaseBackup, Download, FolderOpen, Upload } from "lucide-react";
import { useState } from "react";
import {
  chooseBackupDirectory,
  restoreBackupFromDirectory,
  supportsFileBackups,
  writeBrowserDataToBackupDirectory,
  type BackupDirectorySelectionResult,
} from "../data/backup";
import { db, getBackupState } from "../data/db";
import { backupText, formatBackupConflictDetail } from "../domain/backupText";
import type { AppSettings, BackupState } from "../domain/types";

type StoredBackupState = BackupState & { restoreRequiredBeforeBackup?: boolean };

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
  hasBrowserPracticeData: boolean;
  onSettingsSaved: (settings: AppSettings) => void;
  onDataChanged: () => Promise<void>;
}

export function SettingsView({
  settings,
  backupState,
  hasBrowserPracticeData,
  onSettingsSaved,
  onDataChanged,
}: SettingsViewProps): JSX.Element {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const storedBackupState = backupState as StoredBackupState;
  const backupBlockedUntilSync = Boolean(
    backupState.dataConflictBeforeBackup ?? backupState.syncRequiredBeforeBackup ?? storedBackupState.restoreRequiredBeforeBackup,
  );
  const hasBackupSnapshot = Boolean(backupBlockedUntilSync || backupState.lastSeenBackupVersion);

  async function saveSettings(next: AppSettings): Promise<void> {
    await db.settings.put(next);
    onSettingsSaved(next);
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
            disabled={!supportsFileBackups() || busy}
            onClick={() =>
              void runBusy(async () => {
                const result = await chooseBackupDirectory();
                return describeDirectorySelection(result, await getBackupState());
              }, backupText.messages.directorySelected)
            }
          >
            <FolderOpen size={18} />
            {backupText.labels.chooseDirectory}
          </button>
          <button
            disabled={!backupState.directoryHandle || !hasBackupSnapshot || busy}
            onClick={() => {
              if (!backupState.directoryHandle) {
                return;
              }
              if (!hasBrowserPracticeData || window.confirm(backupText.messages.browserDataWillBeReplaced)) {
                void runBusy(() => restoreBackupFromDirectory(backupState.directoryHandle!), backupText.titles.importSuccess);
              }
            }}
          >
            <Download size={18} />
            {backupBlockedUntilSync ? backupText.labels.keepBackupData : backupText.labels.importBackup}
          </button>
          {backupBlockedUntilSync ? (
            <button
              disabled={!backupState.directoryHandle || busy}
              onClick={() => {
                if (!window.confirm(backupText.messages.backupDirectoryWillBeReplaced)) {
                  return;
                }
                void runBusy(writeBrowserDataToBackupDirectory, backupText.messages.browserDataWrittenToBackup);
              }}
            >
              <Upload size={18} />
              {backupText.labels.keepBrowserData}
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
