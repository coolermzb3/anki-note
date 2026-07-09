import "fake-indexeddb/auto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buildBackupSnapshot } from "../domain/backupSnapshot";
import { makeReview } from "../domain/testFactories";
import type {
  AppSettings,
  BackupDayFile,
  BackupManifest,
  BackupState,
  PracticeSessionRecord,
  ReviewRecord,
  StaffRecallRunRecord,
} from "../domain/types";
import { backupText } from "../domain/backupText";
import { db, makeDefaultSettings } from "./db";
import { refreshBackupConflictDetails, syncBackupBeforeActivity, writeBackupIfSafe, writeBackupNow, writeBackupSnapshot } from "./backup";

class MemoryFileHandle {
  readonly kind = "file";

  constructor(
    readonly name: string,
    private readonly directory: MemoryDirectoryHandle,
  ) {}

  async getFile(): Promise<File> {
    const text = this.directory.readText(this.name);
    return { text: async () => text } as File;
  }

  async createWritable(): Promise<FileSystemWritableFileStream> {
    let text = "";
    return {
      write: async (value: unknown) => {
        text = String(value);
      },
      close: async () => {
        this.directory.writeText(this.name, text);
      },
    } as FileSystemWritableFileStream;
  }
}

class MemoryDirectoryHandle {
  readonly kind = "directory";
  private readonly files = new Map<string, string>();
  private readonly directories = new Map<string, MemoryDirectoryHandle>();

  constructor(readonly name: string) {}

  async getFileHandle(name: string, options?: { create?: boolean }): Promise<FileSystemFileHandle> {
    if (!this.files.has(name)) {
      if (!options?.create) {
        throw new DOMException("File not found", "NotFoundError");
      }
      this.files.set(name, "");
    }
    return new MemoryFileHandle(name, this) as unknown as FileSystemFileHandle;
  }

  async getDirectoryHandle(name: string, options?: { create?: boolean }): Promise<FileSystemDirectoryHandle> {
    let directory = this.directories.get(name);
    if (!directory) {
      if (!options?.create) {
        throw new DOMException("Directory not found", "NotFoundError");
      }
      directory = new MemoryDirectoryHandle(name);
      this.directories.set(name, directory);
    }
    return directory as unknown as FileSystemDirectoryHandle;
  }

  async queryPermission(): Promise<PermissionState> {
    return "granted";
  }

  async requestPermission(): Promise<PermissionState> {
    return "granted";
  }

  readJson<T>(name: string): T {
    return JSON.parse(this.readText(name)) as T;
  }

  child(name: string): MemoryDirectoryHandle {
    const directory = this.directories.get(name);
    if (!directory) {
      throw new Error(`Missing directory: ${name}`);
    }
    return directory;
  }

  readText(name: string): string {
    const text = this.files.get(name);
    if (text === undefined) {
      throw new DOMException("File not found", "NotFoundError");
    }
    return text;
  }

  writeText(name: string, text: string): void {
    this.files.set(name, text);
  }

  handle(): FileSystemDirectoryHandle {
    return this as unknown as FileSystemDirectoryHandle;
  }
}

function makeSettings(overrides: Partial<AppSettings> = {}): AppSettings {
  return {
    ...makeDefaultSettings(),
    dataSetId: "dataset-browser",
    createdAt: "2026-07-04T09:00:00.000+08:00",
    firstReviewAt: "2026-07-04T10:00:00.000+08:00",
    ...overrides,
  };
}

function makeSession(overrides: Partial<PracticeSessionRecord> = {}): PracticeSessionRecord {
  return {
    id: "session-browser",
    schemaVersion: 1,
    mode: "fixed-count",
    enabledGroupIds: ["G3-F4"],
    fixedCount: 1,
    queueStrategy: "adaptive",
    drillNoteNames: ["C"],
    focusedTraining: false,
    startedAt: "2026-07-04T10:00:00.000+08:00",
    endedAt: "2026-07-04T10:01:00.000+08:00",
    endReason: "completed-count",
    completedCount: 1,
    interruptedCount: 0,
    ...overrides,
  };
}

function makeStaffRecallRun(overrides: Partial<StaffRecallRunRecord> = {}): StaffRecallRunRecord {
  return {
    id: "recall-backup",
    schemaVersion: 1,
    answerSetKey: "C4|D4|E4|F4|G3|A3|B3",
    targetNoteIds: ["C4", "D4", "E4", "F4", "G3", "A3", "B3"],
    columnOrder: ["F", "C", "G", "D", "A", "E", "B"],
    columnActiveMs: { C: 1000, D: 1000, E: 1000, F: 1000, G: 1000, A: 1000, B: 1000 },
    startedAt: "2026-07-05T11:00:00.000+08:00",
    endedAt: "2026-07-05T11:01:00.000+08:00",
    ...overrides,
  };
}

async function seedBrowserData({
  dataSetId = "dataset-browser",
  reviewId = "review-browser",
  reviewEndedAt = "2026-07-04T10:00:02.000+08:00",
}: {
  dataSetId?: string;
  reviewEndedAt?: string;
  reviewId?: string;
} = {}): Promise<{ reviews: ReviewRecord[]; sessions: PracticeSessionRecord[]; settings: AppSettings }> {
  const settings = makeSettings({ dataSetId });
  const sessions = [makeSession()];
  const reviews = [
    makeReview({
      id: reviewId,
      sessionId: sessions[0].id,
      targetNoteId: "C4",
      startedAt: "2026-07-04T10:00:00.000+08:00",
      endedAt: reviewEndedAt,
      answeredAt: reviewEndedAt,
    }),
  ];
  await db.settings.put(settings);
  await db.practiceSessions.bulkPut(sessions);
  await db.reviews.bulkPut(reviews);
  return { settings, sessions, reviews };
}

async function seedBackupDirectory(
  directory: MemoryDirectoryHandle,
  {
    dataSetId = "dataset-backup",
    reviewId = "review-backup",
    reviewEndedAt = "2026-07-05T10:00:02.000+08:00",
  }: {
    dataSetId?: string;
    reviewEndedAt?: string;
    reviewId?: string;
  } = {},
): Promise<void> {
  const settings = makeSettings({
    dataSetId,
    firstReviewAt: "2026-07-05T10:00:00.000+08:00",
  });
  const sessions = [
    makeSession({
      id: "session-backup",
      startedAt: "2026-07-05T10:00:00.000+08:00",
      endedAt: "2026-07-05T10:01:00.000+08:00",
    }),
  ];
  const reviews = [
    makeReview({
      id: reviewId,
      sessionId: sessions[0].id,
      targetNoteId: "D4",
      startedAt: "2026-07-05T10:00:00.000+08:00",
      endedAt: reviewEndedAt,
      answeredAt: reviewEndedAt,
    }),
  ];
  await writeBackupSnapshot(directory.handle(), buildBackupSnapshot(settings, sessions, reviews));
}

async function rememberDirectory(directory: MemoryDirectoryHandle): Promise<void> {
  await db.backupStates.put({
    id: "default",
    schemaVersion: 1,
    directoryHandle: directory.handle(),
    directoryName: directory.name,
  });
}

describe("file backup side effects", () => {
  let storedBackupState: BackupState | undefined;

  beforeEach(async () => {
    await db.delete();
    await db.open();
    storedBackupState = undefined;
    vi.spyOn(db.backupStates as unknown as { get: (id: string) => Promise<BackupState | undefined> }, "get").mockImplementation(
      async (id: string) => (id === "default" ? storedBackupState : undefined),
    );
    vi.spyOn(db.backupStates as unknown as { put: (state: BackupState) => Promise<string> }, "put").mockImplementation(async (state) => {
      storedBackupState = state;
      return state.id;
    });
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await db.delete();
  });

  it("writes browser data into an empty selected directory", async () => {
    const directory = new MemoryDirectoryHandle("backup");
    const { settings } = await seedBrowserData();
    await rememberDirectory(directory);

    await writeBackupNow();

    const manifest = directory.readJson<BackupManifest>("manifest.json");
    const day = directory.child("days").readJson<BackupDayFile>("2026-07-04.json");
    const state = await db.backupStates.get("default");
    expect(manifest.dataSetId).toBe(settings.dataSetId);
    expect(day.reviews.map((review) => review.id)).toEqual(["review-browser"]);
    expect(state?.dataConflictBeforeBackup).toBe(false);
    expect(state?.lastSeenBackupVersion).toBe(`snapshot:${manifest.snapshotId}`);
  });

  it("imports backup data before practice when the browser has no practice data", async () => {
    const directory = new MemoryDirectoryHandle("backup");
    await seedBackupDirectory(directory);
    await rememberDirectory(directory);

    await expect(syncBackupBeforeActivity({ requestPermission: true })).resolves.toBe("synced-up");

    await expect(db.reviews.toArray()).resolves.toMatchObject([{ id: "review-backup" }]);
    await expect(db.settings.get("default")).resolves.toMatchObject({ dataSetId: "dataset-backup" });
  });

  it("imports staff-recall history from a backup-only directory", async () => {
    const directory = new MemoryDirectoryHandle("backup");
    const settings = makeSettings({ dataSetId: "dataset-backup" });
    const run = makeStaffRecallRun();
    await writeBackupSnapshot(directory.handle(), buildBackupSnapshot(settings, [], [], run.endedAt, [run]));
    await rememberDirectory(directory);

    await expect(syncBackupBeforeActivity({ requestPermission: true })).resolves.toBe("synced-up");
    await expect(db.staffRecallRuns.toArray()).resolves.toEqual([run]);
  });

  it("imports newer backup data before practice when no conflict guard exists", async () => {
    const directory = new MemoryDirectoryHandle("backup");
    await seedBrowserData({
      dataSetId: "dataset-shared",
      reviewEndedAt: "2026-07-04T10:00:02.000+08:00",
    });
    await seedBackupDirectory(directory, {
      dataSetId: "dataset-shared",
      reviewEndedAt: "2026-07-05T10:00:02.000+08:00",
    });
    await rememberDirectory(directory);

    await expect(syncBackupBeforeActivity({ requestPermission: true })).resolves.toBe("synced-up");

    await expect(db.reviews.toArray()).resolves.toMatchObject([{ id: "review-backup" }]);
    await expect(db.backupStates.get("default")).resolves.toMatchObject({
      dataConflictBeforeBackup: false,
      syncRequiredBeforeBackup: false,
    });
  });

  it("does not import newer backup data before practice while a conflict guard exists", async () => {
    const directory = new MemoryDirectoryHandle("backup");
    await seedBrowserData({
      dataSetId: "dataset-shared",
      reviewEndedAt: "2026-07-04T10:00:02.000+08:00",
    });
    await seedBackupDirectory(directory, {
      dataSetId: "dataset-shared",
      reviewEndedAt: "2026-07-05T10:00:02.000+08:00",
    });
    await db.backupStates.put({
      id: "default",
      schemaVersion: 1,
      directoryHandle: directory.handle(),
      directoryName: directory.name,
      syncRequiredBeforeBackup: true,
      lastError: "备份目录已有更新，请先导入备份。",
    });

    await expect(syncBackupBeforeActivity({ requestPermission: true })).resolves.toBe("data-conflict");

    await expect(db.reviews.toArray()).resolves.toMatchObject([{ id: "review-browser" }]);
    await expect(db.backupStates.get("default")).resolves.toMatchObject({
      dataConflictBeforeBackup: true,
      syncRequiredBeforeBackup: true,
    });
  });

  it("does not import over browser data when a backup write finds divergence", async () => {
    const directory = new MemoryDirectoryHandle("backup");
    await seedBrowserData();
    await seedBackupDirectory(directory);
    await rememberDirectory(directory);

    await expect(writeBackupNow()).rejects.toThrow(backupText.messages.dataConflictBeforeBackup);

    await expect(db.reviews.toArray()).resolves.toMatchObject([{ id: "review-browser" }]);
    await expect(db.backupStates.get("default")).resolves.toMatchObject({
      dataConflictBeforeBackup: true,
      syncRequiredBeforeBackup: true,
    });
  });

  it("records divergence without throwing during safe periodic backup", async () => {
    const directory = new MemoryDirectoryHandle("backup");
    await seedBrowserData();
    await seedBackupDirectory(directory);
    await rememberDirectory(directory);

    await writeBackupIfSafe();

    await expect(db.reviews.toArray()).resolves.toMatchObject([{ id: "review-browser" }]);
    await expect(db.backupStates.get("default")).resolves.toMatchObject({
      dataConflictBeforeBackup: true,
      syncRequiredBeforeBackup: true,
    });
  });

  it("fills conflict summaries for legacy conflict states", async () => {
    const directory = new MemoryDirectoryHandle("backup");
    await seedBrowserData();
    await seedBackupDirectory(directory);
    await db.backupStates.put({
      id: "default",
      schemaVersion: 1,
      directoryHandle: directory.handle(),
      directoryName: directory.name,
      syncRequiredBeforeBackup: true,
      lastError: "备份目录已有更新，请先导入备份。",
    });

    await expect(refreshBackupConflictDetails()).resolves.toBe(true);

    await expect(db.backupStates.get("default")).resolves.toMatchObject({
      conflictBackupRecordCount: 1,
      conflictBackupReviewCount: 1,
      conflictBackupStaffRecallRunCount: 0,
      conflictBrowserRecordCount: 1,
      conflictBrowserReviewCount: 1,
      conflictBrowserStaffRecallRunCount: 0,
      dataConflictBeforeBackup: true,
      lastError: backupText.messages.dataConflictBeforeBackup,
      syncRequiredBeforeBackup: true,
    });
  });
});
