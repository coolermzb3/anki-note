import Dexie, { type Table } from "dexie";
import { DEFAULT_ENABLED_GROUPS } from "../domain/notes";
import type { AppSettings, BackupState, PracticeSessionRecord, ReviewRecord } from "../domain/types";

export class AppDatabase extends Dexie {
  settings!: Table<AppSettings, string>;
  practiceSessions!: Table<PracticeSessionRecord, string>;
  reviews!: Table<ReviewRecord, string>;
  backupStates!: Table<BackupState, string>;

  constructor() {
    super("anki-note");
    this.version(1).stores({
      settings: "id",
      practiceSessions: "id, startedAt, mode, endReason",
      reviews: "id, sessionId, targetNoteId, groupId, startedAt, answeredCorrectly, interrupted",
      backupStates: "id",
    });
  }
}

export const db = new AppDatabase();

export function makeDefaultSettings(): AppSettings {
  const now = new Date().toISOString();
  return {
    id: "default",
    schemaVersion: 1,
    dataSetId: crypto.randomUUID(),
    createdAt: now,
    enabledGroupIds: DEFAULT_ENABLED_GROUPS,
    defaultMode: "open-ended",
    fixedCount: 20,
    fixedDurationSeconds: 180,
    autoPlayTarget: true,
    focusedTraining: false,
    inactivityThresholdSeconds: 30,
    correctDelayMs: 400,
  };
}

export async function ensureSettings(): Promise<AppSettings> {
  const existing = await db.settings.get("default");
  if (existing) {
    if (existing.focusedTraining === undefined) {
      const migrated = { ...existing, focusedTraining: false };
      await db.settings.put(migrated);
      return migrated;
    }
    return existing;
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
    if (!settings.firstReviewAt) {
      await db.settings.put({ ...settings, firstReviewAt: review.startedAt });
    }
  });
}

export async function replaceAllData(
  settings: AppSettings,
  sessions: PracticeSessionRecord[],
  reviews: ReviewRecord[],
): Promise<void> {
  await db.transaction("rw", db.settings, db.practiceSessions, db.reviews, async () => {
    await db.settings.clear();
    await db.practiceSessions.clear();
    await db.reviews.clear();
    await db.settings.put(settings);
    await db.practiceSessions.bulkPut(sessions);
    await db.reviews.bulkPut(reviews);
  });
}

export async function loadAllData(): Promise<{
  settings: AppSettings;
  sessions: PracticeSessionRecord[];
  reviews: ReviewRecord[];
}> {
  const settings = await ensureSettings();
  const [sessions, reviews] = await Promise.all([
    db.practiceSessions.orderBy("startedAt").toArray(),
    db.reviews.orderBy("startedAt").toArray(),
  ]);
  return { settings, sessions, reviews };
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
