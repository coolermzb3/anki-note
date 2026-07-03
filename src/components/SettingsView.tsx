import { DatabaseBackup, FolderOpen, RefreshCcw, Save, Upload } from "lucide-react";
import { useState } from "react";
import { chooseBackupDirectory, restoreBackupFromDirectory, supportsFileBackups, writeBackupNow } from "../data/backup";
import { db } from "../data/db";
import type { AppSettings, BackupState } from "../domain/types";

interface SettingsViewProps {
  settings: AppSettings;
  backupState: BackupState;
  onSettingsSaved: (settings: AppSettings) => void;
  onDataChanged: () => Promise<void>;
}

export function SettingsView({
  settings,
  backupState,
  onSettingsSaved,
  onDataChanged,
}: SettingsViewProps): JSX.Element {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

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
            <span>{backupState.directoryName ?? "未选择"}</span>
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
          <button disabled={!backupState.directoryHandle || busy} onClick={() => void runBusy(writeBackupNow, "已备份")}>
            <Save size={18} />
            立即备份
          </button>
          <button
            disabled={!backupState.directoryHandle || busy}
            onClick={() => {
              if (!backupState.directoryHandle) {
                return;
              }
              if (window.confirm("恢复会替换当前本地数据。继续？")) {
                void runBusy(() => restoreBackupFromDirectory(backupState.directoryHandle!), "已恢复备份");
              }
            }}
          >
            <Upload size={18} />
            恢复
          </button>
          <button disabled={busy} onClick={() => void runBusy(onDataChanged, "已刷新")}>
            <RefreshCcw size={18} />
            刷新
          </button>
        </div>
        {message ? <div className="status-line">{message}</div> : null}
        {!supportsFileBackups() ? <div className="status-line">当前浏览器不支持 File System Access。</div> : null}
      </div>
    </section>
  );
}
