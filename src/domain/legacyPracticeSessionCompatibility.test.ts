import { describe, expect, it } from "vitest";
import { getPracticeSessionComparisonSnapshot } from "./legacyPracticeSessionCompatibility";
import type { PracticeSessionRecordV2, PracticeSessionRecordV3 } from "./types";

const v2Session: PracticeSessionRecordV2 = {
  completedCount: 5,
  drillNoteNames: [],
  effectiveQueueAlgorithm: "adaptive-v1",
  enabledGroupIds: ["G3-F4"],
  id: "v2",
  includeInterStaffLedgerSpellings: false,
  interruptedCount: 0,
  mode: "fixed-count",
  fixedCount: 5,
  promptDisplayMode: "staff-page",
  queueStrategy: "adaptive",
  schemaVersion: 2,
  staffNotationMode: "grand",
  startedAt: "2026-07-01T10:00:00.000Z",
  targetNoteSetKey: "target-set",
};

const v3Session: PracticeSessionRecordV3 = {
  ...v2Session,
  id: "v3",
  promptNoteDuration: "sixteenth",
  schemaVersion: 3,
  startSnapshot: {
    environment: { prefersReducedMotion: false },
    interactionConfig: {
      answerKeyboardScale: 1,
      correctDelayMs: 400,
      inactivityThresholdSeconds: 30,
      pianoVolume: 0.8,
    },
    practiceConfig: {
      drillNoteNames: [],
      effectiveQueueAlgorithm: "adaptive-v1",
      enabledGroupIds: ["G3-F4"],
      fixedCount: 5,
      includeInterStaffLedgerSpellings: false,
      mode: "fixed-count",
      queueStrategy: "adaptive",
      staffNotationMode: "grand",
      targetNoteSetKey: "target-set",
    },
    presentationConfig: {
      autoPlayTarget: false,
      promptDisplayMode: "staff-page",
      promptNoteDuration: "sixteenth",
      smoothStaffPageScroll: true,
      startPausedReading: false,
    },
  },
};

describe("legacy practice session compatibility", () => {
  it("treats V1/V2 duration as quarter and reads the V3 snapshot duration", () => {
    expect(getPracticeSessionComparisonSnapshot(v2Session)?.promptNoteDuration).toBe("quarter");
    expect(getPracticeSessionComparisonSnapshot(v3Session)?.promptNoteDuration).toBe("sixteenth");
  });
});
