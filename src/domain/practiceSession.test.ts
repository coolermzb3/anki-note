import { describe, expect, it } from "vitest";
import { makeReview } from "./testFactories";
import {
  isSingleNoteNameDrill,
  shouldIgnoreReviewForSession,
  shouldKeepPracticeSession,
} from "./practiceSession";
import type { PracticeSessionRecord } from "./types";

function makeSession(overrides: Partial<PracticeSessionRecord> = {}): PracticeSessionRecord {
  return {
    id: overrides.id ?? "session-1",
    schemaVersion: 1,
    mode: overrides.mode ?? "open-ended",
    enabledGroupIds: overrides.enabledGroupIds ?? ["G3-F4"],
    fixedCount: overrides.fixedCount,
    fixedDurationSeconds: overrides.fixedDurationSeconds,
    queueStrategy: overrides.queueStrategy ?? "adaptive",
    drillNoteNames: overrides.drillNoteNames,
    focusedTraining: overrides.focusedTraining,
    startedAt: overrides.startedAt ?? "2026-07-04T12:00:00.000+08:00",
    endedAt: overrides.endedAt,
    endReason: overrides.endReason,
    completedCount: overrides.completedCount ?? 0,
    interruptedCount: overrides.interruptedCount ?? 0,
  };
}

describe("practice session rules", () => {
  it("treats a single selected note-name drill as ignored review history", () => {
    const session = makeSession({ queueStrategy: "note-drill", drillNoteNames: ["C"] });

    expect(isSingleNoteNameDrill(session)).toBe(true);
    expect(shouldIgnoreReviewForSession(session)).toBe(true);
    expect(shouldKeepPracticeSession(session, [makeReview({ targetNoteId: "C4", ignored: true })])).toBe(true);
  });

  it("drops a single selected note-name drill session with no completed prompt", () => {
    const session = makeSession({ queueStrategy: "note-drill", drillNoteNames: ["C"] });
    const interrupted = makeReview({
      targetNoteId: "C4",
      answeredAt: undefined,
      answeredCorrectly: false,
      ignored: true,
      interrupted: true,
      interruptReason: "manual-stop",
    });

    expect(shouldKeepPracticeSession(session, [interrupted])).toBe(false);
  });

  it("records multi selected note-name drill prompts as ordinary reviews", () => {
    const session = makeSession({ queueStrategy: "note-drill", drillNoteNames: ["C", "D"] });

    expect(isSingleNoteNameDrill(session)).toBe(false);
    expect(shouldIgnoreReviewForSession(session)).toBe(false);
    expect(shouldKeepPracticeSession(session, [makeReview({ targetNoteId: "C4" })])).toBe(true);
  });
});
