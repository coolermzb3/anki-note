import { describe, expect, it } from "vitest";
import {
  buildLatestSessionProgressBenchmark,
  buildLatestSessionProgressSeries,
  buildSessionProgressBenchmark,
  buildSessionProgressGroups,
  buildSessionProgressSeries,
  isComparablePracticeSession,
  isProgressChartEligible,
} from "./sessionProgress";
import { makeReview } from "./testFactories";
import type { PracticeSessionRecordV1 } from "./types";

const REVIEW_NOTE_IDS = ["C4", "D4", "E4", "F4", "G4"] as const;

function makeSession(
  overrides: Partial<PracticeSessionRecordV1> & { id: string; startedAt: string },
): PracticeSessionRecordV1 {
  const { id, startedAt, ...rest } = overrides;
  return {
    id,
    schemaVersion: 1,
    mode: "open-ended",
    enabledGroupIds: ["G3-F4"],
    queueStrategy: "adaptive",
    drillNoteNames: [],
    promptDisplayMode: "staff-page",
    includeLedgerVariants: true,
    startedAt,
    completedCount: 0,
    interruptedCount: 0,
    ...rest,
  };
}

function makeSessionReviews(
  sessionId: string,
  activeMsList: number[],
  answeredSeconds = activeMsList.map((_, index) => index + 1),
) {
  return activeMsList.map((activeMs, index) => {
    const answeredAt = `2026-07-04T12:00:${String(answeredSeconds[index]).padStart(2, "0")}.000+08:00`;
    return makeReview({
      id: `${sessionId}-${index}`,
      targetNoteId: REVIEW_NOTE_IDS[index % REVIEW_NOTE_IDS.length],
      sessionId,
      activeMs,
      answeredAt,
      endedAt: answeredAt,
    });
  });
}

describe("session progress", () => {
  it("keeps the eligible session ids owned by each exact comparison group", () => {
    const older = makeSession({
      fixedCount: 5,
      id: "older",
      mode: "fixed-count",
      startedAt: "2026-07-04T11:00:00.000+08:00",
    });
    const latest = makeSession({
      ...older,
      id: "latest",
      startedAt: "2026-07-04T12:00:00.000+08:00",
    });
    const short = makeSession({
      ...older,
      id: "short",
      startedAt: "2026-07-04T13:00:00.000+08:00",
    });

    const groups = buildSessionProgressGroups(
      [older, latest, short],
      [
        ...makeSessionReviews(older.id, [1000, 1000, 1000, 1000, 1000]),
        ...makeSessionReviews(latest.id, [900, 900, 900, 900, 900]),
        ...makeSessionReviews(short.id, [800, 800, 800, 800]),
      ],
    );

    expect(groups).toHaveLength(1);
    expect(groups[0].sessionIds).toEqual([latest.id, older.id]);
  });

  it("matches comparable practice sessions by the configured practice scope", () => {
    const reference = makeSession({
      id: "current",
      startedAt: "2026-07-04T12:00:00.000+08:00",
      mode: "fixed-duration",
      enabledGroupIds: ["G3-F4", "G4-F5"],
      fixedDurationSeconds: 60,
      queueStrategy: "note-drill",
      drillNoteNames: ["C", "D"],
      promptDisplayMode: "staff-page",
      includeLedgerVariants: true,
    });

    expect(
      isComparablePracticeSession(
        reference,
        makeSession({
          ...reference,
          id: "same-missing-display-snapshot",
          startedAt: "2026-07-04T11:00:00.000+08:00",
          enabledGroupIds: ["G4-F5", "G3-F4"],
          drillNoteNames: ["D", "C"],
          promptDisplayMode: undefined,
        }),
      ),
    ).toBe(false);
    expect(
      isComparablePracticeSession(
        { ...reference, includeLedgerVariants: false },
        makeSession({ ...reference, id: "unknown-ledger-snapshot", includeLedgerVariants: undefined }),
      ),
    ).toBe(false);
    expect(
      isComparablePracticeSession(
        { ...reference, includeLedgerVariants: false },
        makeSession({ ...reference, id: "observed-ledger-variant", includeLedgerVariants: undefined }),
      ),
    ).toBe(false);
    expect(
      isComparablePracticeSession(
        reference,
        makeSession({ ...reference, id: "different-ledger", includeLedgerVariants: false }),
      ),
    ).toBe(false);
    expect(
      isComparablePracticeSession(
        makeSession({
          ...reference,
          id: "full-note-drill",
          queueStrategy: "note-drill",
          drillNoteNames: ["C", "D", "E", "F", "G", "A", "B"],
        }),
        makeSession({ ...reference, id: "adaptive", queueStrategy: "adaptive", drillNoteNames: [] }),
      ),
    ).toBe(true);
    expect(
      isComparablePracticeSession(
        reference,
        makeSession({ ...reference, id: "different-display", promptDisplayMode: "single-note" }),
      ),
    ).toBe(false);
    expect(
      isComparablePracticeSession(
        reference,
        makeSession({ ...reference, id: "different-duration", fixedDurationSeconds: 120 }),
      ),
    ).toBe(true);
    expect(
      isComparablePracticeSession(
        reference,
        makeSession({
          ...reference,
          id: "fixed-count",
          mode: "fixed-count",
          fixedCount: 40,
          fixedDurationSeconds: undefined,
        }),
      ),
    ).toBe(true);
    expect(
      isComparablePracticeSession(
        reference,
        makeSession({ ...reference, id: "open-ended", mode: "open-ended", fixedDurationSeconds: undefined }),
      ),
    ).toBe(false);
  });

  it("requires enough statistical reviews and a finite mode for progress charts", () => {
    const current = makeSession({
      id: "current",
      startedAt: "2026-07-04T12:00:00.000+08:00",
      mode: "fixed-duration",
      fixedDurationSeconds: 60,
    });
    const shortReviews = makeSessionReviews("current", [1000, 1100, 1200, 1300]);
    const enoughReviews = makeSessionReviews("current", [1000, 1100, 1200, 1300, 1400]);

    expect(isProgressChartEligible(current, shortReviews)).toBe(false);
    expect(isProgressChartEligible(current, enoughReviews)).toBe(true);
    expect(isProgressChartEligible({ ...current, mode: "open-ended" }, enoughReviews)).toBe(false);
    expect(
      buildSessionProgressSeries({
        currentSession: current,
        currentReviews: shortReviews,
        sessions: [],
        reviews: [],
        historyLimit: 10,
        mode: "actual-order",
      }),
    ).toEqual([]);
  });

  it("builds actual-order progress by cumulating completed review active time in answer order", () => {
    const current = makeSession({
      id: "current",
      startedAt: "2026-07-04T12:00:00.000+08:00",
      mode: "fixed-duration",
      fixedDurationSeconds: 60,
      queueStrategy: "adaptive",
      promptDisplayMode: "staff-page",
      includeLedgerVariants: true,
    });
    const old = makeSession({
      ...current,
      id: "old",
      startedAt: "2026-07-04T11:00:00.000+08:00",
      mode: "fixed-count",
      fixedCount: 2,
      fixedDurationSeconds: undefined,
      promptDisplayMode: "staff-page",
      includeLedgerVariants: true,
    });
    const older = makeSession({
      ...current,
      id: "older",
      startedAt: "2026-07-04T10:00:00.000+08:00",
    });
    const different = makeSession({
      ...current,
      id: "different",
      startedAt: "2026-07-04T11:30:00.000+08:00",
      promptDisplayMode: "single-note",
    });

    const series = buildSessionProgressSeries({
      currentSession: current,
      currentReviews: makeSessionReviews("current", [1300, 1000, 700, 900, 1100], [2, 1, 3, 4, 5]),
      sessions: [older, old, different],
      reviews: [
        ...makeSessionReviews("older", [900, 800, 700, 600, 500]),
        ...makeSessionReviews("old", [1200, 1300, 700, 900, 1000]),
        ...makeSessionReviews("different", [800, 900, 1000, 1100, 1200]),
      ],
      historyLimit: 1,
      mode: "actual-order",
    });

    expect(series.map((line) => line.sessionId)).toEqual(["old", "current"]);
    expect(series[0].points).toEqual([
      { elapsedMs: 0, completedReviews: 0 },
      { elapsedMs: 1200, completedReviews: 1 },
      { elapsedMs: 2500, completedReviews: 2 },
      { elapsedMs: 3200, completedReviews: 3 },
      { elapsedMs: 4100, completedReviews: 4 },
      { elapsedMs: 5100, completedReviews: 5 },
    ]);
    expect(series[1].points).toEqual([
      { elapsedMs: 0, completedReviews: 0 },
      { elapsedMs: 1000, completedReviews: 1 },
      { elapsedMs: 2300, completedReviews: 2 },
      { elapsedMs: 3000, completedReviews: 3 },
      { elapsedMs: 3900, completedReviews: 4 },
      { elapsedMs: 5000, completedReviews: 5 },
    ]);
  });

  it("builds sorted duration-cumsum progress from per-review recognition times", () => {
    const current = makeSession({
      id: "current",
      startedAt: "2026-07-04T12:00:00.000+08:00",
      mode: "fixed-duration",
      fixedDurationSeconds: 60,
      queueStrategy: "adaptive",
      promptDisplayMode: "staff-page",
      includeLedgerVariants: true,
    });

    const series = buildSessionProgressSeries({
      currentSession: current,
      currentReviews: makeSessionReviews("current", [2300, 700, 1600, 900, 1100]),
      sessions: [],
      reviews: [],
      historyLimit: 10,
      mode: "duration-cumsum",
    });

    expect(series).toHaveLength(1);
    expect(series[0].points).toEqual([
      { elapsedMs: 0, completedReviews: 0 },
      { elapsedMs: 700, completedReviews: 1 },
      { elapsedMs: 1600, completedReviews: 2 },
      { elapsedMs: 2700, completedReviews: 3 },
      { elapsedMs: 4300, completedReviews: 4 },
      { elapsedMs: 6600, completedReviews: 5 },
    ]);
  });

  it("uses the current fixed-duration setting as the progress comparison window", () => {
    const current = makeSession({
      id: "current",
      startedAt: "2026-07-04T12:00:00.000+08:00",
      mode: "fixed-duration",
      fixedDurationSeconds: 6,
      queueStrategy: "adaptive",
      promptDisplayMode: "staff-page",
      includeLedgerVariants: true,
    });
    const old = makeSession({
      ...current,
      id: "old",
      startedAt: "2026-07-04T11:00:00.000+08:00",
      fixedDurationSeconds: 10,
    });

    const series = buildSessionProgressSeries({
      currentSession: current,
      currentReviews: makeSessionReviews("current", [1000, 1000, 1000, 1000, 1000]),
      sessions: [old],
      reviews: makeSessionReviews("old", [1000, 1000, 1000, 1000, 1000, 1000, 1000]),
      historyLimit: 10,
      mode: "actual-order",
    });

    expect(series.find((line) => line.isCurrent)?.durationMs).toBe(6000);
    expect(series.find((line) => !line.isCurrent)?.points).toEqual([
      { elapsedMs: 0, completedReviews: 0 },
      { elapsedMs: 1000, completedReviews: 1 },
      { elapsedMs: 2000, completedReviews: 2 },
      { elapsedMs: 3000, completedReviews: 3 },
      { elapsedMs: 4000, completedReviews: 4 },
      { elapsedMs: 5000, completedReviews: 5 },
      { elapsedMs: 6000, completedReviews: 6 },
    ]);
  });

  it("builds fixed-duration count and fixed-count time benchmarks", () => {
    const currentDuration = makeSession({
      endReason: "completed-duration",
      id: "current-duration",
      startedAt: "2026-07-04T12:00:00.000+08:00",
      mode: "fixed-duration",
      fixedDurationSeconds: 6,
      queueStrategy: "adaptive",
    });
    const oldDuration = makeSession({
      ...currentDuration,
      id: "old-duration",
      startedAt: "2026-07-04T11:00:00.000+08:00",
    });
    expect(
      buildSessionProgressBenchmark({
        currentSession: currentDuration,
        currentReviews: makeSessionReviews("current-duration", [1000, 1000, 1000, 1000, 1000]),
        sessions: [oldDuration],
        reviews: makeSessionReviews("old-duration", [1000, 1000, 1000, 1000, 1000, 1000, 1000]),
      }),
    ).toEqual({ metric: "completed-count", currentValue: 5, bestValue: 6, isNewBest: false });

    const currentCount = makeSession({
      ...currentDuration,
      endReason: "completed-count",
      id: "current-count",
      startedAt: "2026-07-04T14:00:00.000+08:00",
      mode: "fixed-count",
      fixedCount: 5,
      fixedDurationSeconds: undefined,
    });
    const oldCount = makeSession({
      ...currentCount,
      id: "old-count",
      startedAt: "2026-07-04T13:00:00.000+08:00",
    });
    expect(
      buildSessionProgressBenchmark({
        currentSession: currentCount,
        currentReviews: makeSessionReviews("current-count", [1000, 1000, 1000, 1000, 1000]),
        sessions: [oldCount],
        reviews: makeSessionReviews("old-count", [1100, 1100, 1100, 1100, 1100]),
      }),
    ).toEqual({ metric: "elapsed-ms", currentValue: 5000, bestValue: 5000, isNewBest: true });
  });

  it("merges finite modes for records when the source data covers the current metric", () => {
    const current = makeSession({
      fixedCount: 5,
      id: "current-count",
      mode: "fixed-count",
      startedAt: "2026-07-04T14:00:00.000+08:00",
    });
    const oldDuration = makeSession({
      activePracticeMs: 6000,
      fixedDurationSeconds: 6,
      id: "old-duration",
      mode: "fixed-duration",
      startedAt: "2026-07-04T13:00:00.000+08:00",
    });

    expect(
      buildSessionProgressBenchmark({
        currentSession: current,
        currentReviews: makeSessionReviews(current.id, [1000, 1000, 1000, 1000, 1000]),
        sessions: [oldDuration],
        reviews: makeSessionReviews(oldDuration.id, [500, 500, 500, 500, 500]),
      }),
    ).toEqual({ metric: "elapsed-ms", currentValue: 5000, bestValue: 2500, isNewBest: false });
  });

  it("excludes a finite session that ends before the current duration metric", () => {
    const current = makeSession({
      activePracticeMs: 6000,
      fixedDurationSeconds: 6,
      id: "current-duration",
      mode: "fixed-duration",
      startedAt: "2026-07-04T14:00:00.000+08:00",
    });
    const oldCount = makeSession({
      activePracticeMs: 5000,
      fixedCount: 10,
      id: "old-count",
      mode: "fixed-count",
      startedAt: "2026-07-04T13:00:00.000+08:00",
    });

    expect(
      buildSessionProgressBenchmark({
        currentSession: current,
        currentReviews: makeSessionReviews(current.id, [1000, 1000, 1000, 1000, 1000, 1000]),
        sessions: [oldCount],
        reviews: makeSessionReviews(oldCount.id, [500, 500, 500, 500, 500, 500, 500, 500, 500, 500]),
      }),
    ).toEqual({ metric: "completed-count", currentValue: 6, bestValue: 6, isNewBest: false });
  });

  it("does not infer full duration coverage for a legacy session stopped early", () => {
    const current = makeSession({
      activePracticeMs: 6000,
      endReason: "completed-duration",
      fixedDurationSeconds: 6,
      id: "current-duration",
      mode: "fixed-duration",
      startedAt: "2026-07-04T14:00:00.000+08:00",
    });
    const stoppedEarly = makeSession({
      endReason: "manual-stop",
      fixedDurationSeconds: 10,
      id: "stopped-early",
      mode: "fixed-duration",
      startedAt: "2026-07-04T13:00:00.000+08:00",
    });

    expect(
      buildSessionProgressBenchmark({
        currentSession: current,
        currentReviews: makeSessionReviews(current.id, [1000, 1000, 1000, 1000, 1000]),
        sessions: [stoppedEarly],
        reviews: makeSessionReviews(stoppedEarly.id, [800, 800, 800, 800, 800, 800]),
      }),
    ).toEqual({ metric: "completed-count", currentValue: 5, bestValue: 5, isNewBest: false });
  });

  it("excludes short historical sessions from progress benchmarks", () => {
    const current = makeSession({
      endReason: "completed-duration",
      id: "current",
      startedAt: "2026-07-04T12:00:00.000+08:00",
      mode: "fixed-duration",
      fixedDurationSeconds: 6,
      queueStrategy: "adaptive",
    });
    const short = makeSession({
      ...current,
      endReason: "manual-stop",
      id: "short",
      startedAt: "2026-07-04T11:00:00.000+08:00",
    });

    expect(
      buildSessionProgressBenchmark({
        currentSession: current,
        currentReviews: makeSessionReviews("current", [1000, 1000, 1000, 1000, 1000]),
        sessions: [short],
        reviews: makeSessionReviews("short", [1000, 1000, 1000, 1000]),
      }),
    ).toEqual({ metric: "completed-count", currentValue: 5, bestValue: 5, isNewBest: false });
  });

  it("uses the current fixed-count actual duration as the progress comparison window", () => {
    const current = makeSession({
      id: "current",
      startedAt: "2026-07-04T12:00:00.000+08:00",
      mode: "fixed-count",
      fixedCount: 5,
      queueStrategy: "adaptive",
      promptDisplayMode: "staff-page",
      includeLedgerVariants: true,
    });
    const old = makeSession({
      ...current,
      id: "old",
      startedAt: "2026-07-04T11:00:00.000+08:00",
    });

    const series = buildSessionProgressSeries({
      currentSession: current,
      currentReviews: makeSessionReviews("current", [1000, 1000, 1000, 1000, 1000]),
      sessions: [old],
      reviews: makeSessionReviews("old", [2000, 2000, 2000, 2000, 2000]),
      historyLimit: 10,
      mode: "actual-order",
    });

    expect(series.find((line) => line.isCurrent)?.durationMs).toBe(5000);
    expect(series.find((line) => !line.isCurrent)?.points).toEqual([
      { elapsedMs: 0, completedReviews: 0 },
      { elapsedMs: 2000, completedReviews: 1 },
      { elapsedMs: 4000, completedReviews: 2 },
    ]);
  });

  it("truncates historical raw reviews before building sorted duration-cumsum progress", () => {
    const current = makeSession({
      id: "current",
      startedAt: "2026-07-04T12:00:00.000+08:00",
      mode: "fixed-count",
      fixedCount: 5,
      queueStrategy: "adaptive",
      promptDisplayMode: "staff-page",
      includeLedgerVariants: true,
    });
    const old = makeSession({
      ...current,
      id: "old",
      startedAt: "2026-07-04T11:00:00.000+08:00",
    });

    const series = buildSessionProgressSeries({
      currentSession: current,
      currentReviews: makeSessionReviews("current", [1000, 1000, 1000, 1000, 1000]),
      sessions: [old],
      reviews: makeSessionReviews("old", [3000, 1000, 2000, 500, 500]),
      historyLimit: 10,
      mode: "duration-cumsum",
    });

    expect(series.find((line) => !line.isCurrent)?.points).toEqual([
      { elapsedMs: 0, completedReviews: 0 },
      { elapsedMs: 1000, completedReviews: 1 },
      { elapsedMs: 4000, completedReviews: 2 },
    ]);
  });

  it("uses the latest eligible session as the progress baseline", () => {
    const older = makeSession({
      endReason: "completed-duration",
      id: "older",
      startedAt: "2026-07-04T10:00:00.000+08:00",
      mode: "fixed-duration",
      fixedDurationSeconds: 60,
      queueStrategy: "adaptive",
      promptDisplayMode: "staff-page",
      includeLedgerVariants: true,
    });
    const olderDifferentRange = makeSession({
      ...older,
      id: "older-different-range",
      startedAt: "2026-07-04T10:30:00.000+08:00",
      enabledGroupIds: ["G4-F5"],
    });
    const latestOpenEnded = makeSession({
      ...older,
      endReason: "manual-stop",
      id: "latest-open-ended",
      startedAt: "2026-07-04T11:30:00.000+08:00",
      mode: "open-ended",
    });
    const latestShort = makeSession({
      ...older,
      endReason: "manual-stop",
      id: "latest-short",
      startedAt: "2026-07-04T11:45:00.000+08:00",
      queueStrategy: "melody",
    });
    const latest = makeSession({
      ...older,
      id: "latest",
      startedAt: "2026-07-04T11:00:00.000+08:00",
    });

    const series = buildLatestSessionProgressSeries({
      sessions: [older, olderDifferentRange, latestOpenEnded, latestShort, latest],
      reviews: [
        ...makeSessionReviews("older", [1100, 1200, 1300, 1400, 1500]),
        ...makeSessionReviews("older-different-range", [700, 800, 900, 1000, 1100]),
        ...makeSessionReviews("latest-open-ended", [500, 600, 700, 800, 900]),
        ...makeSessionReviews("latest-short", [700, 800, 900, 1000]),
        ...makeSessionReviews("latest", [900, 1000, 1100, 1200, 1300]),
      ],
      historyLimit: 10,
      mode: "actual-order",
    });

    expect(series.map((line) => line.sessionId)).toEqual(["older", "latest"]);
    expect(
      buildLatestSessionProgressBenchmark({
        sessions: [older, olderDifferentRange, latestOpenEnded, latestShort, latest],
        reviews: [
          ...makeSessionReviews("older", [1100, 1200, 1300, 1400, 1500]),
          ...makeSessionReviews("older-different-range", [700, 800, 900, 1000, 1100]),
          ...makeSessionReviews("latest-open-ended", [500, 600, 700, 800, 900]),
          ...makeSessionReviews("latest-short", [700, 800, 900, 1000]),
          ...makeSessionReviews("latest", [900, 1000, 1100, 1200, 1300]),
        ],
      }),
    ).toEqual({ metric: "completed-count", currentValue: 5, bestValue: 5, isNewBest: false });
  });
});
