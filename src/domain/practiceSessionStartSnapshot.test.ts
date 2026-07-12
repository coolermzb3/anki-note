import { describe, expect, it } from "vitest";
import { makeDefaultSettings } from "../data/db";
import {
  buildPracticeSessionRecordV3,
  buildPracticeSessionStartSnapshot,
} from "./practiceSessionStartSnapshot";

describe("practice session start snapshot", () => {
  it("groups normalized practice, presentation, interaction, and environment values", () => {
    const settings = {
      ...makeDefaultSettings(),
      answerKeyboardScale: 1.2,
      correctDelayMs: 650,
      inactivityThresholdSeconds: 45,
      pianoVolume: 0.6,
      promptDisplayMode: "staff-page" as const,
      promptNoteDuration: "sixteenth" as const,
      queueStrategy: "melody" as const,
    };
    const built = buildPracticeSessionStartSnapshot({
      autoPlayTarget: true,
      mode: "fixed-count",
      prefersReducedMotion: true,
      settings,
      smoothStaffPageScroll: true,
      startPausedReading: true,
    });

    expect(built?.snapshot.practiceConfig).toMatchObject({
      effectiveQueueAlgorithm: "melody-v2",
      fixedCount: settings.fixedCount,
      mode: "fixed-count",
      queueStrategy: "melody",
    });
    expect(built?.snapshot.presentationConfig).toEqual({
      autoPlayTarget: true,
      promptDisplayMode: "staff-page",
      promptNoteDuration: "sixteenth",
      smoothStaffPageScroll: true,
      startPausedReading: true,
    });
    expect(built?.snapshot.interactionConfig).toEqual({
      answerKeyboardScale: 1.2,
      correctDelayMs: 650,
      inactivityThresholdSeconds: 45,
      pianoVolume: 0.6,
    });
    expect(built?.snapshot.environment).toEqual({ prefersReducedMotion: true });

  });

  it.each([
    {
      effectiveQueueAlgorithm: "melody-v2" as const,
      fixedCount: 17,
      fixedDurationSeconds: undefined,
      focusedTraining: false,
      mode: "fixed-count" as const,
      queueStrategy: "melody" as const,
    },
    {
      effectiveQueueAlgorithm: "focused-v1" as const,
      fixedCount: undefined,
      fixedDurationSeconds: 42,
      focusedTraining: true,
      mode: "fixed-duration" as const,
      queueStrategy: "focused" as const,
    },
  ])("projects every V3 compatibility field for $mode", ({
    effectiveQueueAlgorithm,
    fixedCount,
    fixedDurationSeconds,
    focusedTraining,
    mode,
    queueStrategy,
  }) => {
    const settings = {
      ...makeDefaultSettings(),
      drillNoteNames: ["C", "E"] as const,
      fixedCount: 17,
      fixedDurationSeconds: 42,
      includeInterStaffLedgerSpellings: true,
      promptDisplayMode: "staff-page" as const,
      promptNoteDuration: "sixteenth" as const,
      queueStrategy,
      staffNotationMode: "grand" as const,
    };
    const built = buildPracticeSessionStartSnapshot({
      autoPlayTarget: true,
      mode,
      prefersReducedMotion: true,
      settings: { ...settings, drillNoteNames: [...settings.drillNoteNames] },
      smoothStaffPageScroll: true,
      startPausedReading: true,
    })!;
    const session = buildPracticeSessionRecordV3({
      id: `session-${mode}`,
      snapshot: built.snapshot,
      startedAt: "2026-07-12T10:00:00.000Z",
    });

    expect(session).toEqual({
      completedCount: 0,
      drillNoteNames: ["C", "E"],
      effectiveQueueAlgorithm,
      enabledGroupIds: settings.enabledGroupIds,
      fixedCount,
      fixedDurationSeconds,
      focusedTraining,
      id: `session-${mode}`,
      includeInterStaffLedgerSpellings: true,
      interruptedCount: 0,
      mode,
      promptDisplayMode: "staff-page",
      promptNoteDuration: "sixteenth",
      queueStrategy,
      schemaVersion: 3,
      staffNotationMode: "grand",
      startSnapshot: built.snapshot,
      startedAt: "2026-07-12T10:00:00.000Z",
      targetNoteSetKey: built.snapshot.practiceConfig.targetNoteSetKey,
    });
  });
});
