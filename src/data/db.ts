import Dexie, { type Table } from "dexie";
import { createUuid } from "../domain/id";
import {
  DEFAULT_ENABLED_GROUPS,
  normalizeCurrentPracticeGroupIds,
  normalizePracticeGroupIds,
} from "../domain/notes";
import { DEFAULT_PIANO_VOLUME, normalizePianoVolume } from "../domain/settings";
import type {
  AppSettings,
  BackupState,
  NoteName,
  PracticeQueueStrategy,
  PracticeSessionRecord,
  ReviewRecord,
  StaffRecallRunRecord,
  StoredAppSettings,
  StaffNotationMode,
} from "../domain/types";

export class AppDatabase extends Dexie {
  settings!: Table<StoredAppSettings, string>;
  practiceSessions!: Table<PracticeSessionRecord, string>;
  reviews!: Table<ReviewRecord, string>;
  staffRecallRuns!: Table<StaffRecallRunRecord, string>;
  backupStates!: Table<BackupState, string>;

  constructor() {
    super("anki-note");
    this.version(1).stores({
      settings: "id",
      practiceSessions: "id, startedAt, mode, endReason",
      reviews: "id, sessionId, targetNoteId, groupId, startedAt, answeredCorrectly, interrupted",
      backupStates: "id",
    });
    this.version(2).stores({
      settings: "id",
      practiceSessions: "id, startedAt, mode, endReason",
      reviews: "id, sessionId, targetNoteId, groupId, startedAt, answeredCorrectly, interrupted",
      staffRecallRuns: "id, answerSetKey, endedAt",
      backupStates: "id",
    });
  }
}

export const db = new AppDatabase();

export function resolveQueueStrategy(settings: { queueStrategy?: PracticeQueueStrategy; focusedTraining?: boolean }): PracticeQueueStrategy {
  return settings.queueStrategy ?? (settings.focusedTraining ? "focused" : "adaptive");
}

export function resolveDrillNoteNames(settings: { drillNoteNames?: NoteName[] }): NoteName[] {
  return settings.drillNoteNames && settings.drillNoteNames.length > 0 ? settings.drillNoteNames : ["C"];
}

export function makeDefaultSettings(): AppSettings {
  const now = new Date().toISOString();
  return {
    id: "default",
    schemaVersion: 2,
    dataSetId: createUuid(),
    createdAt: now,
    enabledGroupIds: DEFAULT_ENABLED_GROUPS,
    staffNotationMode: "grand",
    defaultMode: "fixed-duration",
    promptDisplayMode: "staff-page",
    promptNoteDuration: "quarter",
    fixedCount: 20,
    fixedDurationSeconds: 60,
    autoPlayTarget: false,
    includeInterStaffLedgerSpellings: false,
    pianoVolume: DEFAULT_PIANO_VOLUME,
    queueStrategy: "adaptive",
    drillNoteNames: ["C"],
    focusedTraining: false,
    inactivityThresholdSeconds: 30,
    correctDelayMs: 0,
  };
}

function normalizeStoredStaffNotationMode(value: unknown): StaffNotationMode {
  if (value === "treble-only" || value === "bass-only" || value === "grand") {
    return value;
  }
  return "grand";
}

export function normalizeAppSettings(existing: StoredAppSettings): AppSettings {
  const { selectedStaffs: _discardedStaffs, ...stored } = existing as StoredAppSettings & {
    selectedStaffs?: unknown;
  };
  const defaults = makeDefaultSettings();
  const queueStrategy = resolveQueueStrategy(existing);
  return {
    ...defaults,
    ...stored,
    schemaVersion: 2,
    enabledGroupIds:
      existing.schemaVersion === 2
        ? normalizeCurrentPracticeGroupIds(existing.enabledGroupIds)
        : normalizePracticeGroupIds(existing.enabledGroupIds),
    staffNotationMode: normalizeStoredStaffNotationMode(
      "staffNotationMode" in stored ? stored.staffNotationMode : undefined,
    ),
    defaultMode: existing.defaultMode ?? defaults.defaultMode,
    promptDisplayMode: existing.promptDisplayMode ?? "staff-page",
    promptNoteDuration: existing.promptNoteDuration ?? "quarter",
    fixedCount: existing.fixedCount ?? defaults.fixedCount,
    fixedDurationSeconds: existing.fixedDurationSeconds ?? defaults.fixedDurationSeconds,
    autoPlayTarget: existing.autoPlayTarget ?? defaults.autoPlayTarget,
    includeInterStaffLedgerSpellings:
      existing.schemaVersion === 2
        ? existing.includeInterStaffLedgerSpellings ?? defaults.includeInterStaffLedgerSpellings
        : existing.includeLedgerVariants ?? true,
    pianoVolume: normalizePianoVolume(existing.pianoVolume),
    queueStrategy,
    drillNoteNames: resolveDrillNoteNames(existing),
    focusedTraining: existing.focusedTraining ?? queueStrategy === "focused",
    inactivityThresholdSeconds: existing.inactivityThresholdSeconds ?? defaults.inactivityThresholdSeconds,
    correctDelayMs: existing.correctDelayMs ?? defaults.correctDelayMs,
  };
}

function sameGroupIds(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((groupId, index) => groupId === b[index]);
}

export async function ensureSettings(): Promise<AppSettings> {
  const existing = await db.settings.get("default");
  if (existing) {
    const migrated = normalizeAppSettings(existing);
    if (
      existing.schemaVersion !== 2 ||
      !sameGroupIds(existing.enabledGroupIds ?? [], migrated.enabledGroupIds) ||
      JSON.stringify(existing) !== JSON.stringify(migrated)
    ) {
      await db.settings.put(migrated);
    }
    return migrated;
  }
  const settings = makeDefaultSettings();
  await db.settings.put(settings);
  return settings;
}

export async function getBackupState(): Promise<BackupState> {
  const existing = await db.backupStates.get("default");
  if (existing) {
    return existing;
  }
  const state: BackupState = { id: "default", schemaVersion: 1 };
  await db.backupStates.put(state);
  return state;
}

export async function saveReview(review: ReviewRecord): Promise<void> {
  await db.transaction("rw", db.reviews, db.settings, async () => {
    await db.reviews.put(review);
    const settings = await ensureSettings();
    if (!review.ignored && !settings.firstReviewAt) {
      await db.settings.put({ ...settings, firstReviewAt: review.startedAt });
    }
  });
}

export async function saveStaffRecallRun(run: StaffRecallRunRecord): Promise<void> {
  await db.staffRecallRuns.put(run);
}

export async function deletePracticeSessionWithReviews(
  sessionId: PracticeSessionRecord["id"],
  reviews: ReviewRecord[],
): Promise<void> {
  const reviewIds = reviews.filter((review) => !review.ignored).map((review) => review.id);
  await db.transaction("rw", db.settings, db.practiceSessions, db.reviews, async () => {
    await db.practiceSessions.delete(sessionId);
    if (reviewIds.length > 0) {
      await db.reviews.bulkDelete(reviewIds);
    }

    const settings = await db.settings.get("default");
    if (!settings) {
      return;
    }
    const [firstRemainingReview] = await db.reviews.filter((review) => !review.ignored).sortBy("startedAt");
    const nextFirstReviewAt = firstRemainingReview?.startedAt;
    if (settings.firstReviewAt === nextFirstReviewAt) {
      return;
    }

    const nextSettings = { ...settings };
    if (nextFirstReviewAt) {
      nextSettings.firstReviewAt = nextFirstReviewAt;
    } else {
      delete nextSettings.firstReviewAt;
    }
    await db.settings.put(nextSettings);
  });
}

export async function replaceAllData(
  settings: AppSettings,
  sessions: PracticeSessionRecord[],
  reviews: ReviewRecord[],
  staffRecallRuns: StaffRecallRunRecord[] = [],
): Promise<void> {
  await db.transaction("rw", db.settings, db.practiceSessions, db.reviews, db.staffRecallRuns, async () => {
    await db.settings.clear();
    await db.practiceSessions.clear();
    await db.reviews.clear();
    await db.staffRecallRuns.clear();
    await db.settings.put(settings);
    await db.practiceSessions.bulkPut(sessions);
    await db.reviews.bulkPut(reviews);
    await db.staffRecallRuns.bulkPut(staffRecallRuns);
  });
}

export async function loadAllData(): Promise<{
  settings: AppSettings;
  sessions: PracticeSessionRecord[];
  reviews: ReviewRecord[];
  staffRecallRuns: StaffRecallRunRecord[];
}> {
  const settings = await ensureSettings();
  const [sessions, reviews, staffRecallRuns] = await Promise.all([
    db.practiceSessions.orderBy("startedAt").toArray(),
    db.reviews.orderBy("startedAt").toArray(),
    db.staffRecallRuns.orderBy("endedAt").toArray(),
  ]);
  return { settings, sessions, reviews, staffRecallRuns };
}

export async function recoverAbandonedSessions(): Promise<void> {
  const openSessions = await db.practiceSessions.filter((session) => !session.endedAt).toArray();
  if (openSessions.length === 0) {
    return;
  }
  const endedAt = new Date().toISOString();
  await db.practiceSessions.bulkPut(
    openSessions.map((session) => ({
      ...session,
      endedAt,
      endReason: "abandoned" as const,
    })),
  );
}
