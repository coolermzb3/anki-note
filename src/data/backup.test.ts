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
  PracticeSessionRecordV1,
  ReviewRecord,
  StaffRecallRunRecord,
  StaffRecallRunRecordV1,
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
    const file = this.directory.fileSnapshot(this.name);
    return {
      size: new TextEncoder().encode(file.text).byteLength,
      lastModified: file.lastModified,
      text: async () => this.directory.readText(this.name),
    } as File;
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
  private readonly files = new Map<string, { text: string; lastModified: number }>();
  private readonly directories = new Map<string, MemoryDirectoryHandle>();
  private readonly readCounts = new Map<string, number>();
  private nextLastModified = 1;

  constructor(readonly name: string) {}

  async getFileHandle(name: string, options?: { create?: boolean }): Promise<FileSystemFileHandle> {
    if (!this.files.has(name)) {
      if (!options?.create) {
        throw new DOMException("File not found", "NotFoundError");
      }
      this.writeText(name, "");
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
    const { text } = this.fileSnapshot(name);
    this.readCounts.set(name, (this.readCounts.get(name) ?? 0) + 1);
    return text;
  }

  fileSnapshot(name: string): { text: string; lastModified: number } {
    const file = this.files.get(name);
    if (!file) {
      throw new DOMException("File not found", "NotFoundError");
    }
    return file;
  }

  readCount(name: string): number {
    return this.readCounts.get(name) ?? 0;
  }

  totalReadCount(): number {
    return (
      [...this.readCounts.values()].reduce((total, count) => total + count, 0) +
      [...this.directories.values()].reduce((total, directory) => total + directory.totalReadCount(), 0)
    );
  }

  resetReadCounts(): void {
    this.readCounts.clear();
    this.directories.forEach((directory) => directory.resetReadCounts());
  }

  writeText(name: string, text: string): void {
    this.files.set(name, { text, lastModified: this.nextLastModified++ });
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

function makeSession(overrides: Partial<PracticeSessionRecordV1> = {}): PracticeSessionRecordV1 {
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

function makeStaffRecallRun(overrides: Partial<StaffRecallRunRecordV1> = {}): StaffRecallRunRecordV1 {
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
    expect(Object.keys(state?.lastSeenBackupDayFileMetadata ?? {})).toEqual(["2026-07-04"]);
  });

  it("imports backup data before practice when the browser has no practice data", async () => {
    const directory = new MemoryDirectoryHandle("backup");
    await seedBackupDirectory(directory);
    await rememberDirectory(directory);

    await expect(syncBackupBeforeActivity({ requestPermission: true })).resolves.toMatchObject({ result: "synced-up" });

    await expect(db.reviews.toArray()).resolves.toMatchObject([{ id: "review-backup" }]);
    await expect(db.settings.get("default")).resolves.toMatchObject({ dataSetId: "dataset-backup" });
  });

  it("imports staff-recall history from a backup-only directory", async () => {
    const directory = new MemoryDirectoryHandle("backup");
    const settings = makeSettings({ dataSetId: "dataset-backup" });
    const run = makeStaffRecallRun();
    await writeBackupSnapshot(directory.handle(), buildBackupSnapshot(settings, [], [], run.endedAt, [run]));
    await rememberDirectory(directory);

    await expect(syncBackupBeforeActivity({ requestPermission: true })).resolves.toMatchObject({ result: "synced-up" });
    await expect(db.staffRecallRuns.toArray()).resolves.toEqual([run]);
  });

  it("checks an established ready backup without reading its day files", async () => {
    const directory = new MemoryDirectoryHandle("backup");
    await seedBrowserData();
    await rememberDirectory(directory);
    await writeBackupNow();
    directory.resetReadCounts();

    await expect(syncBackupBeforeActivity({ requestPermission: true })).resolves.toEqual({
      result: "ready",
      backupStateChanged: false,
    });

    expect(directory.readCount("manifest.json")).toBe(1);
    expect(directory.child("days").totalReadCount()).toBe(0);
  });

  it("establishes a local day-file metadata baseline once for existing backup state", async () => {
    const directory = new MemoryDirectoryHandle("backup");
    await seedBrowserData();
    await rememberDirectory(directory);
    await writeBackupNow();
    const state = await db.backupStates.get("default");
    await db.backupStates.put({ ...state!, lastSeenBackupDayFileMetadata: undefined });
    directory.resetReadCounts();

    await expect(syncBackupBeforeActivity({ requestPermission: true })).resolves.toEqual({
      result: "ready",
      backupStateChanged: true,
    });

    expect(directory.child("days").totalReadCount()).toBeGreaterThan(0);
    await expect(db.backupStates.get("default")).resolves.toMatchObject({
      lastSeenBackupDayFileMetadata: { "2026-07-04": { size: expect.any(Number), lastModified: expect.any(Number) } },
    });

    directory.resetReadCounts();
    await expect(syncBackupBeforeActivity({ requestPermission: true })).resolves.toEqual({
      result: "ready",
      backupStateChanged: false,
    });
    expect(directory.child("days").totalReadCount()).toBe(0);
  });

  it("falls back once when day-file metadata changes without a new manifest", async () => {
    const directory = new MemoryDirectoryHandle("backup");
    await seedBrowserData();
    await rememberDirectory(directory);
    await writeBackupNow();
    const daysDirectory = directory.child("days");
    const dayText = daysDirectory.readText("2026-07-04.json");
    daysDirectory.writeText("2026-07-04.json", dayText);
    directory.resetReadCounts();

    await expect(syncBackupBeforeActivity({ requestPermission: true })).resolves.toEqual({
      result: "ready",
      backupStateChanged: true,
    });

    expect(daysDirectory.totalReadCount()).toBeGreaterThan(0);
    directory.resetReadCounts();
    await expect(syncBackupBeforeActivity({ requestPermission: true })).resolves.toEqual({
      result: "ready",
      backupStateChanged: false,
    });
    expect(daysDirectory.totalReadCount()).toBe(0);
  });

  it("clears a recovered backup error before returning to the cached ready path", async () => {
    const directory = new MemoryDirectoryHandle("backup");
    await seedBrowserData();
    await rememberDirectory(directory);
    await writeBackupNow();
    const state = await db.backupStates.get("default");
    await db.backupStates.put({ ...state!, lastError: "temporary read error" });
    directory.resetReadCounts();

    await expect(syncBackupBeforeActivity({ requestPermission: true })).resolves.toEqual({
      result: "ready",
      backupStateChanged: true,
    });

    expect(directory.child("days").totalReadCount()).toBeGreaterThan(0);
    await expect(db.backupStates.get("default")).resolves.toMatchObject({ lastError: undefined });

    directory.resetReadCounts();
    await expect(syncBackupBeforeActivity({ requestPermission: true })).resolves.toEqual({
      result: "ready",
      backupStateChanged: false,
    });
    expect(directory.child("days").totalReadCount()).toBe(0);
  });

  it("keeps a cross-day browser append ready and tracks its new day after backup", async () => {
    const directory = new MemoryDirectoryHandle("backup");
    await seedBrowserData();
    await rememberDirectory(directory);
    await writeBackupNow();
    await db.reviews.put(
      makeReview({
        id: "review-next-day",
        sessionId: "session-browser",
        targetNoteId: "D4",
        startedAt: "2026-07-05T00:00:01.000+08:00",
        answeredAt: "2026-07-05T00:00:02.000+08:00",
        endedAt: "2026-07-05T00:00:02.000+08:00",
      }),
    );
    directory.resetReadCounts();

    await expect(syncBackupBeforeActivity({ requestPermission: true })).resolves.toEqual({
      result: "ready",
      backupStateChanged: false,
    });
    expect(directory.child("days").totalReadCount()).toBe(0);

    await writeBackupNow();
    const state = await db.backupStates.get("default");
    expect(Object.keys(state?.lastSeenBackupDayFileMetadata ?? {})).toEqual(["2026-07-04", "2026-07-05"]);
    directory.resetReadCounts();

    await expect(syncBackupBeforeActivity({ requestPermission: true })).resolves.toEqual({
      result: "ready",
      backupStateChanged: false,
    });
    expect(directory.child("days").totalReadCount()).toBe(0);
  });

  it("reads day files when an established backup manifest changes externally", async () => {
    const directory = new MemoryDirectoryHandle("backup");
    await seedBrowserData({ dataSetId: "dataset-shared" });
    await rememberDirectory(directory);
    await writeBackupNow();
    await seedBackupDirectory(directory, {
      dataSetId: "dataset-shared",
      reviewEndedAt: "2026-07-05T10:00:02.000+08:00",
    });
    directory.resetReadCounts();

    await expect(syncBackupBeforeActivity({ requestPermission: true })).resolves.toMatchObject({ result: "synced-up" });

    expect(directory.child("days").totalReadCount()).toBeGreaterThan(0);
    await expect(db.reviews.toArray()).resolves.toMatchObject([{ id: "review-backup" }]);
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

    await expect(syncBackupBeforeActivity({ requestPermission: true })).resolves.toMatchObject({ result: "synced-up" });

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

    await expect(syncBackupBeforeActivity({ requestPermission: true })).resolves.toMatchObject({
      result: "data-conflict",
    });

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
      conflictBackupFirstDataAt: "2026-07-05T10:00:00.000+08:00",
      conflictBackupLastDataAt: "2026-07-05T10:00:02.000+08:00",
      conflictBackupRecordCount: 1,
      conflictBackupReviewCount: 1,
      conflictBackupStaffRecallRunCount: 0,
      conflictBrowserFirstDataAt: "2026-07-04T10:00:00.000+08:00",
      conflictBrowserLastDataAt: "2026-07-04T10:00:02.000+08:00",
      conflictBrowserRecordCount: 1,
      conflictBrowserReviewCount: 1,
      conflictBrowserStaffRecallRunCount: 0,
      dataConflictBeforeBackup: true,
      lastError: backupText.messages.dataConflictBeforeBackup,
      syncRequiredBeforeBackup: true,
    });
  });
});
