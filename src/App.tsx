import { BarChart3, Dumbbell, Settings } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { preloadPianoSamples } from "./audio/piano";
import { getBackupState, loadAllData, recoverAbandonedSessions } from "./data/db";
import { IndexedDbMaintenancePanel } from "./debug/IndexedDbMaintenancePanel";
import { installIndexedDbMaintenanceDebug } from "./debug/indexedDbMaintenance";
import type { AppSettings, BackupState, PracticeSessionRecord, ReviewRecord } from "./domain/types";
import { PracticeView, type PracticeNavigationExitRequest, type PracticeNavigationExitTarget } from "./components/PracticeView";
import { SettingsView } from "./components/SettingsView";
import { StatsView } from "./components/StatsView";

type View = "practice" | "stats" | "settings";

interface AppData {
  settings: AppSettings;
  sessions: PracticeSessionRecord[];
  reviews: ReviewRecord[];
  backupState: BackupState;
}

export function App(): JSX.Element {
  const [view, setView] = useState<View>("practice");
  const [data, setData] = useState<AppData | null>(null);
  const [practiceRunning, setPracticeRunning] = useState(false);
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

  useEffect(() => {
    if (!("serviceWorker" in navigator)) {
      return;
    }

    if (import.meta.env.PROD) {
      void navigator.serviceWorker.register("/service-worker.js").catch(() => undefined);
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
        {view === "practice" ? (
          <PracticeView
            settings={data.settings}
            reviews={data.reviews}
            navigationExitRequest={practiceExitRequest}
            onDataChanged={refresh}
            onNavigationExit={handleNavigationExit}
            onOpenStats={() => setView("stats")}
            onRunningChange={setPracticeRunning}
            onSettingsSaved={(settings) => setData((current) => (current ? { ...current, settings } : current))}
          />
        ) : null}
        {view === "stats" ? <StatsView reviews={data.reviews} sessions={data.sessions} /> : null}
        {view === "settings" ? (
          <SettingsView
            backupState={data.backupState}
            settings={data.settings}
            onDataChanged={refresh}
            onSettingsSaved={(settings) => setData((current) => (current ? { ...current, settings } : current))}
          />
        ) : null}
      </main>
    </div>
  );
}
