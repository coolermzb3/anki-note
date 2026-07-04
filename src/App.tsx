import { BarChart3, Dumbbell, Settings } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { preloadPianoSamples } from "./audio/piano";
import { getBackupState, loadAllData, recoverAbandonedSessions } from "./data/db";
import type { AppSettings, BackupState, PracticeSessionRecord, ReviewRecord } from "./domain/types";
import { PracticeView } from "./components/PracticeView";
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
    if ("serviceWorker" in navigator && import.meta.env.PROD) {
      void navigator.serviceWorker.register("/service-worker.js").catch(() => undefined);
    }
  }, []);

  if (!data) {
    return <div className="loading">加载中</div>;
  }

  return (
    <div className="app-shell">
      <nav className="app-nav" aria-label="主导航">
        <button className={view === "practice" ? "active" : ""} onClick={() => setView("practice")}>
          <Dumbbell size={18} />
          练习
        </button>
        <button className={view === "stats" ? "active" : ""} disabled={practiceRunning} onClick={() => setView("stats")}>
          <BarChart3 size={18} />
          统计
        </button>
        <button className={view === "settings" ? "active" : ""} disabled={practiceRunning} onClick={() => setView("settings")}>
          <Settings size={18} />
          设置
        </button>
      </nav>

      <main>
        {view === "practice" ? (
          <PracticeView
            settings={data.settings}
            reviews={data.reviews}
            onDataChanged={refresh}
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
