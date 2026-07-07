import Dexie, { type Table } from "dexie";
import { createUuid } from "../domain/id";
import { DEFAULT_ENABLED_GROUPS, normalizePracticeGroupIds } from "../domain/notes";
import { DEFAULT_PIANO_VOLUME, normalizePianoVolume } from "../domain/settings";
import type { AppSettings, BackupState, NoteName, PracticeQueueStrategy, PracticeSessionRecord, ReviewRecord } from "../domain/types";

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
    schemaVersion: 1,
    dataSetId: createUuid(),
    createdAt: now,
    enabledGroupIds: DEFAULT_ENABLED_GROUPS,
    defaultMode: "fixed-duration",
    promptDisplayMode: "staff-page",
    promptNoteDuration: "quarter",
    fixedCount: 20,
    fixedDurationSeconds: 60,
    autoPlayTarget: false,
    includeLedgerVariants: true,
    pianoVolume: DEFAULT_PIANO_VOLUME,
    queueStrategy: "adaptive",
    drillNoteNames: ["C"],
    focusedTraining: false,
    inactivityThresholdSeconds: 30,
    correctDelayMs: 0,
  };
}

function sameGroupIds(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((groupId, index) => groupId === b[index]);
}

export async function ensureSettings(): Promise<AppSettings> {
  const existing = await db.settings.get("default");
  if (existing) {
    const persistedGroupIds = existing.enabledGroupIds ?? [];
    const enabledGroupIds = normalizePracticeGroupIds(persistedGroupIds);
    const pianoVolume = normalizePianoVolume(existing.pianoVolume);
    if (
      existing.queueStrategy === undefined ||
      existing.drillNoteNames === undefined ||
      existing.focusedTraining === undefined ||
      existing.includeLedgerVariants === undefined ||
      existing.pianoVolume === undefined ||
      existing.pianoVolume !== pianoVolume ||
      existing.promptDisplayMode === undefined ||
      existing.promptNoteDuration === undefined ||
      !sameGroupIds(persistedGroupIds, enabledGroupIds)
    ) {
      const migrated = {
        ...existing,
        enabledGroupIds,
        queueStrategy: resolveQueueStrategy(existing),
        drillNoteNames: resolveDrillNoteNames(existing),
        focusedTraining: existing.focusedTraining ?? resolveQueueStrategy(existing) === "focused",
        includeLedgerVariants: existing.includeLedgerVariants ?? true,
        pianoVolume,
        promptDisplayMode: existing.promptDisplayMode ?? "staff-page",
        promptNoteDuration: existing.promptNoteDuration ?? "quarter",
      };
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
    if (!review.ignored && !settings.firstReviewAt) {
      await db.settings.put({ ...settings, firstReviewAt: review.startedAt });
    }
  });
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
