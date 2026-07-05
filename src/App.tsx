import { BarChart3, BellOff, Dumbbell, FolderOpen, Settings, X } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { preloadPianoSamples } from "./audio/piano";
import { supportsFileBackups } from "./data/backup";
import { getBackupState, loadAllData, recoverAbandonedSessions } from "./data/db";
import { IndexedDbMaintenancePanel } from "./debug/IndexedDbMaintenancePanel";
import { installIndexedDbMaintenanceDebug } from "./debug/indexedDbMaintenance";
import type { AppSettings, BackupState, PracticeSessionRecord, ReviewRecord } from "./domain/types";
import { PracticeView, type PracticeNavigationExitRequest, type PracticeNavigationExitTarget } from "./components/PracticeView";
import { SettingsView } from "./components/SettingsView";
import { StatsView } from "./components/StatsView";

type View = "practice" | "stats" | "settings";
type BackupReminderKind = "choose-directory" | "restore-before-backup";

const BACKUP_REMINDER_SUPPRESSED_DATE_KEY = "anki-note.backupReminderSuppressedDate";

interface AppData {
  settings: AppSettings;
  sessions: PracticeSessionRecord[];
  reviews: ReviewRecord[];
  backupState: BackupState;
}

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

function getBackupReminderKind(backupState: BackupState): BackupReminderKind | null {
  if (!supportsFileBackups()) {
    return null;
  }
  if (backupState.restoreRequiredBeforeBackup) {
    return "restore-before-backup";
  }
  if (!backupState.directoryHandle && !isBackupReminderSuppressedToday()) {
    return "choose-directory";
  }
  return null;
}

export function App(): JSX.Element {
  const [view, setView] = useState<View>("practice");
  const [data, setData] = useState<AppData | null>(null);
  const [practiceRunning, setPracticeRunning] = useState(false);
  const [backupReminderVisible, setBackupReminderVisible] = useState(false);
  const [practiceExitRequest, setPracticeExitRequest] = useState<PracticeNavigationExitRequest | null>(null);
  const practiceExitRequestIdRef = useRef(0);

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
    setBackupReminderVisible(getBackupReminderKind(data.backupState) !== null);
  }, [data !== null, data?.backupState.directoryHandle, data?.backupState.restoreRequiredBeforeBackup]);

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

  const openBackupSettings = useCallback((): void => {
    setBackupReminderVisible(false);
    selectView("settings");
  }, [selectView]);

  const suppressBackupReminderToday = useCallback((): void => {
    try {
      localStorage.setItem(BACKUP_REMINDER_SUPPRESSED_DATE_KEY, todayKey());
    } catch {
      // The current page can still hide the reminder even when storage is blocked.
    }
    setBackupReminderVisible(false);
  }, []);

  const showBackupReminderAfterPractice = useCallback((): void => {
    if (data && getBackupReminderKind(data.backupState) !== null) {
      setBackupReminderVisible(true);
    }
  }, [data]);

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

  const backupReminderKind = backupReminderVisible ? getBackupReminderKind(data.backupState) : null;
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
        {backupReminderKind && !practiceRunning ? (
          <div className="backup-reminder" role="status">
            <div>
              <strong>{backupReminderKind === "restore-before-backup" ? "建议先恢复备份" : "建议设置备份目录"}</strong>
              <span>
                {backupReminderKind === "restore-before-backup"
                  ? "检测到该目录已有备份，恢复前不会向这个目录写入新备份。"
                  : "练习记录只保存在当前浏览器，设置目录后可以恢复和迁移数据。"}
              </span>
            </div>
            <div className="backup-reminder-actions">
              <button className="primary" onClick={openBackupSettings}>
                <FolderOpen size={18} />
                {backupReminderKind === "restore-before-backup" ? "去恢复" : "去设置"}
              </button>
              {backupReminderKind === "choose-directory" ? (
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
