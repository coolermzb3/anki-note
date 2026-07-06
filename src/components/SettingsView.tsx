import { DatabaseBackup, FolderOpen, Upload } from "lucide-react";
import { useState } from "react";
import { chooseBackupDirectory, restoreBackupFromDirectory, supportsFileBackups } from "../data/backup";
import { db } from "../data/db";
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
  const backupBlockedUntilSync = Boolean(backupState.syncRequiredBeforeBackup ?? storedBackupState.restoreRequiredBeforeBackup);
  const hasBackupSnapshot = Boolean(backupBlockedUntilSync || backupState.lastSeenBackupVersion);

  async function saveSettings(next: AppSettings): Promise<void> {
    await db.settings.put(next);
    onSettingsSaved(next);
  }

  async function runBusy(action: () => Promise<void>, doneMessage: string): Promise<void> {
    setBusy(true);
    setMessage(null);
    try {
      await action();
      setMessage(doneMessage);
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
            <span title={backupState.directoryName}>{backupState.directoryName ? truncateStart(backupState.directoryName) : "未选择"}</span>
          </div>
          <div>
            <strong>最近备份</strong>
            <span>{backupState.lastBackupAt ? new Date(backupState.lastBackupAt).toLocaleString() : "-"}</span>
          </div>
          <div>
            <strong>状态</strong>
            <span>{backupState.lastError ?? "正常"}</span>
          </div>
        </div>
        <div className="action-row">
          <button
            disabled={!supportsFileBackups() || busy}
            onClick={() => void runBusy(chooseBackupDirectory, "已选择备份目录")}
          >
            <FolderOpen size={18} />
            选择目录
          </button>
          <button
            disabled={!backupState.directoryHandle || !hasBackupSnapshot || busy}
            onClick={() => {
              if (!backupState.directoryHandle) {
                return;
              }
              if (!hasBrowserPracticeData || window.confirm("导入备份会替换当前浏览器内练习数据。继续？")) {
                void runBusy(() => restoreBackupFromDirectory(backupState.directoryHandle!), "已导入备份");
              }
            }}
          >
            <Upload size={18} />
            导入备份
          </button>
        </div>
        {backupBlockedUntilSync ? (
          <div className="status-line warning">请先导入备份；导入前不会向这个目录写入新备份。</div>
        ) : backupState.directoryHandle && !hasBackupSnapshot ? (
          <div className="status-line">备份目录还没有可导入的数据，先练习一次后会自动备份。</div>
        ) : backupState.directoryHandle ? (
          <div className="status-line">自动备份已启用，练习结束后会写入备份目录。</div>
        ) : null}
        {message ? <div className="status-line">{message}</div> : null}
        {!supportsFileBackups() ? <div className="status-line">当前浏览器不支持 File System Access。</div> : null}
      </div>
    </section>
  );
}
