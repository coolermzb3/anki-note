import { BarChart3, BellOff, BookOpen, Download, Dumbbell, FolderOpen, Settings, Upload, X } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { preloadPianoSamples, setPianoVolume } from "./audio/piano";
import {
  type BackupPreflightResult,
  chooseBackupDirectory,
  refreshBackupConflictDetails,
  restoreBackupFromDirectory,
  supportsFileBackups,
  syncBackupBeforeActivity,
  writeBrowserDataToBackupDirectory,
} from "./data/backup";
import { db, getBackupState, loadAllData, recoverAbandonedSessions } from "./data/db";
import { IndexedDbMaintenancePanel } from "./debug/IndexedDbMaintenancePanel";
import { installIndexedDbMaintenanceDebug } from "./debug/indexedDbMaintenance";
import { backupText, formatBackupConflictDetail, getBackupConflictDataSummaries } from "./domain/backupText";
import type { AppSettings, BackupState, PracticeSessionRecord, ReviewRecord, StaffRecallRunRecord } from "./domain/types";
import { BackupConflictActionContent } from "./components/BackupConflictActionContent";
import {
  PracticeView,
  type PracticeNavigationExitRequest,
  type PracticeNavigationExitTarget,
  type PracticeStartPreflightResult,
} from "./components/PracticeView";
import { SettingsView } from "./components/SettingsView";
import { StatsView } from "./components/StatsView";
import { StudyView, type StaffRecallStartPreflightResult } from "./components/StudyView";
import { useBlurButtonAfterPointerClick } from "./components/useBlurButtonAfterPointerClick";

type View = PracticeNavigationExitTarget;

const BACKUP_REMINDER_SUPPRESSED_DATE_KEY = "anki-note.backupReminderSuppressedDate";
const RELOAD_VIEW_SESSION_KEY = "anki-note.reloadView";

interface AppData {
  settings: AppSettings;
  sessions: PracticeSessionRecord[];
  reviews: ReviewRecord[];
  staffRecallRuns: StaffRecallRunRecord[];
  backupState: BackupState;
}

interface BackupCheckResult {
  latestData?: AppData;
  proceed: boolean;
  result: BackupPreflightResult;
}

type StoredBackupState = BackupState & { restoreRequiredBeforeBackup?: boolean };
type BackupReminderState =
  | { kind: "none"; showReminder: false }
  | { kind: "needs-directory"; showReminder: boolean }
  | { kind: "data-conflict"; showReminder: true };
type BackupReminderAction = "choose-directory" | "keep-backup-data" | "write-browser-data";

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

function readInitialView(): View {
  const [navigation] = window.performance.getEntriesByType("navigation") as PerformanceNavigationTiming[];
  // 只在刷新时恢复上次页面；直接打开应用仍默认进入练习页。
  if (navigation?.type !== "reload") {
    return "practice";
  }

  try {
    const storedView = window.sessionStorage.getItem(RELOAD_VIEW_SESSION_KEY);
    return storedView === "stats" || storedView === "study" || storedView === "settings" ? storedView : "practice";
  } catch {
    return "practice";
  }
}

function rememberReloadView(view: View): void {
  try {
    window.sessionStorage.setItem(RELOAD_VIEW_SESSION_KEY, view);
  } catch {
    return;
  }
}

function backupSyncRequired(backupState: BackupState): boolean {
  const stored = backupState as StoredBackupState;
  return Boolean(backupState.dataConflictBeforeBackup ?? backupState.syncRequiredBeforeBackup ?? stored.restoreRequiredBeforeBackup);
}

function backupConflictDetailsMissing(backupState: BackupState): boolean {
  return (
    backupState.conflictBrowserReviewCount === undefined ||
    backupState.conflictBackupReviewCount === undefined ||
    backupState.conflictBrowserStaffRecallRunCount === undefined ||
    backupState.conflictBackupStaffRecallRunCount === undefined
  );
}

function isUserAbort(error: unknown): boolean {
  return error instanceof DOMException && error.name === "AbortError";
}

function getBackupReminderState(data: AppData): BackupReminderState {
  if (!supportsFileBackups()) {
    return { kind: "none", showReminder: false };
  }
  if (backupSyncRequired(data.backupState)) {
    return { kind: "data-conflict", showReminder: true };
  }
  if (!data.backupState.directoryHandle) {
    return { kind: "needs-directory", showReminder: !isBackupReminderSuppressedToday() };
  }
  return { kind: "none", showReminder: false };
}

async function loadFreshAppData(): Promise<AppData> {
  const [{ settings, sessions, reviews, staffRecallRuns }, backupState] = await Promise.all([loadAllData(), getBackupState()]);
  return { settings, sessions, reviews, staffRecallRuns, backupState };
}

export function App(): JSX.Element {
  useBlurButtonAfterPointerClick();

  const [view, setView] = useState<View>(readInitialView);
  const [data, setData] = useState<AppData | null>(null);
  const [practiceRunning, setPracticeRunning] = useState(false);
  const [backupReminderBusy, setBackupReminderBusy] = useState(false);
  const [backupReminderMessage, setBackupReminderMessage] = useState<{ detail: string; title: string } | null>(null);
  const [backupToastMessage, setBackupToastMessage] = useState<{ detail: string; title: string } | null>(null);
  const [backupReminderVisible, setBackupReminderVisible] = useState(false);
  const [practiceExitRequest, setPracticeExitRequest] = useState<PracticeNavigationExitRequest | null>(null);
  const practiceExitRequestIdRef = useRef(0);
  const backupToastMessageTimerRef = useRef<number | null>(null);
  const backupCheckInFlightRef = useRef<Promise<BackupCheckResult> | null>(null);

  const refresh = useCallback(async (): Promise<void> => {
    setData(await loadFreshAppData());
  }, []);

  const saveSettings = useCallback(async (settings: AppSettings): Promise<void> => {
    setData((current) => (current ? { ...current, settings } : current));
    await db.settings.put(settings);
  }, []);

  const refreshBackupState = useCallback(async (): Promise<void> => {
    const backupState = await getBackupState();
    setData((current) => (current ? { ...current, backupState } : current));
  }, []);
  const hasBackupDirectory = Boolean(data?.backupState.directoryHandle);

  useEffect(() => {
    rememberReloadView(view);
  }, [view]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      await recoverAbandonedSessions();
      if (!cancelled) {
        await refresh();
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [refresh]);

  useEffect(() => {
    preloadPianoSamples();
  }, []);

  useEffect(() => {
    if (data) {
      setPianoVolume(data.settings.pianoVolume);
    }
  }, [data]);

  useEffect(() => {
    if (!data) {
      return;
    }
    if (!backupReminderMessage) {
      setBackupReminderVisible(getBackupReminderState(data).showReminder);
    }
  }, [
    backupReminderMessage,
    data !== null,
    hasBackupDirectory,
    data?.backupState.lastSeenBackupVersion,
    data?.backupState.dataConflictBeforeBackup,
    data?.backupState.syncRequiredBeforeBackup,
    data?.sessions.length,
    data?.reviews.length,
  ]);

  useEffect(() => {
    return () => {
      if (backupToastMessageTimerRef.current !== null) {
        window.clearTimeout(backupToastMessageTimerRef.current);
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
    if (autoHide) {
      if (backupToastMessageTimerRef.current !== null) {
        window.clearTimeout(backupToastMessageTimerRef.current);
      }
      setBackupReminderMessage(null);
      setBackupReminderVisible(false);
      setBackupToastMessage({ detail, title });
      backupToastMessageTimerRef.current = window.setTimeout(() => {
        setBackupToastMessage(null);
        backupToastMessageTimerRef.current = null;
      }, 2500);
      return;
    }
    setBackupReminderMessage({ detail, title });
    setBackupReminderVisible(true);
  }, []);

  const suppressBackupReminderToday = useCallback((): void => {
    try {
      localStorage.setItem(BACKUP_REMINDER_SUPPRESSED_DATE_KEY, todayKey());
    } catch {
      // The current page can still hide the reminder even when storage is blocked.
    }
    setBackupReminderVisible(false);
  }, []);

  const showBackupReminderAfterActivity = useCallback((): void => {
    if (data && getBackupReminderState(data).showReminder) {
      setBackupReminderVisible(true);
    }
  }, [data]);

  useEffect(() => {
    if (
      !data ||
      !hasBackupDirectory ||
      !backupSyncRequired(data.backupState) ||
      !backupConflictDetailsMissing(data.backupState)
    ) {
      return;
    }
    let cancelled = false;
    void refreshBackupConflictDetails()
      .then((updated) => {
        if (updated && !cancelled) {
          void refreshBackupState();
        }
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [
    data !== null,
    hasBackupDirectory,
    data?.backupState.dataConflictBeforeBackup,
    data?.backupState.syncRequiredBeforeBackup,
    data?.backupState.conflictBrowserReviewCount,
    data?.backupState.conflictBackupReviewCount,
    data?.backupState.conflictBrowserRecordCount,
    data?.backupState.conflictBackupRecordCount,
    data?.backupState.conflictBrowserStaffRecallRunCount,
    data?.backupState.conflictBackupStaffRecallRunCount,
    refreshBackupState,
  ]);

  const runBackupCheck = useCallback(
    async ({ requestPermission }: { requestPermission: boolean }): Promise<BackupCheckResult> => {
      while (backupCheckInFlightRef.current) {
        const inFlightResult = await backupCheckInFlightRef.current;
        if (!requestPermission || inFlightResult.result !== "skipped") {
          return inFlightResult;
        }
      }

      const checkPromise = (async (): Promise<BackupCheckResult> => {
        try {
          const result = await syncBackupBeforeActivity({ requestPermission });
          if (result === "needs-directory") {
            setBackupReminderVisible(true);
            return { proceed: true, result };
          }
          if (result === "data-conflict") {
            await refreshBackupState();
            setBackupReminderVisible(true);
            return { proceed: false, result };
          }
          if (result === "synced-up") {
            const latestData = await loadFreshAppData();
            setData(latestData);
            showBackupReminderMessage(backupText.titles.importSuccess, backupText.messages.backupDirectoryAutoImported, true);
            return { latestData, proceed: true, result };
          }
          if (result === "synced-down") {
            await refreshBackupState();
            return { proceed: true, result };
          }
          if (result === "ready") {
            await refreshBackupState();
            return { proceed: true, result };
          }
          return { proceed: true, result };
        } catch (error) {
          if (!requestPermission || isUserAbort(error)) {
            return { proceed: true, result: "skipped" };
          }
          showBackupReminderMessage(
            error instanceof Error ? error.message : String(error),
            backupText.messages.backupPermissionOrDirectoryHint,
            false,
          );
          return { proceed: false, result: "skipped" };
        }
      })();

      backupCheckInFlightRef.current = checkPromise;
      try {
        return await checkPromise;
      } finally {
        if (backupCheckInFlightRef.current === checkPromise) {
          backupCheckInFlightRef.current = null;
        }
      }
    },
    [refreshBackupState, showBackupReminderMessage],
  );

  const preflightBeforePracticeStart = useCallback(async (): Promise<PracticeStartPreflightResult> => {
    const checkResult = await runBackupCheck({ requestPermission: true });
    if (!checkResult.proceed) {
      return { proceed: false };
    }
    if (checkResult.result !== "synced-up") {
      return { proceed: true };
    }
    const latestData = checkResult.latestData ?? (await loadFreshAppData());
    setData(latestData);
    return { proceed: true, reviews: latestData.reviews, settings: latestData.settings };
  }, [runBackupCheck]);

  const preflightBeforeStaffRecallStart = useCallback(async (): Promise<StaffRecallStartPreflightResult> => {
    const checkResult = await runBackupCheck({ requestPermission: true });
    return { proceed: checkResult.proceed };
  }, [runBackupCheck]);

  useEffect(() => {
    if (
      !data ||
      view !== "practice" ||
      practiceRunning ||
      !hasBackupDirectory
    ) {
      return;
    }
    void runBackupCheck({ requestPermission: false });
  }, [
    data !== null,
    hasBackupDirectory,
    data?.backupState.lastSeenBackupVersion,
    data?.backupState.dataConflictBeforeBackup,
    data?.backupState.syncRequiredBeforeBackup,
    practiceRunning,
    runBackupCheck,
    view,
  ]);

  const runBackupReminderAction = useCallback(async (action: BackupReminderAction): Promise<void> => {
    if (!data || backupReminderBusy) {
      return;
    }

    const reminderState = getBackupReminderState(data);
    setBackupReminderBusy(true);
    setBackupReminderMessage(null);
    try {
      if (action === "choose-directory") {
        const result = await chooseBackupDirectory();
        const latestBackupState = await getBackupState();
        await refresh();
        if (result === "diverged") {
          showBackupReminderMessage(backupText.titles.dataConflict, formatBackupConflictDetail(latestBackupState), false);
          return;
        }
        if (result === "synced-up") {
          showBackupReminderMessage(backupText.titles.importSuccess, backupText.messages.importSuccessDetail, true);
        }
        return;
      }

      if (reminderState.kind === "data-conflict" && action === "keep-backup-data") {
        if (!data.backupState.directoryHandle) {
          return;
        }
        await restoreBackupFromDirectory(data.backupState.directoryHandle);
        await refresh();
        showBackupReminderMessage(backupText.titles.importSuccess, backupText.messages.importSuccessDetail, true);
        return;
      }

      if (reminderState.kind === "data-conflict" && action === "write-browser-data") {
        if (!window.confirm(backupText.messages.backupDirectoryWillBeReplaced)) {
          return;
        }
        await writeBrowserDataToBackupDirectory();
        await refresh();
        showBackupReminderMessage(backupText.titles.backupWritten, backupText.messages.browserDataWrittenToBackup, true);
      }
    } catch (error) {
      if (isUserAbort(error)) {
        setBackupReminderMessage(null);
        setBackupReminderVisible(reminderState.showReminder);
        return;
      }
      showBackupReminderMessage(
        error instanceof Error ? error.message : String(error),
        backupText.messages.backupPermissionOrDirectoryHint,
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

  const backupReminderState = getBackupReminderState(data);
  const showBackupReminder = (backupReminderVisible && backupReminderState.showReminder) || backupReminderMessage !== null;
  const hasBrowserData = data.sessions.length > 0 || data.reviews.length > 0 || data.staffRecallRuns.length > 0;
  const backupConflictSummaries =
    backupReminderState.kind === "data-conflict" ? getBackupConflictDataSummaries(data.backupState) : null;

  return (
    <div className="app-shell">
      {backupToastMessage ? (
        <div className="backup-toast" role="status" aria-live="polite">
          <strong>{backupToastMessage.title}</strong>
          <span>{backupToastMessage.detail}</span>
        </div>
      ) : null}
      <nav className="app-nav" aria-label="主导航">
        <button className={view === "practice" ? "active" : ""} onClick={() => selectView("practice")}>
          <Dumbbell size={18} />
          练习
        </button>
        <button className={view === "stats" ? "active" : ""} onClick={() => selectView("stats")}>
          <BarChart3 size={18} />
          统计
        </button>
        <button className={view === "study" ? "active" : ""} onClick={() => selectView("study")}>
          <BookOpen size={18} />
          学习
        </button>
        <button className={view === "settings" ? "active" : ""} onClick={() => selectView("settings")}>
          <Settings size={18} />
          设置
        </button>
      </nav>

      <main className={showBackupReminder && !practiceRunning ? "has-backup-reminder" : undefined}>
        {showBackupReminder && !practiceRunning ? (
          <div className="backup-reminder" role="status">
            <div>
              <strong>
                {backupReminderMessage?.title ??
                  (backupReminderState.kind === "data-conflict"
                    ? backupText.titles.dataConflict
                    : backupText.titles.chooseDirectorySuggestion)}
              </strong>
              <span>
                {backupReminderMessage
                  ? backupReminderMessage.detail
                  : backupReminderState.kind === "data-conflict"
                    ? formatBackupConflictDetail(data.backupState)
                    : backupText.messages.browserOnlyNeedsDirectory}
              </span>
            </div>
            <div className="backup-reminder-actions">
              {backupReminderState.kind === "needs-directory" ? (
                <button className="primary" disabled={backupReminderBusy} onClick={() => void runBackupReminderAction("choose-directory")}>
                  <FolderOpen size={18} />
                  {backupText.labels.chooseDirectory}
                </button>
              ) : null}
              {backupReminderState.kind === "data-conflict" ? (
                <button
                  className={`backup-decision-button${backupConflictSummaries?.highlighted === "backup" ? " primary" : ""}`}
                  disabled={backupReminderBusy}
                  onClick={() => void runBackupReminderAction("keep-backup-data")}
                >
                  <BackupConflictActionContent
                    icon={<Upload size={18} />}
                    label={backupText.labels.keepBackupData}
                    summary={backupConflictSummaries!.backup}
                  />
                </button>
              ) : null}
              {backupReminderState.kind === "data-conflict" ? (
                <button
                  className={`backup-decision-button${backupConflictSummaries?.highlighted === "browser" ? " primary" : ""}`}
                  disabled={backupReminderBusy}
                  onClick={() => void runBackupReminderAction("write-browser-data")}
                >
                  <BackupConflictActionContent
                    icon={<Download size={18} />}
                    label={backupText.labels.keepBrowserData}
                    summary={backupConflictSummaries!.browser}
                  />
                </button>
              ) : null}
              {backupReminderState.kind === "data-conflict" ? (
                <button
                  className="backup-decision-button backup-directory-choice-button"
                  disabled={backupReminderBusy}
                  onClick={() => void runBackupReminderAction("choose-directory")}
                >
                  <span className="backup-action-heading">
                    <FolderOpen size={18} />
                    <span>{backupText.labels.chooseEmptyDirectory}</span>
                  </span>
                </button>
              ) : null}
              {backupReminderState.kind === "needs-directory" ? (
                <button onClick={suppressBackupReminderToday}>
                  <BellOff size={18} />
                  {backupText.labels.suppressToday}
                </button>
              ) : null}
              <button title={backupText.labels.close} onClick={() => setBackupReminderVisible(false)}>
                <X size={18} />
                {backupText.labels.dismiss}
              </button>
            </div>
          </div>
        ) : null}
        {view === "practice" ? (
          <PracticeView
            settings={data.settings}
            sessions={data.sessions}
            reviews={data.reviews}
            navigationExitRequest={practiceExitRequest}
            onDataChanged={refresh}
            onNavigationExit={handleNavigationExit}
            onOpenStats={() => setView("stats")}
            onBeforePracticeStart={preflightBeforePracticeStart}
            onPracticeFinished={showBackupReminderAfterActivity}
            onRunningChange={setPracticeRunning}
            onSettingsSaved={saveSettings}
          />
        ) : null}
        {view === "stats" ? (
          <StatsView
            settings={data.settings}
            reviews={data.reviews}
            sessions={data.sessions}
            onSettingsSaved={saveSettings}
          />
        ) : null}
        {view === "study" ? (
          <StudyView
            onBeforeStaffRecallStart={preflightBeforeStaffRecallStart}
            onDataChanged={refresh}
            onSettingsSaved={saveSettings}
            onStaffRecallFinished={showBackupReminderAfterActivity}
            settings={data.settings}
            staffRecallRuns={data.staffRecallRuns}
          />
        ) : null}
        {view === "settings" ? (
          <SettingsView
            backupState={data.backupState}
            hasBrowserData={hasBrowserData}
            settings={data.settings}
            onDataChanged={refresh}
            onSettingsSaved={saveSettings}
          />
        ) : null}
      </main>
    </div>
  );
}
