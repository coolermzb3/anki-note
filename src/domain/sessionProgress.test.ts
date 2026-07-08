import { describe, expect, it } from "vitest";
import {
  buildLatestSessionProgressSeries,
  buildSessionProgressSeries,
  isComparablePracticeSession,
} from "./sessionProgress";
import { makeReview } from "./testFactories";
import type { PracticeSessionRecord } from "./types";

function makeSession(
  overrides: Partial<PracticeSessionRecord> & { id: string; startedAt: string },
): PracticeSessionRecord {
  return {
    id: overrides.id,
    schemaVersion: 1,
    mode: overrides.mode ?? "open-ended",
    enabledGroupIds: overrides.enabledGroupIds ?? ["G3-F4"],
    fixedCount: overrides.fixedCount,
    fixedDurationSeconds: overrides.fixedDurationSeconds,
    queueStrategy: overrides.queueStrategy,
    drillNoteNames: overrides.drillNoteNames,
    promptDisplayMode: overrides.promptDisplayMode,
    includeLedgerVariants: overrides.includeLedgerVariants,
    startedAt: overrides.startedAt,
    endedAt: overrides.endedAt,
    endReason: overrides.endReason,
    completedCount: overrides.completedCount ?? 0,
    interruptedCount: overrides.interruptedCount ?? 0,
  };
}

describe("session progress", () => {
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
    ).toBe(true);
    expect(
      isComparablePracticeSession(
        { ...reference, includeLedgerVariants: false },
        makeSession({ ...reference, id: "unknown-ledger-snapshot", includeLedgerVariants: undefined }),
        [makeReview({ targetNoteId: "C4", sessionId: "unknown-ledger-snapshot" })],
      ),
    ).toBe(true);
    expect(
      isComparablePracticeSession(
        { ...reference, includeLedgerVariants: false },
        makeSession({ ...reference, id: "observed-ledger-variant", includeLedgerVariants: undefined }),
        [makeReview({ targetNoteId: "E3-treble", sessionId: "observed-ledger-variant" })],
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
      promptDisplayMode: undefined,
      includeLedgerVariants: undefined,
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
      currentReviews: [
        makeReview({
          targetNoteId: "C4",
          sessionId: "current",
          activeMs: 1300,
          answeredAt: "2026-07-04T12:00:02.300+08:00",
        }),
        makeReview({
          targetNoteId: "D4",
          sessionId: "current",
          activeMs: 1000,
          answeredAt: "2026-07-04T12:00:01.000+08:00",
        }),
      ],
      sessions: [older, old, different],
      reviews: [
        makeReview({
          targetNoteId: "C4",
          sessionId: "older",
          activeMs: 900,
          answeredAt: "2026-07-04T10:00:00.900+08:00",
        }),
        makeReview({
          targetNoteId: "C4",
          sessionId: "old",
          activeMs: 1200,
          answeredAt: "2026-07-04T11:00:01.200+08:00",
        }),
        makeReview({
          targetNoteId: "D4",
          sessionId: "old",
          activeMs: 1300,
          answeredAt: "2026-07-04T11:00:02.500+08:00",
        }),
        makeReview({
          targetNoteId: "C4",
          sessionId: "different",
          activeMs: 800,
          answeredAt: "2026-07-04T11:30:00.800+08:00",
        }),
      ],
      historyLimit: 1,
      mode: "actual-order",
    });

    expect(series.map((line) => line.sessionId)).toEqual(["old", "current"]);
    expect(series[0].points).toEqual([
      { elapsedMs: 0, completedReviews: 0 },
      { elapsedMs: 1200, completedReviews: 1 },
      { elapsedMs: 2500, completedReviews: 2 },
    ]);
    expect(series[1].points).toEqual([
      { elapsedMs: 0, completedReviews: 0 },
      { elapsedMs: 1000, completedReviews: 1 },
      { elapsedMs: 2300, completedReviews: 2 },
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
      currentReviews: [
        makeReview({ targetNoteId: "C4", sessionId: "current", activeMs: 2300 }),
        makeReview({ targetNoteId: "D4", sessionId: "current", activeMs: 700 }),
      ],
      sessions: [],
      reviews: [],
      historyLimit: 10,
      mode: "duration-cumsum",
    });

    expect(series).toHaveLength(1);
    expect(series[0].points).toEqual([
      { elapsedMs: 0, completedReviews: 0 },
      { elapsedMs: 700, completedReviews: 1 },
      { elapsedMs: 3000, completedReviews: 2 },
    ]);
  });

  it("selects the latest plottable session in the current global practice range", () => {
    const older = makeSession({
      id: "older",
      startedAt: "2026-07-04T10:00:00.000+08:00",
      mode: "fixed-duration",
      fixedDurationSeconds: 60,
      queueStrategy: "adaptive",
      promptDisplayMode: "staff-page",
      includeLedgerVariants: true,
    });
    const latestDifferentRange = makeSession({
      ...older,
      id: "latest-different-range",
      startedAt: "2026-07-04T12:00:00.000+08:00",
      enabledGroupIds: ["G4-F5"],
    });
    const latestOpenEnded = makeSession({
      ...older,
      id: "latest-open-ended",
      startedAt: "2026-07-04T11:30:00.000+08:00",
      mode: "open-ended",
    });
    const latest = makeSession({
      ...older,
      id: "latest",
      startedAt: "2026-07-04T11:00:00.000+08:00",
    });

    const series = buildLatestSessionProgressSeries({
      settings: { enabledGroupIds: ["G3-F4"], includeLedgerVariants: true },
      sessions: [older, latestDifferentRange, latestOpenEnded, latest],
      reviews: [
        makeReview({ targetNoteId: "C4", sessionId: "older", activeMs: 1100 }),
        makeReview({ targetNoteId: "D4", sessionId: "older", activeMs: 1200 }),
        makeReview({ targetNoteId: "G4", sessionId: "latest-different-range", activeMs: 700 }),
        makeReview({ targetNoteId: "A4", sessionId: "latest-different-range", activeMs: 800 }),
        makeReview({ targetNoteId: "C4", sessionId: "latest-open-ended", activeMs: 500 }),
        makeReview({ targetNoteId: "D4", sessionId: "latest-open-ended", activeMs: 600 }),
        makeReview({ targetNoteId: "C4", sessionId: "latest", activeMs: 900 }),
        makeReview({ targetNoteId: "D4", sessionId: "latest", activeMs: 1000 }),
      ],
      historyLimit: 10,
      mode: "actual-order",
    });

    expect(series.map((line) => line.sessionId)).toEqual(["older", "latest"]);
  });
});
