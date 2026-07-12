import { applicableLedgerSetting } from "./staffNotation";
import { buildPracticeActivitySnapshot } from "./practiceComparison";
import type {
  AppSettings,
  PracticeMode,
  PracticeSessionRecordV3,
  PracticeSessionStartSnapshot,
  TargetNote,
} from "./types";

export interface BuildPracticeSessionStartSnapshotInput {
  autoPlayTarget: boolean;
  mode: PracticeMode;
  prefersReducedMotion: boolean;
  settings: AppSettings;
  smoothStaffPageScroll: boolean;
  startPausedReading: boolean;
}

export interface BuiltPracticeSessionStartSnapshot {
  notes: TargetNote[];
  snapshot: PracticeSessionStartSnapshot;
}

export function buildPracticeSessionRecordV3({
  id,
  snapshot,
  startedAt,
}: {
  id: string;
  snapshot: PracticeSessionStartSnapshot;
  startedAt: string;
}): PracticeSessionRecordV3 {
  const { practiceConfig, presentationConfig } = snapshot;
  return {
    completedCount: 0,
    drillNoteNames: [...practiceConfig.drillNoteNames],
    effectiveQueueAlgorithm: practiceConfig.effectiveQueueAlgorithm,
    enabledGroupIds: [...practiceConfig.enabledGroupIds],
    fixedCount: practiceConfig.fixedCount,
    fixedDurationSeconds: practiceConfig.fixedDurationSeconds,
    focusedTraining: practiceConfig.queueStrategy === "focused",
    id,
    includeInterStaffLedgerSpellings: practiceConfig.includeInterStaffLedgerSpellings,
    interruptedCount: 0,
    mode: practiceConfig.mode,
    promptDisplayMode: presentationConfig.promptDisplayMode,
    promptNoteDuration: presentationConfig.promptNoteDuration,
    queueStrategy: practiceConfig.queueStrategy,
    schemaVersion: 3,
    staffNotationMode: practiceConfig.staffNotationMode,
    startSnapshot: snapshot,
    startedAt,
    targetNoteSetKey: practiceConfig.targetNoteSetKey,
  };
}

export function buildPracticeSessionStartSnapshot({
  autoPlayTarget,
  mode,
  prefersReducedMotion,
  settings,
  smoothStaffPageScroll,
  startPausedReading,
}: BuildPracticeSessionStartSnapshotInput): BuiltPracticeSessionStartSnapshot | undefined {
  const activity = buildPracticeActivitySnapshot({
    drillNoteNames: settings.drillNoteNames,
    enabledGroupIds: settings.enabledGroupIds,
    includeInterStaffLedgerSpellings: settings.includeInterStaffLedgerSpellings,
    promptDisplayMode: settings.promptDisplayMode,
    promptNoteDuration: settings.promptNoteDuration,
    queueStrategy: settings.queueStrategy,
    staffNotationMode: settings.staffNotationMode,
  });
  if (!activity) {
    return undefined;
  }

  return {
    notes: activity.notes,
    snapshot: {
      practiceConfig: {
        drillNoteNames: [...settings.drillNoteNames],
        effectiveQueueAlgorithm: activity.effectiveQueueAlgorithm,
        enabledGroupIds: [...settings.enabledGroupIds],
        fixedCount: mode === "fixed-count" ? settings.fixedCount : undefined,
        fixedDurationSeconds: mode === "fixed-duration" ? settings.fixedDurationSeconds : undefined,
        includeInterStaffLedgerSpellings: applicableLedgerSetting(
          settings.staffNotationMode,
          settings.includeInterStaffLedgerSpellings,
        ),
        mode,
        queueStrategy: settings.queueStrategy,
        staffNotationMode: settings.staffNotationMode,
        targetNoteSetKey: activity.targetNoteSetKey,
      },
      presentationConfig: {
        autoPlayTarget,
        promptDisplayMode: settings.promptDisplayMode,
        promptNoteDuration: settings.promptNoteDuration,
        smoothStaffPageScroll,
        startPausedReading,
      },
      interactionConfig: {
        answerKeyboardScale: settings.answerKeyboardScale,
        correctDelayMs: settings.correctDelayMs,
        inactivityThresholdSeconds: settings.inactivityThresholdSeconds,
        pianoVolume: settings.pianoVolume,
      },
      environment: {
        prefersReducedMotion,
      },
    },
  };
}
