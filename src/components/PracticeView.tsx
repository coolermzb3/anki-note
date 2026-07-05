import { BarChart3, Pause, Play, RotateCcw, SlidersHorizontal, Square, Volume2 } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { playPianoNote, playTargetNote, unlockAudio } from "../audio/piano";
import { db, deletePracticeSessionWithReviews, resolveQueueStrategy, saveReview } from "../data/db";
import { writeBackupNow } from "../data/backup";
import { createUuid } from "../domain/id";
import {
  ANSWER_BUTTONS,
  formatTargetNoteLabel,
  getNoteById,
  getNotesForGroups,
  PRACTICE_GROUPS,
} from "../domain/notes";
import { shouldIgnoreReviewForSession, shouldKeepPracticeSession } from "../domain/practiceSession";
import { isCompletedReview } from "../domain/reviews";
import { getDrillNotes, selectNextNote, selectNotePage } from "../domain/scheduler";
import { buildNoteStats, filterLongTermReviews, formatMs, percentile } from "../domain/stats";
import type {
  AppSettings,
  FocusLoss,
  InterruptReason,
  NoteName,
  PracticeGroupId,
  PracticeMode,
  PracticeQueueStrategy,
  PracticeSessionRecord,
  PromptDisplayMode,
  PromptNoteDuration,
  ReviewRecord,
  TargetNote,
  WrongAnswer,
} from "../domain/types";
import { StaffPagePrompt } from "./StaffPagePrompt";
import { StaffPrompt } from "./StaffPrompt";

interface PracticeViewProps {
  settings: AppSettings;
  reviews: ReviewRecord[];
  navigationExitRequest?: PracticeNavigationExitRequest | null;
  onNavigationExit?: (targetView: PracticeNavigationExitTarget) => void;
  onSettingsSaved: (settings: AppSettings) => void;
  onDataChanged: () => Promise<void>;
  onOpenStats: () => void;
  onRunningChange: (running: boolean) => void;
}

export type PracticeNavigationExitTarget = "practice" | "stats" | "settings";

export interface PracticeNavigationExitRequest {
  id: number;
  targetView: PracticeNavigationExitTarget;
}

interface PromptRuntime {
  note: TargetNote;
  startedAt: string;
  activeBaseMs: number;
  activeStartedAt: number | null;
  lastInputAt: number;
  wrongAnswers: WrongAnswer[];
  replayCount: number;
  focusLosses: FocusLoss[];
  interrupted: boolean;
  interruptReason?: InterruptReason;
}

type Phase = "setup" | "running" | "summary";

interface SessionSummary {
  session: PracticeSessionRecord;
  reviews: ReviewRecord[];
}

interface StaffPageRuntime {
  notes: TargetNote[];
  index: number;
  completedCount: number;
}

interface CompleteSessionOptions {
  showSummary?: boolean;
  updateUi?: boolean;
}

function newSessionId(): string {
  return createUuid();
}

function formatDuration(ms: number): string {
  const totalSeconds = Math.max(0, Math.ceil(ms / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

function durationSecondsToInputMinutes(seconds: number): string {
  return Number((seconds / 60).toFixed(2)).toString();
}

function inputMinutesToDurationSeconds(value: string): number {
  return Math.max(60, Math.round(Number(value) * 60));
}

const ALL_GROUP_IDS: PracticeGroupId[] = PRACTICE_GROUPS.map((group) => group.id);
const STAFF_PAGE_SIZE = 48;
const MELODY_BUFFER_SIZE = 16;
const PRACTICE_QUEUE_OPTIONS: Array<{ strategy: PracticeQueueStrategy; label: string; description: string }> = [
  {
    strategy: "adaptive",
    label: "常规队列",
    description: "按新卡、慢卡和易错卡做轻量加权",
  },
  {
    strategy: "focused",
    label: "薄弱项优先",
    description: "约 80% 慢卡/易错卡，20% 全量探索",
  },
  {
    strategy: "melody",
    label: "自动旋律生成",
    description: "在启用组音域内生成级进为主的练习",
  },
  {
    strategy: "note-drill",
    label: "单音强化",
    description: "只抽所选音名，不写入统计",
  },
];

export function PracticeView({
  settings,
  reviews,
  navigationExitRequest,
  onNavigationExit,
  onSettingsSaved,
  onDataChanged,
  onOpenStats,
  onRunningChange,
}: PracticeViewProps): JSX.Element {
  const [phase, setPhase] = useState<Phase>("setup");
  const [mode, setMode] = useState<PracticeMode>(settings.defaultMode);
  const [promptDisplayMode, setPromptDisplayMode] = useState<PromptDisplayMode>(
    settings.promptDisplayMode ?? "staff-page",
  );
  const [promptNoteDuration, setPromptNoteDuration] = useState<PromptNoteDuration>(
    settings.promptNoteDuration ?? "quarter",
  );
  const [enabledGroupIds, setEnabledGroupIds] = useState<PracticeGroupId[]>(settings.enabledGroupIds);
  const [fixedCount, setFixedCount] = useState(settings.fixedCount);
  const [fixedDurationSeconds, setFixedDurationSeconds] = useState(settings.fixedDurationSeconds);
  const [autoPlayTarget, setAutoPlayTarget] = useState(settings.autoPlayTarget);
  const [includeLedgerVariants, setIncludeLedgerVariants] = useState(settings.includeLedgerVariants ?? true);
  const [queueStrategy, setQueueStrategy] = useState<PracticeQueueStrategy>(resolveQueueStrategy(settings));
  const [drillNoteNames, setDrillNoteNames] = useState<NoteName[]>(settings.drillNoteNames ?? ["C"]);
  const [session, setSession] = useState<PracticeSessionRecord | null>(null);
  const [currentNote, setCurrentNote] = useState<TargetNote | null>(null);
  const [completedCount, setCompletedCount] = useState(0);
  const [wrongAnswerCount, setWrongAnswerCount] = useState(0);
  const [feedback, setFeedback] = useState<{ type: "wrong" | "correct"; noteName?: NoteName } | null>(null);
  const [tick, setTick] = useState(0);
  const [summary, setSummary] = useState<SessionSummary | null>(null);
  const [staffPageNotes, setStaffPageNotes] = useState<TargetNote[]>([]);
  const [staffPageIndex, setStaffPageIndex] = useState(0);
  const [staffPageCompletedCount, setStaffPageCompletedCount] = useState(0);
  const [isPaused, setIsPaused] = useState(false);

  const promptRef = useRef<PromptRuntime | null>(null);
  const sessionRef = useRef<PracticeSessionRecord | null>(null);
  const sessionReviewsRef = useRef<ReviewRecord[]>([]);
  const lastTargetNoteIdRef = useRef<TargetNote["id"] | undefined>();
  const melodyQueueRef = useRef<TargetNote[]>([]);
  const staffPageRef = useRef<StaffPageRuntime | null>(null);
  const endingRef = useRef(false);
  const sessionActiveBaseMsRef = useRef(0);
  const sessionActiveStartedAtRef = useRef<number | null>(null);
  const isPausedRef = useRef(false);
  const pendingAfterPauseRef = useRef<(() => void) | null>(null);
  const lastBackupCompletedRef = useRef(0);
  const lastBackupAtRef = useRef<number>(performance.now());
  const handledNavigationExitRequestIdRef = useRef<number | null>(null);

  useEffect(() => {
    onRunningChange(phase === "running");
    return () => onRunningChange(false);
  }, [onRunningChange, phase]);

  useEffect(() => {
    if (phase === "setup") {
      setMode(settings.defaultMode);
      setPromptDisplayMode(settings.promptDisplayMode ?? "staff-page");
      setPromptNoteDuration(settings.promptNoteDuration ?? "quarter");
      setEnabledGroupIds(settings.enabledGroupIds);
      setFixedCount(settings.fixedCount);
      setFixedDurationSeconds(settings.fixedDurationSeconds);
      setAutoPlayTarget(settings.autoPlayTarget);
      setIncludeLedgerVariants(settings.includeLedgerVariants ?? true);
      setQueueStrategy(resolveQueueStrategy(settings));
      setDrillNoteNames(settings.drillNoteNames ?? ["C"]);
    }
  }, [phase, settings]);

  const enabledNotes = useMemo(
    () => getNotesForGroups(enabledGroupIds, includeLedgerVariants),
    [enabledGroupIds, includeLedgerVariants],
  );
  const fullPracticeCount = useMemo(
    () => getNotesForGroups(ALL_GROUP_IDS, includeLedgerVariants).length,
    [includeLedgerVariants],
  );
  const fixedCountPresets = useMemo(() => Array.from(new Set([10, 20, fullPracticeCount])), [fullPracticeCount]);
  const queueNotes = useMemo(
    () => (queueStrategy === "note-drill" ? getDrillNotes(enabledNotes, drillNoteNames) : enabledNotes),
    [drillNoteNames, enabledNotes, queueStrategy],
  );
  const schedulerReviews = useMemo(() => filterLongTermReviews(reviews), [reviews]);

  const toggleDrillNoteName = useCallback((noteName: NoteName, checked: boolean): void => {
    setDrillNoteNames((current) => {
      const next = checked ? [...current, noteName] : current.filter((name) => name !== noteName);
      const selected = new Set(next);
      return ANSWER_BUTTONS.map((button) => button.noteName).filter((name) => selected.has(name));
    });
  }, []);

  const getPromptActiveMs = useCallback((): number => {
    const prompt = promptRef.current;
    if (!prompt) {
      return 0;
    }
    const running = prompt.activeStartedAt === null ? 0 : performance.now() - prompt.activeStartedAt;
    return Math.round(prompt.activeBaseMs + running);
  }, []);

  const getSessionActiveMs = useCallback((): number => {
    const running =
      sessionActiveStartedAtRef.current === null ? 0 : performance.now() - sessionActiveStartedAtRef.current;
    return Math.round(sessionActiveBaseMsRef.current + running);
  }, []);

  const markInterrupted = useCallback((reason: InterruptReason): void => {
    const prompt = promptRef.current;
    if (!prompt || prompt.interrupted) {
      return;
    }
    prompt.interrupted = true;
    prompt.interruptReason = reason;
  }, []);

  const pauseActiveTimers = useCallback((): void => {
    const now = performance.now();
    const prompt = promptRef.current;
    if (prompt?.activeStartedAt !== null && prompt?.activeStartedAt !== undefined) {
      prompt.activeBaseMs += now - prompt.activeStartedAt;
      prompt.activeStartedAt = null;
    }
    if (sessionActiveStartedAtRef.current !== null) {
      sessionActiveBaseMsRef.current += now - sessionActiveStartedAtRef.current;
      sessionActiveStartedAtRef.current = null;
    }
  }, []);

  const resumeActiveTimers = useCallback((): void => {
    const now = performance.now();
    const prompt = promptRef.current;
    if (prompt && prompt.activeStartedAt === null) {
      const lastLoss = prompt.focusLosses[prompt.focusLosses.length - 1];
      if (lastLoss && !lastLoss.regainedFocusAt) {
        lastLoss.regainedFocusAt = new Date().toISOString();
      }
      prompt.activeStartedAt = now;
      prompt.lastInputAt = now;
    }
    if (sessionActiveStartedAtRef.current === null) {
      sessionActiveStartedAtRef.current = now;
    }
  }, []);

  const pausePractice = useCallback((): void => {
    pauseActiveTimers();
    if (!isPausedRef.current) {
      isPausedRef.current = true;
      setIsPaused(true);
    }
  }, [pauseActiveTimers]);

  const resumePractice = useCallback((): void => {
    if (!isPausedRef.current) {
      return;
    }
    isPausedRef.current = false;
    setIsPaused(false);
    const pendingAfterPause = pendingAfterPauseRef.current;
    pendingAfterPauseRef.current = null;
    if (pendingAfterPause) {
      pendingAfterPause();
      return;
    }
    if (promptRef.current) {
      resumeActiveTimers();
    }
  }, [resumeActiveTimers]);

  const togglePause = useCallback((): void => {
    if (isPausedRef.current) {
      resumePractice();
      return;
    }
    pausePractice();
  }, [pausePractice, resumePractice]);

  const pauseForFocusLoss = useCallback((): void => {
    const prompt = promptRef.current;
    if (prompt) {
      markInterrupted("focus-lost");
      const lastLoss = prompt.focusLosses[prompt.focusLosses.length - 1];
      if (!lastLoss || lastLoss.regainedFocusAt) {
        prompt.focusLosses.push({ lostFocusAt: new Date().toISOString() });
      }
    }
    pausePractice();
  }, [markInterrupted, pausePractice]);

  const persistConfig = useCallback(async (): Promise<AppSettings> => {
    const nextSettings: AppSettings = {
      ...settings,
      enabledGroupIds,
      defaultMode: mode,
      promptDisplayMode,
      promptNoteDuration,
      fixedCount,
      fixedDurationSeconds,
      autoPlayTarget,
      includeLedgerVariants,
      queueStrategy,
      drillNoteNames,
      focusedTraining: queueStrategy === "focused",
    };
    await db.settings.put(nextSettings);
    onSettingsSaved(nextSettings);
    return nextSettings;
  }, [
    autoPlayTarget,
    enabledGroupIds,
    fixedCount,
    fixedDurationSeconds,
    drillNoteNames,
    includeLedgerVariants,
    mode,
    onSettingsSaved,
    queueStrategy,
    settings,
    promptDisplayMode,
    promptNoteDuration,
  ]);

  const maybeBackupDuringOpenEnded = useCallback(
    async (nextCompletedCount: number): Promise<void> => {
      if (mode !== "open-ended") {
        return;
      }
      const now = performance.now();
      const reviewsSinceBackup = nextCompletedCount - lastBackupCompletedRef.current;
      const msSinceBackup = now - lastBackupAtRef.current;
      if (reviewsSinceBackup < 50 && msSinceBackup < 5 * 60 * 1000) {
        return;
      }
      lastBackupCompletedRef.current = nextCompletedCount;
      lastBackupAtRef.current = now;
      await writeBackupNow().catch(() => undefined);
    },
    [mode],
  );

  const syncStaffPage = useCallback((page: StaffPageRuntime | null): void => {
    staffPageRef.current = page;
    setStaffPageNotes(page?.notes ?? []);
    setStaffPageIndex(page?.index ?? 0);
    setStaffPageCompletedCount(page?.completedCount ?? 0);
  }, []);

  const getNextStaffPageCount = useCallback(
    (nextCompletedCount: number): number => {
      if (mode !== "fixed-count") {
        return STAFF_PAGE_SIZE;
      }
      return Math.min(STAFF_PAGE_SIZE, Math.max(0, fixedCount - nextCompletedCount));
    },
    [fixedCount, mode],
  );

  const startPrompt = useCallback(
    (note: TargetNote): void => {
      const now = performance.now();
      promptRef.current = {
        note,
        startedAt: new Date().toISOString(),
        activeBaseMs: 0,
        activeStartedAt: now,
        lastInputAt: now,
        wrongAnswers: [],
        replayCount: 0,
        focusLosses: [],
        interrupted: false,
      };
      setCurrentNote(note);
      setFeedback(null);
      if (autoPlayTarget) {
        void playTargetNote(note).catch(() => undefined);
      }
    },
    [autoPlayTarget],
  );

  const markCurrentStaffPageNoteComplete = useCallback((): void => {
    const page = staffPageRef.current;
    if (!page) {
      return;
    }
    syncStaffPage({
      ...page,
      completedCount: Math.max(page.completedCount, page.index + 1),
    });
  }, [syncStaffPage]);

  const startStaffPageIndex = useCallback(
    (index: number): boolean => {
      const page = staffPageRef.current;
      if (!page || index >= page.notes.length) {
        return false;
      }
      const nextPage = {
        ...page,
        index,
      };
      syncStaffPage(nextPage);
      startPrompt(nextPage.notes[index]);
      return true;
    },
    [startPrompt, syncStaffPage],
  );

  const startStaffPage = useCallback(
    ({
      sourceNotes,
      sourceReviews,
      sourceQueueStrategy,
      sourceDrillNoteNames,
      nextCompletedCount,
    }: {
      sourceNotes: TargetNote[];
      sourceReviews: ReviewRecord[];
      sourceQueueStrategy: PracticeQueueStrategy;
      sourceDrillNoteNames: NoteName[];
      nextCompletedCount: number;
    }): void => {
      const count = getNextStaffPageCount(nextCompletedCount);
      if (count <= 0) {
        return;
      }
      const notes = selectNotePage({
        notes: sourceNotes,
        reviews: sourceReviews,
        queueStrategy: sourceQueueStrategy,
        drillNoteNames: sourceDrillNoteNames,
        lastTargetNoteId: lastTargetNoteIdRef.current,
        count,
      });
      const page = {
        notes,
        index: 0,
        completedCount: 0,
      };
      syncStaffPage(page);
      startPrompt(notes[0]);
    },
    [getNextStaffPageCount, startPrompt, syncStaffPage],
  );

  const drawMelodyNote = useCallback((sourceNotes: TargetNote[], remainingCount?: number): TargetNote => {
    if (melodyQueueRef.current.length === 0) {
      const count =
        remainingCount === undefined ? MELODY_BUFFER_SIZE : Math.min(MELODY_BUFFER_SIZE, Math.max(1, remainingCount));
      melodyQueueRef.current = selectNotePage({
        notes: sourceNotes,
        reviews: [],
        queueStrategy: "melody",
        lastTargetNoteId: lastTargetNoteIdRef.current,
        count,
      });
    }
    const [nextNote, ...remainingNotes] = melodyQueueRef.current;
    if (!nextNote) {
      throw new Error("Cannot draw a melody note without enabled groups.");
    }
    melodyQueueRef.current = remainingNotes;
    return nextNote;
  }, []);

  const selectAndStartNext = useCallback(
    (nextCompletedCount: number): void => {
      const nextReviews = [...schedulerReviews, ...sessionReviewsRef.current];
      const remainingCount = mode === "fixed-count" ? fixedCount - nextCompletedCount : undefined;
      const note =
        queueStrategy === "melody"
          ? drawMelodyNote(enabledNotes, remainingCount)
          : selectNextNote({
              notes: enabledNotes,
              reviews: nextReviews,
              queueStrategy,
              drillNoteNames,
              lastTargetNoteId: lastTargetNoteIdRef.current,
            });
      startPrompt(note);
    },
    [drillNoteNames, drawMelodyNote, enabledNotes, fixedCount, mode, queueStrategy, schedulerReviews, startPrompt],
  );

  const finishCurrentReview = useCallback(
    async (answeredCorrectly: boolean, interruptReason?: InterruptReason): Promise<ReviewRecord | null> => {
      const prompt = promptRef.current;
      const activeMs = getPromptActiveMs();
      if (!prompt || !sessionRef.current) {
        return null;
      }
      if (!answeredCorrectly) {
        prompt.interrupted = true;
        prompt.interruptReason = interruptReason ?? prompt.interruptReason ?? "manual-stop";
      }
      pauseActiveTimers();
      const endedAt = new Date().toISOString();
      const ignored = shouldIgnoreReviewForSession(sessionRef.current);
      const review: ReviewRecord = {
        id: createUuid(),
        schemaVersion: 1,
        sessionId: sessionRef.current.id,
        targetNoteId: prompt.note.id,
        groupId: prompt.note.groupId,
        noteName: prompt.note.noteName,
        octave: prompt.note.octave,
        startedAt: prompt.startedAt,
        endedAt,
        answeredAt: answeredCorrectly ? endedAt : undefined,
        answeredCorrectly,
        interrupted: prompt.interrupted,
        interruptReason: prompt.interruptReason,
        activeMs,
        wrongAnswers: prompt.wrongAnswers,
        replayCount: prompt.replayCount,
        focusLosses: prompt.focusLosses,
        ignored,
      };
      promptRef.current = null;
      lastTargetNoteIdRef.current = prompt.note.id;
      if (!ignored) {
        await saveReview(review);
      }
      sessionReviewsRef.current = [...sessionReviewsRef.current, review];
      return review;
    },
    [getPromptActiveMs, pauseActiveTimers],
  );

  const completeSession = useCallback(
    async (
      endReason: PracticeSessionRecord["endReason"],
      unfinishedReason?: InterruptReason,
      options: CompleteSessionOptions = {},
    ): Promise<void> => {
      if (endingRef.current || !sessionRef.current) {
        return;
      }
      const showSummary = options.showSummary ?? true;
      const updateUi = options.updateUi ?? true;
      endingRef.current = true;
      const unfinishedReview = promptRef.current ? await finishCurrentReview(false, unfinishedReason) : null;
      pauseActiveTimers();
      const endedAt = new Date().toISOString();
      const finalReviews = unfinishedReview
        ? sessionReviewsRef.current
        : [...sessionReviewsRef.current];
      const finalSession: PracticeSessionRecord = {
        ...sessionRef.current,
        endedAt,
        endReason,
        completedCount: finalReviews.filter(isCompletedReview).length,
        interruptedCount: finalReviews.filter((review) => review.interrupted).length,
      };
      const shouldKeepSession = shouldKeepPracticeSession(finalSession, finalReviews);
      if (shouldKeepSession) {
        await db.practiceSessions.put(finalSession);
        sessionRef.current = finalSession;
        if (updateUi) {
          setSession(finalSession);
          setSummary(showSummary ? { session: finalSession, reviews: finalReviews } : null);
        }
      } else {
        await deletePracticeSessionWithReviews(finalSession.id, finalReviews);
        sessionRef.current = null;
        if (updateUi) {
          setSession(null);
          setSummary(null);
        }
      }
      if (updateUi) {
        setCurrentNote(null);
        syncStaffPage(null);
      } else {
        staffPageRef.current = null;
      }
      isPausedRef.current = false;
      pendingAfterPauseRef.current = null;
      if (updateUi) {
        setIsPaused(false);
        setPhase(showSummary && shouldKeepSession ? "summary" : "setup");
      }
      await writeBackupNow().catch(() => undefined);
      await onDataChanged();
      endingRef.current = false;
    },
    [finishCurrentReview, onDataChanged, pauseActiveTimers, syncStaffPage],
  );

  useEffect(() => {
    if (
      phase !== "running" ||
      !navigationExitRequest ||
      handledNavigationExitRequestIdRef.current === navigationExitRequest.id
    ) {
      return;
    }
    handledNavigationExitRequestIdRef.current = navigationExitRequest.id;
    const backgroundExit = Promise.resolve().then(() =>
      completeSession("manual-stop", "manual-stop", { showSummary: false, updateUi: false }),
    );
    onNavigationExit?.(navigationExitRequest.targetView);
    void backgroundExit.catch(() => undefined);
  }, [completeSession, navigationExitRequest, onNavigationExit, phase]);

  const startSession = useCallback(async (): Promise<void> => {
    if (queueNotes.length === 0) {
      return;
    }
    void unlockAudio().catch(() => undefined);
    const nextSettings = await persistConfig();
    const startedAt = new Date().toISOString();
    const nextSession: PracticeSessionRecord = {
      id: newSessionId(),
      schemaVersion: 1,
      mode,
      enabledGroupIds,
      fixedCount: mode === "fixed-count" ? fixedCount : undefined,
      fixedDurationSeconds: mode === "fixed-duration" ? fixedDurationSeconds : undefined,
      queueStrategy,
      drillNoteNames,
      focusedTraining: queueStrategy === "focused",
      startedAt,
      completedCount: 0,
      interruptedCount: 0,
    };
    await db.practiceSessions.put(nextSession);
    sessionRef.current = nextSession;
    sessionReviewsRef.current = [];
    lastTargetNoteIdRef.current = undefined;
    melodyQueueRef.current = [];
    syncStaffPage(null);
    endingRef.current = false;
    lastBackupAtRef.current = performance.now();
    lastBackupCompletedRef.current = 0;
    sessionActiveBaseMsRef.current = 0;
    sessionActiveStartedAtRef.current = performance.now();
    isPausedRef.current = false;
    pendingAfterPauseRef.current = null;
    setSession(nextSession);
    setCompletedCount(0);
    setWrongAnswerCount(0);
    setSummary(null);
    setIsPaused(false);
    setPhase("running");
    const nextEnabledNotes = getNotesForGroups(nextSettings.enabledGroupIds, nextSettings.includeLedgerVariants);
    if (nextSettings.promptDisplayMode === "staff-page") {
      startStaffPage({
        sourceNotes: nextEnabledNotes,
        sourceReviews: schedulerReviews,
        sourceQueueStrategy: nextSettings.queueStrategy,
        sourceDrillNoteNames: nextSettings.drillNoteNames,
        nextCompletedCount: 0,
      });
    } else {
      const firstNote =
        nextSettings.queueStrategy === "melody"
          ? drawMelodyNote(nextEnabledNotes, mode === "fixed-count" ? fixedCount : undefined)
          : selectNextNote({
              notes: nextEnabledNotes,
              reviews: schedulerReviews,
              queueStrategy: nextSettings.queueStrategy,
              drillNoteNames: nextSettings.drillNoteNames,
            });
      startPrompt(firstNote);
    }
  }, [
    enabledGroupIds,
    fixedCount,
    fixedDurationSeconds,
    drillNoteNames,
    drawMelodyNote,
    includeLedgerVariants,
    mode,
    persistConfig,
    promptDisplayMode,
    queueNotes.length,
    queueStrategy,
    schedulerReviews,
    startPrompt,
    startStaffPage,
    syncStaffPage,
  ]);

  const replayTarget = useCallback(async (): Promise<void> => {
    const prompt = promptRef.current;
    if (!prompt || isPausedRef.current) {
      return;
    }
    prompt.lastInputAt = performance.now();
    prompt.replayCount += 1;
    await playTargetNote(prompt.note).catch(() => undefined);
  }, []);

  const submitAnswer = useCallback(
    async (noteName: NoteName): Promise<void> => {
      const prompt = promptRef.current;
      if (!prompt || isPausedRef.current || feedback?.type === "correct") {
        return;
      }
      prompt.lastInputAt = performance.now();
      void playPianoNote(noteName, prompt.note.octave).catch(() => undefined);
      if (noteName !== prompt.note.noteName) {
        prompt.wrongAnswers.push({ noteName, atActiveMs: getPromptActiveMs() });
        setWrongAnswerCount((count) => count + 1);
        setFeedback({ type: "wrong", noteName });
        window.setTimeout(() => setFeedback((current) => (current?.type === "wrong" ? null : current)), 450);
        return;
      }

      setFeedback({ type: "correct", noteName });
      const review = await finishCurrentReview(true);
      if (!review) {
        return;
      }
      const nextCompletedCount = completedCount + 1;
      setCompletedCount(nextCompletedCount);
      if (promptDisplayMode === "staff-page") {
        markCurrentStaffPageNoteComplete();
      }
      await maybeBackupDuringOpenEnded(nextCompletedCount);
      const reviewSessionId = review.sessionId;

      const continueAfterCorrectDelay = (): void => {
        if (sessionRef.current?.id !== reviewSessionId || sessionRef.current.endedAt) {
          return;
        }
        resumeActiveTimers();
        if (mode === "fixed-count" && nextCompletedCount >= fixedCount) {
          void completeSession("completed-count");
          return;
        }
        if (promptDisplayMode === "staff-page") {
          const page = staffPageRef.current;
          if (page && startStaffPageIndex(page.index + 1)) {
            return;
          }
          startStaffPage({
            sourceNotes: enabledNotes,
            sourceReviews: [...schedulerReviews, ...sessionReviewsRef.current],
            sourceQueueStrategy: queueStrategy,
            sourceDrillNoteNames: drillNoteNames,
            nextCompletedCount,
          });
          return;
        }
        selectAndStartNext(nextCompletedCount);
      };

      window.setTimeout(() => {
        if (isPausedRef.current) {
          pendingAfterPauseRef.current = continueAfterCorrectDelay;
          return;
        }
        continueAfterCorrectDelay();
      }, settings.correctDelayMs);
    },
    [
      completeSession,
      completedCount,
      drillNoteNames,
      enabledNotes,
      feedback?.type,
      finishCurrentReview,
      fixedCount,
      getPromptActiveMs,
      markCurrentStaffPageNoteComplete,
      maybeBackupDuringOpenEnded,
      mode,
      promptDisplayMode,
      queueStrategy,
      resumeActiveTimers,
      schedulerReviews,
      selectAndStartNext,
      settings.correctDelayMs,
      startStaffPage,
      startStaffPageIndex,
    ],
  );

  useEffect(() => {
    if (phase !== "running") {
      return;
    }

    function onKeyDown(event: KeyboardEvent): void {
      if (event.repeat) {
        return;
      }
      if (event.code === "KeyP") {
        event.preventDefault();
        togglePause();
        return;
      }
      if (event.code === "Escape") {
        event.preventDefault();
        void completeSession("manual-stop", "manual-stop");
        return;
      }
      if (isPausedRef.current) {
        event.preventDefault();
        return;
      }
      if (event.code === "Space") {
        event.preventDefault();
        void replayTarget();
        return;
      }
      const answer = ANSWER_BUTTONS.find((button) => event.key === button.key);
      if (answer) {
        event.preventDefault();
        void submitAnswer(answer.noteName);
      }
    }

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [completeSession, phase, replayTarget, submitAnswer, togglePause]);

  useEffect(() => {
    if (phase !== "running") {
      return;
    }

    function onVisibilityOrBlur(): void {
      if (document.visibilityState === "hidden" || !document.hasFocus()) {
        pauseForFocusLoss();
      }
    }

    window.addEventListener("blur", onVisibilityOrBlur);
    document.addEventListener("visibilitychange", onVisibilityOrBlur);
    return () => {
      window.removeEventListener("blur", onVisibilityOrBlur);
      document.removeEventListener("visibilitychange", onVisibilityOrBlur);
    };
  }, [pauseForFocusLoss, phase]);

  useEffect(() => {
    if (phase !== "running") {
      return;
    }
    const interval = window.setInterval(() => {
      const prompt = promptRef.current;
      if (prompt && prompt.activeStartedAt !== null && !prompt.interrupted) {
        const inactiveMs = performance.now() - prompt.lastInputAt;
        if (inactiveMs >= settings.inactivityThresholdSeconds * 1000) {
          markInterrupted("inactive-timeout");
        }
      }
      if (mode === "fixed-duration" && getSessionActiveMs() >= fixedDurationSeconds * 1000) {
        void completeSession("completed-duration", "duration-ended");
      }
      setTick((value) => value + 1);
    }, 250);
    return () => window.clearInterval(interval);
  }, [
    completeSession,
    fixedDurationSeconds,
    getSessionActiveMs,
    markInterrupted,
    mode,
    phase,
    settings.inactivityThresholdSeconds,
  ]);

  const setupDisabled = queueNotes.length === 0;
  const remainingMs = mode === "fixed-duration" ? fixedDurationSeconds * 1000 - getSessionActiveMs() : 0;
  const sessionQualifiedTimes = (summary?.reviews ?? [])
    .filter(isCompletedReview)
    .map((review) => review.activeMs);
  const weakestNotes = summary
    ? buildNoteStats(summary.reviews)
        .filter((stat) => stat.reviewCount > 0)
        .sort((a, b) => b.weaknessScore - a.weaknessScore)
        .slice(0, 4)
    : [];

  if (phase === "setup") {
    return (
      <section className="practice-shell">
        <div className="setup-grid">
          <div className="panel setup-panel">
            <div className="panel-heading">
              <h1>单音识谱</h1>
              <p>1=C · 2=D · 3=E · 4=F · 5=G · 6=A · 7=B</p>
            </div>
            <div className="control-block">
              <span className="control-label">启用组</span>
              <div className="group-grid">
                {PRACTICE_GROUPS.map((group) => {
                  const checked = enabledGroupIds.includes(group.id);
                  return (
                    <label className={checked ? "choice choice-active" : "choice"} key={group.id}>
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={(event) => {
                          setEnabledGroupIds((current) =>
                            event.target.checked ? [...current, group.id] : current.filter((id) => id !== group.id),
                          );
                        }}
                      />
                      <span>{group.label}</span>
                    </label>
                  );
                })}
              </div>
            </div>

            <div className="control-block">
              <span className="control-label">模式</span>
              <div className="segmented">
                <button className={mode === "open-ended" ? "active" : ""} onClick={() => setMode("open-ended")}>
                  无限
                </button>
                <button className={mode === "fixed-count" ? "active" : ""} onClick={() => setMode("fixed-count")}>
                  固定题数
                </button>
                <button className={mode === "fixed-duration" ? "active" : ""} onClick={() => setMode("fixed-duration")}>
                  固定时长
                </button>
              </div>
            </div>

            <div className="control-block">
              <span className="control-label">显示方式</span>
              <div className="display-options">
                <div className="segmented">
                  <button
                    className={promptDisplayMode === "single-note" ? "active" : ""}
                    onClick={() => setPromptDisplayMode("single-note")}
                  >
                    单音
                  </button>
                  <button
                    className={promptDisplayMode === "staff-page" ? "active" : ""}
                    onClick={() => setPromptDisplayMode("staff-page")}
                  >
                    谱页
                  </button>
                </div>
                <div className="segmented">
                  <button
                    className={promptNoteDuration === "whole" ? "active" : ""}
                    onClick={() => setPromptNoteDuration("whole")}
                  >
                    全音符 𝅝
                  </button>
                  <button
                    className={promptNoteDuration === "quarter" ? "active" : ""}
                    onClick={() => setPromptNoteDuration("quarter")}
                  >
                    四分音符 ♩
                  </button>
                </div>
              </div>
            </div>

            {mode === "fixed-count" ? (
              <div className="control-block">
                <span className="control-label">题数</span>
                <div className="number-row">
                  {fixedCountPresets.map((count) => (
                    <button className={fixedCount === count ? "active" : ""} key={count} onClick={() => setFixedCount(count)}>
                      {count}
                    </button>
                  ))}
                  <input
                    min={1}
                    max={500}
                    type="number"
                    value={fixedCount}
                    onChange={(event) => setFixedCount(Math.max(1, Number(event.target.value)))}
                  />
                </div>
              </div>
            ) : null}

            {mode === "fixed-duration" ? (
              <div className="control-block">
                <span className="control-label">时长</span>
                <div className="number-row">
                  {[60, 120, 180, 300].map((seconds) => (
                    <button
                      className={fixedDurationSeconds === seconds ? "active" : ""}
                      key={seconds}
                      onClick={() => setFixedDurationSeconds(seconds)}
                    >
                      {seconds / 60} 分钟
                    </button>
                  ))}
                  <input
                    min={1}
                    max={120}
                    step={0.5}
                    type="number"
                    value={durationSecondsToInputMinutes(fixedDurationSeconds)}
                    onChange={(event) => setFixedDurationSeconds(inputMinutesToDurationSeconds(event.target.value))}
                  />
                </div>
              </div>
            ) : null}

            <div className="control-block">
              <span className="control-label">训练策略</span>
              <div className="strategy-options">
                {PRACTICE_QUEUE_OPTIONS.map((option) => (
                  <label
                    className={queueStrategy === option.strategy ? "choice choice-active choice-detail" : "choice choice-detail"}
                    key={option.strategy}
                  >
                    <input
                      checked={queueStrategy === option.strategy}
                      name="practice-queue-strategy"
                      type="radio"
                      value={option.strategy}
                      onChange={() => setQueueStrategy(option.strategy)}
                    />
                    <div className="choice-body">
                      <strong>{option.label}</strong>
                      <span>{option.description}</span>
                    </div>
                  </label>
                ))}
              </div>
            </div>

            {queueStrategy === "note-drill" ? (
              <div className="control-block">
                <span className="control-label">强化音名</span>
                <div className="note-name-options">
                  {ANSWER_BUTTONS.map((button) => {
                    const checked = drillNoteNames.includes(button.noteName);
                    return (
                      <label className={checked ? "choice choice-active" : "choice"} key={button.noteName}>
                        <input
                          checked={checked}
                          type="checkbox"
                          onChange={(event) => toggleDrillNoteName(button.noteName, event.target.checked)}
                        />
                        <span>{button.noteName}</span>
                      </label>
                    );
                  })}
                </div>
              </div>
            ) : null}

            <div className="control-block">
              <span className="control-label">谱号变体</span>
              <label className={includeLedgerVariants ? "choice choice-active choice-detail" : "choice choice-detail"}>
                <input
                  checked={includeLedgerVariants}
                  type="checkbox"
                  onChange={(event) => setIncludeLedgerVariants(event.target.checked)}
                />
                <div className="choice-body">
                  <strong>加练双谱号写法</strong>
                  <span>E3-A4 同时练高音谱号和低音谱号写法</span>
                </div>
              </label>
            </div>

            <div className="control-block">
              <span className="control-label">声音</span>
              <label className={autoPlayTarget ? "choice choice-active choice-detail" : "choice choice-detail"}>
                <input
                  checked={autoPlayTarget}
                  type="checkbox"
                  onChange={(event) => setAutoPlayTarget(event.target.checked)}
                />
                <div className="choice-body">
                  <strong>自动播放目标音</strong>
                  <span>卡片出现时播放一次</span>
                </div>
              </label>
            </div>

            <div className="action-row">
              <button className="primary" disabled={setupDisabled} onClick={() => void startSession()}>
                <Play size={18} />
                开始
              </button>
              <button onClick={onOpenStats}>
                <BarChart3 size={18} />
                统计
              </button>
            </div>
          </div>
        </div>
      </section>
    );
  }

  if (phase === "summary" && summary) {
    return (
      <section className="practice-shell">
        <div className="panel summary-panel">
          <div className="panel-heading">
            <h1>本次结果</h1>
            <p>{summary.session.endReason === "manual-stop" ? "手动结束" : "已完成"}</p>
          </div>
          <div className="metric-grid">
            <div className="metric">
              <span>答对</span>
              <strong>{summary.reviews.filter(isCompletedReview).length}</strong>
            </div>
            <div className="metric">
              <span>错误</span>
              <strong>{summary.reviews.reduce((sum, review) => sum + review.wrongAnswers.length, 0)}</strong>
            </div>
            <div className="metric">
              <span>中位时长</span>
              <strong>{formatMs(percentile(sessionQualifiedTimes, 0.5))}</strong>
            </div>
            <div className="metric">
              <span>P90</span>
              <strong>{formatMs(percentile(sessionQualifiedTimes, 0.9))}</strong>
            </div>
          </div>
          <div className="note-list">
            {weakestNotes.map((note) => (
              <div className="note-row" key={note.targetNoteId}>
                <span>{formatTargetNoteLabel(getNoteById(note.targetNoteId))}</span>
                <span>{formatMs(note.medianMs)}</span>
                <span>{Math.round(note.errorRate * 100)}%</span>
                <span>{note.commonConfusion ? `常错 ${note.commonConfusion}` : "无混淆"}</span>
              </div>
            ))}
          </div>
          <div className="action-row">
            <button className="primary" onClick={() => void startSession()}>
              <RotateCcw size={18} />
              再来一次
            </button>
            <button onClick={() => setPhase("setup")}>
              <SlidersHorizontal size={18} />
              调整设置
            </button>
            <button onClick={onOpenStats}>
              <BarChart3 size={18} />
              查看统计
            </button>
          </div>
        </div>
      </section>
    );
  }

  return (
    <section className="practice-shell">
      <div className="practice-topline">
        <div className="progress-readout">
          {mode === "open-ended" ? (
            <span>完成 {completedCount}</span>
          ) : mode === "fixed-count" ? (
            <span>
              {completedCount}/{fixedCount}
            </span>
          ) : (
            <span>
              完成 {completedCount} · {formatDuration(remainingMs)}
            </span>
          )}
        </div>
        <div className="topline-actions">
          <button title="重播目标音 Space" onClick={() => void replayTarget()}>
            <Volume2 size={18} />
            重播
          </button>
          <button title={isPaused ? "继续 P" : "暂停 P"} onClick={togglePause}>
            {isPaused ? <Play size={18} /> : <Pause size={18} />}
            {isPaused ? "继续" : "暂停"}
          </button>
          <button title="结束 Esc" onClick={() => void completeSession("manual-stop", "manual-stop")}>
            <Square fill="currentColor" size={14} strokeWidth={0} />
            结束
          </button>
        </div>
      </div>

      <div className={promptDisplayMode === "staff-page" ? "prompt-stage staff-page-stage" : "prompt-stage"}>
        {promptDisplayMode === "staff-page" ? (
          <StaffPagePrompt
            notes={staffPageNotes}
            completedCount={staffPageCompletedCount}
            noteDuration={promptNoteDuration}
            wrongIndex={feedback?.type === "wrong" ? staffPageIndex : undefined}
          />
        ) : currentNote ? (
          <StaffPrompt note={currentNote} noteDuration={promptNoteDuration} wrong={feedback?.type === "wrong"} />
        ) : null}
      </div>

      <div className="answer-grid" aria-label="答案">
        {ANSWER_BUTTONS.map((button) => (
          <button
            className={[
              "answer-button",
              feedback?.type === "wrong" && feedback.noteName === button.noteName ? "wrong" : "",
              feedback?.type === "correct" && feedback.noteName === button.noteName ? "correct" : "",
            ]
              .filter(Boolean)
              .join(" ")}
            key={button.key}
            title={`${button.label} = ${button.noteName}`}
            onClick={() => void submitAnswer(button.noteName)}
          >
            {button.label}
          </button>
        ))}
      </div>
      <span className="sr-only" aria-live="polite">
        {tick} {wrongAnswerCount}
      </span>
      {isPaused ? (
        <button className="pause-overlay" onClick={resumePractice} type="button">
          <span>已暂停</span>
          <small>点击或按 P 继续</small>
        </button>
      ) : null}
    </section>
  );
}
