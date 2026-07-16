import { RotateCcw } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { playTargetNote } from "../audio/piano";
import { writeBackupNow } from "../data/backup";
import { saveStaffRecallRun } from "../data/db";
import { createUuid } from "../domain/id";
import { getNotesForGroups, NOTE_NAMES } from "../domain/notes";
import {
  buildNoteNameColumns,
  buildStaffRecallTargetNoteIds,
  columnDefinitionsForNoteNames,
  comparableStaffRecallRuns,
  formatStaffRecallDeltaMs,
  formatStaffRecallPerNoteDeltaMs,
  formatStaffRecallPerNoteMs,
  shuffleNoteNames,
  totalStaffRecallActiveMs,
} from "../domain/staffRecall";
import { applicableLedgerSetting } from "../domain/staffNotation";
import { buildTargetNoteSetKey } from "../domain/targetNoteSet";
import { formatMs, percentile } from "../domain/stats";
import type { AppSettings, NoteName, StaffRecallRunRecord, TargetNote, TargetNoteId } from "../domain/types";
import { HistoryLimitControl } from "./HistoryLimitControl";
import { isInteractiveShortcutTarget, shouldHandleGlobalEnter } from "./keyboardShortcuts";
import { PauseOverlay } from "./PauseOverlay";
import { StaffRecallMap, type StaffRecallColumnState } from "./StaffRecallMap";
import { StaffRecallTrendChart } from "./StaffRecallTrendChart";
import { StudyDisplayControls } from "./StudyDisplayControls";
import {
  DEFAULT_STAFF_RECALL_UI_PREFERENCES,
  parseStaffRecallUiPreferences,
  STAFF_RECALL_UI_PREFERENCES_KEY,
} from "./staffRecallPreferences";
import { useLocalStorageState } from "./useLocalStorageState";

interface StaffRecallViewProps {
  onDataChanged: () => void | Promise<void>;
  onFinished?: () => void;
  onRangeLockedChange: (locked: boolean) => void;
  runs: StaffRecallRunRecord[];
  settings: AppSettings;
}

function createColumnStates(): Record<NoteName, StaffRecallColumnState> {
  return {
    C: { correctNoteIds: [] },
    D: { correctNoteIds: [] },
    E: { correctNoteIds: [] },
    F: { correctNoteIds: [] },
    G: { correctNoteIds: [] },
    A: { correctNoteIds: [] },
    B: { correctNoteIds: [] },
  };
}

function completeColumnActiveMs(states: Record<NoteName, StaffRecallColumnState>): Record<NoteName, number> {
  return Object.fromEntries(
    NOTE_NAMES.map((noteName) => {
      const activeMs = states[noteName].activeMs;
      if (activeMs === undefined) {
        throw new Error(`Staff recall column ${noteName} is incomplete`);
      }
      return [noteName, activeMs];
    }),
  ) as Record<NoteName, number>;
}

function medianColumnActiveMs(
  runs: readonly StaffRecallRunRecord[],
): Record<NoteName, number | undefined> {
  const medianFor = (noteName: NoteName): number | undefined =>
    percentile(runs.map((run) => run.columnActiveMs[noteName]), 0.5);
  return {
    C: medianFor("C"),
    D: medianFor("D"),
    E: medianFor("E"),
    F: medianFor("F"),
    G: medianFor("G"),
    A: medianFor("A"),
    B: medianFor("B"),
  };
}

export function StaffRecallView({
  onDataChanged,
  onFinished,
  onRangeLockedChange,
  runs,
  settings,
}: StaffRecallViewProps): JSX.Element {
  const [uiPreferences, setUiPreferences] = useLocalStorageState(
    STAFF_RECALL_UI_PREFERENCES_KEY,
    DEFAULT_STAFF_RECALL_UI_PREFERENCES,
    { parse: parseStaffRecallUiPreferences },
  );
  const [columnOrder, setColumnOrder] = useState<NoteName[]>(() => shuffleNoteNames());
  const [columnStates, setColumnStates] = useState<Record<NoteName, StaffRecallColumnState>>(createColumnStates);
  const [activeNoteName, setActiveNoteName] = useState<NoteName | undefined>();
  const [completedRun, setCompletedRun] = useState<StaffRecallRunRecord | undefined>();
  const [localRuns, setLocalRuns] = useState(runs);
  const [saveError, setSaveError] = useState<string | undefined>();
  const [isPaused, setIsPaused] = useState(false);
  const [runVersion, setRunVersion] = useState(0);
  const columnStatesRef = useRef(columnStates);
  const activeNoteNameRef = useRef<NoteName | undefined>();
  const activeStartedAtRef = useRef<number | undefined>();
  const activeAccumulatedMsRef = useRef(0);
  const runStartedAtRef = useRef<string | undefined>();
  const savingRef = useRef(false);
  const isPausedRef = useRef(false);
  const mapFrameRef = useRef<HTMLDivElement | null>(null);

  const staffNotationMode = settings.staffNotationMode;
  const inputNotes = useMemo(
    () => getNotesForGroups(settings.enabledGroupIds, settings.includeInterStaffLedgerSpellings, staffNotationMode),
    [settings.enabledGroupIds, settings.includeInterStaffLedgerSpellings, staffNotationMode],
  );
  const targetNoteIds = useMemo(() => buildStaffRecallTargetNoteIds(inputNotes), [inputNotes]);
  const targetNoteSetKey = useMemo(() => buildTargetNoteSetKey(targetNoteIds), [targetNoteIds]);
  const targetNoteSetKeyRef = useRef(targetNoteSetKey);
  const columnDefinitions = useMemo(() => columnDefinitionsForNoteNames(columnOrder), [columnOrder]);
  const columns = useMemo(
    () => buildNoteNameColumns(inputNotes, columnDefinitions),
    [columnDefinitions, inputNotes],
  );
  const comparableRuns = useMemo(
    () => comparableStaffRecallRuns(localRuns, targetNoteSetKey),
    [localRuns, targetNoteSetKey],
  );
  const comparisonRuns = useMemo(
    () =>
      comparableRuns
        .filter((run) => run.id !== completedRun?.id)
        .slice(-uiPreferences.historyLimit),
    [comparableRuns, completedRun?.id, uiPreferences.historyLimit],
  );
  const comparisonColumnMedianMs = useMemo(
    () => medianColumnActiveMs(comparisonRuns),
    [comparisonRuns],
  );

  const setStates = useCallback((nextStates: Record<NoteName, StaffRecallColumnState>): void => {
    columnStatesRef.current = nextStates;
    setColumnStates(nextStates);
  }, []);

  const pauseActiveTimer = useCallback((): void => {
    if (activeStartedAtRef.current === undefined) {
      return;
    }
    activeAccumulatedMsRef.current += performance.now() - activeStartedAtRef.current;
    activeStartedAtRef.current = undefined;
  }, []);

  const resumeActiveTimer = useCallback((): void => {
    if (
      !activeNoteNameRef.current ||
      activeStartedAtRef.current !== undefined ||
      document.visibilityState === "hidden" ||
      !document.hasFocus()
    ) {
      return;
    }
    activeStartedAtRef.current = performance.now();
  }, []);

  const pauseRecall = useCallback((): void => {
    if (!activeNoteNameRef.current) {
      return;
    }
    pauseActiveTimer();
    if (!isPausedRef.current) {
      isPausedRef.current = true;
      setIsPaused(true);
    }
  }, [pauseActiveTimer]);

  const resumeRecall = useCallback((): void => {
    if (!isPausedRef.current) {
      return;
    }
    isPausedRef.current = false;
    setIsPaused(false);
    resumeActiveTimer();
  }, [resumeActiveTimer]);

  const finishActiveTimer = useCallback((): number => {
    pauseActiveTimer();
    const activeMs = Math.max(0, Math.round(activeAccumulatedMsRef.current));
    activeAccumulatedMsRef.current = 0;
    activeStartedAtRef.current = undefined;
    activeNoteNameRef.current = undefined;
    setActiveNoteName(undefined);
    return activeMs;
  }, [pauseActiveTimer]);

  const resetRun = useCallback((): void => {
    pauseActiveTimer();
    activeNoteNameRef.current = undefined;
    activeStartedAtRef.current = undefined;
    activeAccumulatedMsRef.current = 0;
    runStartedAtRef.current = undefined;
    isPausedRef.current = false;
    setActiveNoteName(undefined);
    setIsPaused(false);
    setStates(createColumnStates());
    setColumnOrder(shuffleNoteNames());
    setRunVersion((current) => current + 1);
    setCompletedRun(undefined);
    setSaveError(undefined);
    onRangeLockedChange(false);
  }, [onRangeLockedChange, pauseActiveTimer, setStates]);

  const restartRun = useCallback((): void => {
    resetRun();
    window.requestAnimationFrame(() => {
      mapFrameRef.current?.scrollIntoView({
        behavior: "auto",
        block: "start",
      });
    });
  }, [resetRun]);

  useEffect(() => {
    setLocalRuns(runs);
  }, [runs]);

  useEffect(() => {
    if (!completedRun) {
      return;
    }
    const frameId = window.requestAnimationFrame(() => {
      window.scrollTo({
        behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth",
        top: document.documentElement.scrollHeight,
      });
    });
    return () => window.cancelAnimationFrame(frameId);
  }, [completedRun]);

  useEffect(() => {
    if (targetNoteSetKeyRef.current === targetNoteSetKey) {
      return;
    }
    targetNoteSetKeyRef.current = targetNoteSetKey;
    resetRun();
  }, [resetRun, targetNoteSetKey]);

  useEffect(() => {
    function handleVisibilityOrBlur(): void {
      if (document.visibilityState === "hidden" || !document.hasFocus()) {
        pauseRecall();
      }
    }

    window.addEventListener("blur", handleVisibilityOrBlur);
    document.addEventListener("visibilitychange", handleVisibilityOrBlur);
    return () => {
      window.removeEventListener("blur", handleVisibilityOrBlur);
      document.removeEventListener("visibilitychange", handleVisibilityOrBlur);
      pauseActiveTimer();
      onRangeLockedChange(false);
    };
  }, [onRangeLockedChange, pauseActiveTimer, pauseRecall]);

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent): void {
      if (event.code === "KeyP" && !event.repeat && isPausedRef.current) {
        event.preventDefault();
        resumeRecall();
        return;
      }
      if (!completedRun || !shouldHandleGlobalEnter(event, isInteractiveShortcutTarget(event.target))) {
        return;
      }
      event.preventDefault();
      restartRun();
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [completedRun, restartRun, resumeRecall]);

  const persistCompletedRun = useCallback(
    async (nextStates: Record<NoteName, StaffRecallColumnState>): Promise<void> => {
      if (savingRef.current) {
        return;
      }
      savingRef.current = true;
      const endedAt = new Date().toISOString();
      const run: StaffRecallRunRecord = {
        id: createUuid(),
        schemaVersion: 2,
        targetNoteSetKey,
        targetNoteIds,
        enabledGroupIds: settings.enabledGroupIds,
        includeInterStaffLedgerSpellings: applicableLedgerSetting(
          staffNotationMode,
          settings.includeInterStaffLedgerSpellings,
        ),
        staffNotationMode,
        columnOrder,
        columnActiveMs: completeColumnActiveMs(nextStates),
        startedAt: runStartedAtRef.current ?? endedAt,
        endedAt,
      };
      setCompletedRun(run);
      onRangeLockedChange(false);
      try {
        await saveStaffRecallRun(run);
        setLocalRuns((current) => [...current.filter((candidate) => candidate.id !== run.id), run]);
        await writeBackupNow().catch(() => undefined);
        await onDataChanged();
        onFinished?.();
      } catch (error) {
        setSaveError(error instanceof Error ? error.message : String(error));
      } finally {
        savingRef.current = false;
      }
    },
    [
      columnOrder,
      onDataChanged,
      onFinished,
      onRangeLockedChange,
      settings.enabledGroupIds,
      settings.includeInterStaffLedgerSpellings,
      staffNotationMode,
      targetNoteIds,
      targetNoteSetKey,
    ],
  );

  const startColumn = useCallback((noteName: NoteName): boolean => {
    if (activeNoteNameRef.current && activeNoteNameRef.current !== noteName) {
      return false;
    }
    if (!activeNoteNameRef.current) {
      activeNoteNameRef.current = noteName;
      activeAccumulatedMsRef.current = 0;
      activeStartedAtRef.current = undefined;
      runStartedAtRef.current ??= new Date().toISOString();
      setActiveNoteName(noteName);
      onRangeLockedChange(true);
      resumeActiveTimer();
    }
    return true;
  }, [onRangeLockedChange, resumeActiveTimer]);

  const handlePlacement = useCallback(
    (columnNoteName: NoteName, note: TargetNote): void => {
      if (
        isPausedRef.current ||
        completedRun ||
        columnStatesRef.current[columnNoteName].activeMs !== undefined ||
        !startColumn(columnNoteName)
      ) {
        return;
      }
      void playTargetNote(note).catch(() => undefined);

      const currentStates = columnStatesRef.current;
      const currentColumn = currentStates[columnNoteName];
      let nextColumn: StaffRecallColumnState;
      if (note.noteName !== columnNoteName) {
        nextColumn = { ...currentColumn, wrongNoteId: note.id };
      } else {
        const correctNoteIds = currentColumn.correctNoteIds.includes(note.id)
          ? currentColumn.correctNoteIds
          : [...currentColumn.correctNoteIds, note.id];
        nextColumn = { ...currentColumn, correctNoteIds, wrongNoteId: undefined };
      }

      const targetColumn = columns.find((column) => column.noteName === columnNoteName);
      if (!targetColumn) {
        return;
      }
      const targetIds = new Set<TargetNoteId>(targetColumn.notes.map((target) => target.id));
      const columnComplete =
        targetIds.size > 0 &&
        nextColumn.wrongNoteId === undefined &&
        nextColumn.correctNoteIds.length === targetIds.size &&
        nextColumn.correctNoteIds.every((id) => targetIds.has(id));
      if (columnComplete) {
        nextColumn = { ...nextColumn, activeMs: finishActiveTimer() };
      }
      const nextStates = { ...currentStates, [columnNoteName]: nextColumn };
      setStates(nextStates);

      if (columnComplete && NOTE_NAMES.every((noteName) => nextStates[noteName].activeMs !== undefined)) {
        void persistCompletedRun(nextStates);
      }
    },
    [columns, completedRun, finishActiveTimer, persistCompletedRun, setStates, startColumn],
  );

  const completedComparableRuns = completedRun
    ? comparableStaffRecallRuns(
        [...localRuns.filter((run) => run.id !== completedRun.id), completedRun],
        targetNoteSetKey,
      )
    : [];
  const currentTotalMs = completedRun ? totalStaffRecallActiveMs(completedRun) : undefined;
  const comparisonMedianTotalMs = percentile(comparisonRuns.map(totalStaffRecallActiveMs), 0.5);
  const totalDifferenceMs = currentTotalMs !== undefined && comparisonMedianTotalMs !== undefined
    ? currentTotalMs - comparisonMedianTotalMs
    : undefined;
  const totalDelta = totalDifferenceMs !== undefined ? formatStaffRecallDeltaMs(totalDifferenceMs) : undefined;
  const perNoteDelta = totalDifferenceMs !== undefined
    ? formatStaffRecallPerNoteDeltaMs(totalDifferenceMs, targetNoteIds.length)
    : undefined;
  const bestTotalMs = completedComparableRuns.length > 0
    ? Math.min(...completedComparableRuns.map(totalStaffRecallActiveMs))
    : undefined;
  const previousComparableTotals = completedRun
    ? completedComparableRuns
        .filter((run) => run.id !== completedRun.id)
        .map(totalStaffRecallActiveMs)
    : [];
  const previousBestTotalMs = previousComparableTotals.length > 0
    ? Math.min(...previousComparableTotals)
    : undefined;
  const isNewBest =
    currentTotalMs !== undefined &&
    previousBestTotalMs !== undefined &&
    currentTotalMs < previousBestTotalMs;
  const visibleTrendRuns = completedComparableRuns.slice(-uiPreferences.historyLimit);

  return (
    <>
      <div className="staff-recall-controls-row">
        <StudyDisplayControls
          columnOrderId="random"
          disabled
          isColumnOrderReversed={false}
          label="默写显示设置"
          showLabels
        />
        <span className="staff-recall-hint">
          {inputNotes.length === 0
            ? "请至少启用一个音域组"
            : activeNoteName
              ? `正在默写 ${activeNoteName}，完成后可选择下一列`
              : completedRun
                ? "本轮已完成"
                : "选择任一列开始默写"}
        </span>
      </div>

      <div className="study-map-frame staff-recall-map-frame" ref={mapFrameRef}>
        <figure className="study-figure staff-recall-figure">
          {inputNotes.length > 0 ? (
            <StaffRecallMap
              key={runVersion}
              activeNoteName={activeNoteName}
              columnStates={columnStates}
              columns={columns}
              inputNotes={inputNotes}
              onPlacement={handlePlacement}
              comparisonMedianMsByNoteName={comparisonColumnMedianMs}
              runCompleted={completedRun !== undefined}
              staffNotationMode={staffNotationMode}
            />
          ) : (
            <div className="staff-notation-empty">请选择音域后开始默写</div>
          )}
        </figure>
      </div>

      {saveError ? <p className="staff-recall-save-error">默写成绩保存失败：{saveError}</p> : null}
      {completedRun && currentTotalMs !== undefined ? (
        <section className="panel staff-recall-summary" aria-label="本轮默写结果">
          <div className="staff-recall-summary-heading">
            <div className="staff-recall-summary-metrics">
              <div className="metric">
                <span>本次总时间</span>
                <strong>
                  {formatMs(currentTotalMs)}
                  {totalDelta ? <small className={totalDelta.direction}>{totalDelta.text}</small> : null}
                  <small className="staff-recall-summary-per-note">
                    每音用时 <b>{formatStaffRecallPerNoteMs(currentTotalMs, targetNoteIds.length)}</b>
                    {perNoteDelta ? <span className={perNoteDelta.direction}>{perNoteDelta.text}</span> : null}
                  </small>
                </strong>
              </div>
              <div className="metric">
                <span>
                  个人最佳
                  {isNewBest ? <small className="new-record-label">新纪录！</small> : null}
                </span>
                <strong className={isNewBest ? "new-best" : undefined}>
                  {formatMs(bestTotalMs)}
                  {bestTotalMs !== undefined ? (
                    <small className="staff-recall-summary-per-note">
                      每音用时 <b>{formatStaffRecallPerNoteMs(bestTotalMs, targetNoteIds.length)}</b>
                    </small>
                  ) : null}
                </strong>
              </div>
            </div>
            <button aria-keyshortcuts="Enter" className="primary" onClick={restartRun} type="button">
              <RotateCcw size={18} />
              再来一次<kbd>Enter</kbd>
            </button>
          </div>
          <div className="staff-recall-trend-heading">
            <h2>最近成绩</h2>
            <HistoryLimitControl
              ariaLabel="默写历史次数"
              historyLimit={uiPreferences.historyLimit}
              onHistoryLimitChange={(historyLimit) => setUiPreferences({ historyLimit })}
            />
          </div>
          {completedComparableRuns.length >= 2 ? (
            <StaffRecallTrendChart currentRunId={completedRun.id} runs={visibleTrendRuns} />
          ) : (
            <div className="staff-recall-first-run">首次完成</div>
          )}
        </section>
      ) : null}
      {isPaused ? <PauseOverlay onResume={resumeRecall} /> : null}
    </>
  );
}
