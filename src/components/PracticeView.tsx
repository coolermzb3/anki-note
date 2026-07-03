import { BarChart3, Play, RotateCcw, SlidersHorizontal, Square, Volume2 } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { playPianoNote, playTargetNote, unlockAudio } from "../audio/piano";
import { db, saveReview } from "../data/db";
import { writeBackupNow } from "../data/backup";
import { ANSWER_BUTTONS, getNotesForGroups, PRACTICE_GROUPS_LOW_TO_HIGH } from "../domain/notes";
import { selectNextNote } from "../domain/scheduler";
import { buildNoteStats, formatMs, percentile } from "../domain/stats";
import type {
  AppSettings,
  FocusLoss,
  InterruptReason,
  NoteName,
  PracticeGroupId,
  PracticeMode,
  PracticeSessionRecord,
  ReviewRecord,
  TargetNote,
  WrongAnswer,
} from "../domain/types";
import { StaffPrompt } from "./StaffPrompt";

interface PracticeViewProps {
  settings: AppSettings;
  reviews: ReviewRecord[];
  onSettingsSaved: (settings: AppSettings) => void;
  onDataChanged: () => Promise<void>;
  onOpenStats: () => void;
  onRunningChange: (running: boolean) => void;
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

function newSessionId(): string {
  return crypto.randomUUID();
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

export function PracticeView({
  settings,
  reviews,
  onSettingsSaved,
  onDataChanged,
  onOpenStats,
  onRunningChange,
}: PracticeViewProps): JSX.Element {
  const [phase, setPhase] = useState<Phase>("setup");
  const [mode, setMode] = useState<PracticeMode>(settings.defaultMode);
  const [enabledGroupIds, setEnabledGroupIds] = useState<PracticeGroupId[]>(settings.enabledGroupIds);
  const [fixedCount, setFixedCount] = useState(settings.fixedCount);
  const [fixedDurationSeconds, setFixedDurationSeconds] = useState(settings.fixedDurationSeconds);
  const [autoPlayTarget, setAutoPlayTarget] = useState(settings.autoPlayTarget);
  const [focusedTraining, setFocusedTraining] = useState(settings.focusedTraining ?? false);
  const [session, setSession] = useState<PracticeSessionRecord | null>(null);
  const [currentNote, setCurrentNote] = useState<TargetNote | null>(null);
  const [completedCount, setCompletedCount] = useState(0);
  const [wrongAnswerCount, setWrongAnswerCount] = useState(0);
  const [feedback, setFeedback] = useState<{ type: "wrong" | "correct"; noteName?: NoteName } | null>(null);
  const [tick, setTick] = useState(0);
  const [summary, setSummary] = useState<SessionSummary | null>(null);

  const promptRef = useRef<PromptRuntime | null>(null);
  const sessionRef = useRef<PracticeSessionRecord | null>(null);
  const sessionReviewsRef = useRef<ReviewRecord[]>([]);
  const lastTargetNoteIdRef = useRef<TargetNote["id"] | undefined>();
  const endingRef = useRef(false);
  const sessionActiveBaseMsRef = useRef(0);
  const sessionActiveStartedAtRef = useRef<number | null>(null);
  const lastBackupCompletedRef = useRef(0);
  const lastBackupAtRef = useRef<number>(performance.now());

  useEffect(() => {
    onRunningChange(phase === "running");
    return () => onRunningChange(false);
  }, [onRunningChange, phase]);

  useEffect(() => {
    if (phase === "setup") {
      setMode(settings.defaultMode);
      setEnabledGroupIds(settings.enabledGroupIds);
      setFixedCount(settings.fixedCount);
      setFixedDurationSeconds(settings.fixedDurationSeconds);
      setAutoPlayTarget(settings.autoPlayTarget);
      setFocusedTraining(settings.focusedTraining ?? false);
    }
  }, [phase, settings]);

  const enabledNotes = useMemo(() => getNotesForGroups(enabledGroupIds), [enabledGroupIds]);

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

  const handleFocusLost = useCallback((): void => {
    const prompt = promptRef.current;
    if (prompt) {
      markInterrupted("focus-lost");
      const lastLoss = prompt.focusLosses[prompt.focusLosses.length - 1];
      if (!lastLoss || lastLoss.regainedFocusAt) {
        prompt.focusLosses.push({ lostFocusAt: new Date().toISOString() });
      }
    }
    pauseActiveTimers();
  }, [markInterrupted, pauseActiveTimers]);

  const persistConfig = useCallback(async (): Promise<AppSettings> => {
    const nextSettings: AppSettings = {
      ...settings,
      enabledGroupIds,
      defaultMode: mode,
      fixedCount,
      fixedDurationSeconds,
      autoPlayTarget,
      focusedTraining,
    };
    await db.settings.put(nextSettings);
    onSettingsSaved(nextSettings);
    return nextSettings;
  }, [
    autoPlayTarget,
    enabledGroupIds,
    fixedCount,
    fixedDurationSeconds,
    focusedTraining,
    mode,
    onSettingsSaved,
    settings,
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

  const selectAndStartNext = useCallback(
    (extraReviews: ReviewRecord[] = []): void => {
      const nextReviews = [...reviews, ...sessionReviewsRef.current, ...extraReviews];
      const note = selectNextNote({
        notes: enabledNotes,
        reviews: nextReviews,
        focusedTraining,
        lastTargetNoteId: lastTargetNoteIdRef.current,
      });
      startPrompt(note);
    },
    [enabledNotes, focusedTraining, reviews, startPrompt],
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
      const review: ReviewRecord = {
        id: crypto.randomUUID(),
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
      };
      promptRef.current = null;
      lastTargetNoteIdRef.current = prompt.note.id;
      await saveReview(review);
      sessionReviewsRef.current = [...sessionReviewsRef.current, review];
      return review;
    },
    [getPromptActiveMs, pauseActiveTimers],
  );

  const completeSession = useCallback(
    async (endReason: PracticeSessionRecord["endReason"], unfinishedReason?: InterruptReason): Promise<void> => {
      if (endingRef.current || !sessionRef.current) {
        return;
      }
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
        completedCount: finalReviews.filter((review) => review.answeredCorrectly).length,
        interruptedCount: finalReviews.filter((review) => review.interrupted).length,
      };
      await db.practiceSessions.put(finalSession);
      sessionRef.current = finalSession;
      setSession(finalSession);
      setSummary({ session: finalSession, reviews: finalReviews });
      setCurrentNote(null);
      setPhase("summary");
      await writeBackupNow().catch(() => undefined);
      await onDataChanged();
      endingRef.current = false;
    },
    [finishCurrentReview, onDataChanged, pauseActiveTimers],
  );

  const startSession = useCallback(async (): Promise<void> => {
    if (enabledNotes.length === 0) {
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
      focusedTraining,
      startedAt,
      completedCount: 0,
      interruptedCount: 0,
    };
    await db.practiceSessions.put(nextSession);
    sessionRef.current = nextSession;
    sessionReviewsRef.current = [];
    lastTargetNoteIdRef.current = undefined;
    endingRef.current = false;
    lastBackupAtRef.current = performance.now();
    lastBackupCompletedRef.current = 0;
    sessionActiveBaseMsRef.current = 0;
    sessionActiveStartedAtRef.current = performance.now();
    setSession(nextSession);
    setCompletedCount(0);
    setWrongAnswerCount(0);
    setSummary(null);
    setPhase("running");
    const nextEnabledNotes = getNotesForGroups(nextSettings.enabledGroupIds);
    const firstNote = selectNextNote({
      notes: nextEnabledNotes,
      reviews,
      focusedTraining: nextSettings.focusedTraining,
    });
    startPrompt(firstNote);
  }, [
    enabledGroupIds,
    enabledNotes.length,
    fixedCount,
    fixedDurationSeconds,
    focusedTraining,
    mode,
    persistConfig,
    reviews,
    startPrompt,
  ]);

  const replayTarget = useCallback(async (): Promise<void> => {
    const prompt = promptRef.current;
    if (!prompt) {
      return;
    }
    prompt.lastInputAt = performance.now();
    prompt.replayCount += 1;
    await playTargetNote(prompt.note).catch(() => undefined);
  }, []);

  const submitAnswer = useCallback(
    async (noteName: NoteName): Promise<void> => {
      const prompt = promptRef.current;
      if (!prompt || feedback?.type === "correct") {
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
      await maybeBackupDuringOpenEnded(nextCompletedCount);

      window.setTimeout(() => {
        resumeActiveTimers();
        if (mode === "fixed-count" && nextCompletedCount >= fixedCount) {
          void completeSession("completed-count");
          return;
        }
        selectAndStartNext([review]);
      }, settings.correctDelayMs);
    },
    [
      completeSession,
      completedCount,
      feedback?.type,
      finishCurrentReview,
      fixedCount,
      getPromptActiveMs,
      maybeBackupDuringOpenEnded,
      mode,
      resumeActiveTimers,
      selectAndStartNext,
      settings.correctDelayMs,
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
  }, [phase, replayTarget, submitAnswer]);

  useEffect(() => {
    if (phase !== "running") {
      return;
    }

    function onVisibilityOrBlur(): void {
      if (document.visibilityState === "hidden" || !document.hasFocus()) {
        handleFocusLost();
      }
    }

    function onFocus(): void {
      if (document.visibilityState === "visible" && document.hasFocus()) {
        resumeActiveTimers();
      }
    }

    window.addEventListener("blur", onVisibilityOrBlur);
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onVisibilityOrBlur);
    document.addEventListener("visibilitychange", onFocus);
    return () => {
      window.removeEventListener("blur", onVisibilityOrBlur);
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onVisibilityOrBlur);
      document.removeEventListener("visibilitychange", onFocus);
    };
  }, [handleFocusLost, phase, resumeActiveTimers]);

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

  const setupDisabled = enabledNotes.length === 0;
  const remainingMs = mode === "fixed-duration" ? fixedDurationSeconds * 1000 - getSessionActiveMs() : 0;
  const sessionQualifiedTimes = (summary?.reviews ?? [])
    .filter((review) => review.answeredCorrectly && !review.interrupted)
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
                {PRACTICE_GROUPS_LOW_TO_HIGH.map((group) => {
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

            {mode === "fixed-count" ? (
              <div className="control-block">
                <span className="control-label">题数</span>
                <div className="number-row">
                  {[10, 20, 35].map((count) => (
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
              <label className={focusedTraining ? "choice choice-active" : "choice"}>
                <input
                  checked={focusedTraining}
                  type="checkbox"
                  onChange={(event) => setFocusedTraining(event.target.checked)}
                />
                <span>加强专项训练</span>
              </label>
            </div>

            <div className="setting-row setup-setting-row">
              <div>
                <strong>自动播放目标音</strong>
                <span>卡片出现时播放一次</span>
              </div>
              <label className="toggle">
                <input
                  checked={autoPlayTarget}
                  type="checkbox"
                  onChange={(event) => setAutoPlayTarget(event.target.checked)}
                />
                <span />
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
              <strong>{summary.reviews.filter((review) => review.answeredCorrectly).length}</strong>
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
                <span>{note.targetNoteId}</span>
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
        <button title="结束" onClick={() => void completeSession("manual-stop", "manual-stop")}>
          <Square size={18} />
          结束
        </button>
      </div>

      <div className="prompt-stage">
        {currentNote ? <StaffPrompt note={currentNote} /> : null}
        <button className="replay-button" title="重播目标音 Space" onClick={() => void replayTarget()}>
          <Volume2 size={20} />
        </button>
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
    </section>
  );
}
