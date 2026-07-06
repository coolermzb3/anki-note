import { BarChart3, BellOff, Dumbbell, FolderOpen, Settings, Upload, X } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { preloadPianoSamples } from "./audio/piano";
import { chooseBackupDirectory, restoreBackupFromDirectory, supportsFileBackups } from "./data/backup";
import { getBackupState, loadAllData, recoverAbandonedSessions } from "./data/db";
import { IndexedDbMaintenancePanel } from "./debug/IndexedDbMaintenancePanel";
import { installIndexedDbMaintenanceDebug } from "./debug/indexedDbMaintenance";
import { deriveBackupSyncState, type BackupSyncState } from "./domain/backupSync";
import type { AppSettings, BackupState, PracticeSessionRecord, ReviewRecord } from "./domain/types";
import { PracticeView, type PracticeNavigationExitRequest, type PracticeNavigationExitTarget } from "./components/PracticeView";
import { SettingsView } from "./components/SettingsView";
import { StatsView } from "./components/StatsView";

type View = "practice" | "stats" | "settings";

const BACKUP_REMINDER_SUPPRESSED_DATE_KEY = "anki-note.backupReminderSuppressedDate";

interface AppData {
  settings: AppSettings;
  sessions: PracticeSessionRecord[];
  reviews: ReviewRecord[];
  backupState: BackupState;
}

type StoredBackupState = BackupState & { restoreRequiredBeforeBackup?: boolean };

function todayKey(): string {
  const now = new Date();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${now.getFullYear()}-${month}-${day}`;
}

function isBackupReminderSuppressedToday(): boolean {
  try {
    return localStorage.getItem(BACKUP_REMINDER_SUPPRESSED_DATE_KEY) === todayKey();
  } catch {
    return false;
  }
}

function syncRequiredBeforeBackup(backupState: BackupState): boolean {
  const stored = backupState as StoredBackupState;
  return Boolean(backupState.syncRequiredBeforeBackup ?? stored.restoreRequiredBeforeBackup);
}

function isUserAbort(error: unknown): boolean {
  return error instanceof DOMException && error.name === "AbortError";
}

function getBackupSyncState(data: AppData): BackupSyncState {
  const backupState = data.backupState;
  const syncRequired = syncRequiredBeforeBackup(backupState);
  const hasKnownBackupVersion = Boolean(backupState.lastSeenBackupVersion);
  return deriveBackupSyncState({
    supportsFileBackups: supportsFileBackups(),
    hasDirectoryHandle: Boolean(backupState.directoryHandle),
    reminderSuppressedToday: isBackupReminderSuppressedToday(),
    hasBrowserPracticeData: data.sessions.length > 0 || data.reviews.length > 0,
    hasBackupManifest: syncRequired || hasKnownBackupVersion,
    backupMatchesBrowserDataSet: !syncRequired,
    hasLastSeenBackupVersion: hasKnownBackupVersion && !syncRequired,
    backupVersionMatchesLastSeen: !syncRequired,
  });
}

export function App(): JSX.Element {
  const [view, setView] = useState<View>("practice");
  const [data, setData] = useState<AppData | null>(null);
  const [practiceRunning, setPracticeRunning] = useState(false);
  const [backupReminderBusy, setBackupReminderBusy] = useState(false);
  const [backupReminderMessage, setBackupReminderMessage] = useState<{ detail: string; title: string } | null>(null);
  const [backupReminderVisible, setBackupReminderVisible] = useState(false);
  const [practiceExitRequest, setPracticeExitRequest] = useState<PracticeNavigationExitRequest | null>(null);
  const practiceExitRequestIdRef = useRef(0);
  const backupReminderMessageTimerRef = useRef<number | null>(null);

  const refresh = useCallback(async (): Promise<void> => {
    const [{ settings, sessions, reviews }, backupState] = await Promise.all([loadAllData(), getBackupState()]);
    setData({ settings, sessions, reviews, backupState });
  }, []);

  useEffect(() => {
    void recoverAbandonedSessions().then(refresh);
  }, [refresh]);

  useEffect(() => {
    preloadPianoSamples();
  }, []);

  useEffect(() => {
    if (!data) {
      return;
    }
    if (!backupReminderMessage) {
      setBackupReminderVisible(getBackupSyncState(data).showReminder);
    }
  }, [
    backupReminderMessage,
    data !== null,
    data?.backupState.directoryHandle,
    data?.backupState.lastSeenBackupVersion,
    data?.backupState.syncRequiredBeforeBackup,
    data?.sessions.length,
    data?.reviews.length,
  ]);

  useEffect(() => {
    return () => {
      if (backupReminderMessageTimerRef.current !== null) {
        window.clearTimeout(backupReminderMessageTimerRef.current);
      }
    };
  }, []);

  useEffect(() => {
    if (!import.meta.env.DEV) {
      return undefined;
    }
    return installIndexedDbMaintenanceDebug();
  }, []);

  const selectView = useCallback(
    (nextView: View): void => {
      if (practiceRunning && view === "practice" && nextView !== view) {
        if (!practiceExitRequest) {
          practiceExitRequestIdRef.current += 1;
          setPracticeExitRequest({
            id: practiceExitRequestIdRef.current,
            targetView: nextView,
          });
        }
        return;
      }
      setView(nextView);
    },
    [practiceExitRequest, practiceRunning, view],
  );

  const handleNavigationExit = useCallback((targetView: PracticeNavigationExitTarget): void => {
    setPracticeExitRequest(null);
    setView(targetView);
  }, []);

  const showBackupReminderMessage = useCallback((title: string, detail: string, autoHide: boolean): void => {
    if (backupReminderMessageTimerRef.current !== null) {
      window.clearTimeout(backupReminderMessageTimerRef.current);
    }
    setBackupReminderMessage({ detail, title });
    setBackupReminderVisible(true);
    if (autoHide) {
      backupReminderMessageTimerRef.current = window.setTimeout(() => {
        setBackupReminderMessage(null);
        setBackupReminderVisible(false);
        backupReminderMessageTimerRef.current = null;
      }, 2500);
    }
  }, []);

  const suppressBackupReminderToday = useCallback((): void => {
    try {
      localStorage.setItem(BACKUP_REMINDER_SUPPRESSED_DATE_KEY, todayKey());
    } catch {
      // The current page can still hide the reminder even when storage is blocked.
    }
    setBackupReminderVisible(false);
  }, []);

  const showBackupReminderAfterPractice = useCallback((): void => {
    if (data && getBackupSyncState(data).showReminder) {
      setBackupReminderVisible(true);
    }
  }, [data]);

  const runBackupReminderAction = useCallback(async (): Promise<void> => {
    if (!data || backupReminderBusy) {
      return;
    }

    const syncState = getBackupSyncState(data);
    setBackupReminderBusy(true);
    setBackupReminderMessage(null);
    try {
      if (syncState.kind === "needs-directory") {
        await chooseBackupDirectory();
        await refresh();
        return;
      }

      if (syncState.kind === "sync-before-backup") {
        if (!data.backupState.directoryHandle) {
          return;
        }
        if (syncState.confirmBeforeSync && !window.confirm("导入备份会替换当前浏览器内练习数据。继续？")) {
          return;
        }
        await restoreBackupFromDirectory(data.backupState.directoryHandle);
        await refresh();
        showBackupReminderMessage("已导入备份", "当前浏览器已使用备份目录中的数据。", true);
      }
    } catch (error) {
      if (isUserAbort(error)) {
        setBackupReminderMessage(null);
        setBackupReminderVisible(syncState.showReminder);
        return;
      }
      showBackupReminderMessage(
        error instanceof Error ? error.message : String(error),
        "请检查备份目录权限，或在设置页重新选择目录。",
        false,
      );
    } finally {
      setBackupReminderBusy(false);
    }
  }, [backupReminderBusy, data, refresh, showBackupReminderMessage]);

  useEffect(() => {
    if (!("serviceWorker" in navigator)) {
      return;
    }

    const appBaseUrl = new URL(import.meta.env.BASE_URL, window.location.href);

    if (import.meta.env.PROD) {
      void navigator.serviceWorker.register(new URL("service-worker.js", appBaseUrl).toString(), {
        scope: appBaseUrl.pathname,
      }).catch(() => undefined);
      return;
    }

    void navigator.serviceWorker
      .getRegistrations()
      .then((registrations) => Promise.all(registrations.map((registration) => registration.unregister())))
      .then(() => ("caches" in window ? caches.keys() : []))
      .then((keys) => Promise.all(keys.filter((key) => key.startsWith("anki-note-")).map((key) => caches.delete(key))))
      .catch(() => undefined);
  }, []);

  const showIndexedDbMaintenance = import.meta.env.DEV && new URLSearchParams(window.location.search).get("debug") === "indexeddb";
  if (showIndexedDbMaintenance) {
    return <IndexedDbMaintenancePanel />;
  }

  if (!data) {
    return <div className="loading">加载中</div>;
  }

  const backupSyncState = getBackupSyncState(data);
  const showBackupReminder = (backupReminderVisible && backupSyncState.showReminder) || backupReminderMessage !== null;
  const hasBrowserPracticeData = data.sessions.length > 0 || data.reviews.length > 0;

  return (
    <div className="app-shell">
      <nav className="app-nav" aria-label="主导航">
        <button className={view === "practice" ? "active" : ""} onClick={() => selectView("practice")}>
          <Dumbbell size={18} />
          练习
        </button>
        <button className={view === "stats" ? "active" : ""} onClick={() => selectView("stats")}>
          <BarChart3 size={18} />
          统计
        </button>
        <button className={view === "settings" ? "active" : ""} onClick={() => selectView("settings")}>
          <Settings size={18} />
          设置
        </button>
      </nav>

      <main>
        {showBackupReminder && !practiceRunning ? (
          <div className="backup-reminder" role="status">
            <div>
              <strong>
                {backupReminderMessage?.title ??
                  (backupSyncState.kind === "sync-before-backup" ? "请先导入备份" : "建议设置备份目录")}
              </strong>
              <span>
                {backupReminderMessage
                  ? backupReminderMessage.detail
                  : backupSyncState.kind === "sync-before-backup"
                    ? "继续练习产生的新数据只会暂存在当前浏览器内，导入备份时会被备份目录数据替换。"
                    : "练习记录只保存在当前浏览器，设置目录后可以导入和迁移数据。"}
              </span>
            </div>
            <div className="backup-reminder-actions">
              {backupSyncState.kind === "needs-directory" || backupSyncState.kind === "sync-before-backup" ? (
                <button className="primary" disabled={backupReminderBusy} onClick={() => void runBackupReminderAction()}>
                  {backupSyncState.kind === "sync-before-backup" ? <Upload size={18} /> : <FolderOpen size={18} />}
                  {backupSyncState.kind === "sync-before-backup" ? "导入备份" : "选择目录"}
                </button>
              ) : null}
              {backupSyncState.kind === "needs-directory" ? (
                <button onClick={suppressBackupReminderToday}>
                  <BellOff size={18} />
                  今日不再提醒
                </button>
              ) : null}
              <button title="关闭" onClick={() => setBackupReminderVisible(false)}>
                <X size={18} />
                稍后
              </button>
            </div>
          </div>
        ) : null}
        {view === "practice" ? (
          <PracticeView
            settings={data.settings}
            reviews={data.reviews}
            navigationExitRequest={practiceExitRequest}
            onDataChanged={refresh}
            onNavigationExit={handleNavigationExit}
            onOpenStats={() => setView("stats")}
            onPracticeFinished={showBackupReminderAfterPractice}
            onRunningChange={setPracticeRunning}
            onSettingsSaved={(settings) => setData((current) => (current ? { ...current, settings } : current))}
          />
        ) : null}
        {view === "stats" ? <StatsView reviews={data.reviews} sessions={data.sessions} /> : null}
        {view === "settings" ? (
          <SettingsView
            backupState={data.backupState}
            hasBrowserPracticeData={hasBrowserPracticeData}
            settings={data.settings}
            onDataChanged={refresh}
            onSettingsSaved={(settings) => setData((current) => (current ? { ...current, settings } : current))}
          />
        ) : null}
      </main>
    </div>
  );
}
