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
import { DEFAULT_VOCAL_PITCH_CONFIG, type VocalAudioMaterial, type VocalAudioSource } from "../domain/vocalPitch";
import { digestBlob } from "./blobDigest";
import { db, makeDefaultSettings } from "./db";
import {
  refreshBackupConflictDetails,
  resolveBackupConflict,
  syncBackupBeforeActivity,
  writeBackupIfSafe,
  writeBackupNow,
  writeBackupSnapshot,
} from "./backup";

class MemoryFileHandle {
  readonly kind = "file";

  constructor(
    readonly name: string,
    private readonly directory: MemoryDirectoryHandle,
  ) {}

  async getFile(): Promise<File> {
    const file = this.directory.fileSnapshot(this.name);
    const blob = new Blob([file.text]);
    Object.defineProperties(blob, {
      lastModified: { value: file.lastModified },
      text: { value: async () => this.directory.readText(this.name) },
    });
    return blob as File;
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
  private readonly writeCounts = new Map<string, number>();
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

  async removeEntry(name: string): Promise<void> {
    if (!this.files.delete(name) && !this.directories.delete(name)) {
      throw new DOMException("Entry not found", "NotFoundError");
    }
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

  writeCount(name: string): number {
    return this.writeCounts.get(name) ?? 0;
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

  resetWriteCounts(): void {
    this.writeCounts.clear();
    this.directories.forEach((directory) => directory.resetWriteCounts());
  }

  writeText(name: string, text: string): void {
    this.files.set(name, { text, lastModified: this.nextLastModified++ });
    this.writeCounts.set(name, (this.writeCounts.get(name) ?? 0) + 1);
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
    backupAt,
    dataSetId = "dataset-backup",
    reviewId = "review-backup",
    reviewEndedAt = "2026-07-05T10:00:02.000+08:00",
  }: {
    backupAt?: string;
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
  await writeBackupSnapshot(directory.handle(), buildBackupSnapshot(settings, sessions, reviews, backupAt));
}

function makeVocalAudioMaterial(id: string, source: VocalAudioSource): VocalAudioMaterial {
  return {
    audioBlob: new Blob(),
    config: DEFAULT_VOCAL_PITCH_CONFIG,
    contentDigest: `digest-${id}`,
    createdAt: "2026-07-04T12:00:00.000+08:00",
    durationSeconds: 1,
    id,
    mimeType: "audio/webm",
    name: id,
    schemaVersion: 1,
    size: 0,
    source,
    updatedAt: "2026-07-04T12:00:00.000+08:00",
  };
}

async function makeBackedVocalAudioMaterial(id: string): Promise<VocalAudioMaterial> {
  const audioBlob = new Blob(["[object Blob]"], { type: "audio/webm" });
  return {
    ...makeVocalAudioMaterial(id, "recording"),
    audioBlob,
    contentDigest: await digestBlob(audioBlob),
    size: audioBlob.size,
  };
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
    expect(state?.lastSeenBackupDataSetId).toBe(settings.dataSetId);
    expect(state?.lastSeenBackupDayFileDigests).toEqual(manifest.dayFileDigests);
    expect(Object.keys(state?.lastSeenBackupDayFileMetadata ?? {})).toEqual(["2026-07-04"]);
  });

  it("ignores metadata-only changes to a verified audio backup index", async () => {
    const directory = new MemoryDirectoryHandle("backup");
    await seedBrowserData();
    await rememberDirectory(directory);
    await writeBackupNow();

    const audioDirectory = directory.child("audio");
    audioDirectory.writeText("index.json", `${audioDirectory.readText("index.json")}\n`);

    await writeBackupIfSafe();

    await expect(db.backupStates.get("default")).resolves.toMatchObject({
      dataConflictBeforeBackup: false,
      syncRequiredBeforeBackup: false,
    });
    expect(audioDirectory.readText("index.json")).toMatch(/\n$/);
  });

  it("detects a changed analysis cache in the audio backup", async () => {
    const directory = new MemoryDirectoryHandle("backup");
    await seedBrowserData();
    await db.vocalAudioMaterials.put({
      ...(await makeBackedVocalAudioMaterial("vocal-analyzed")),
      analysis: {
        analyzedAt: "2026-07-04T12:01:00.000+08:00",
        config: DEFAULT_VOCAL_PITCH_CONFIG,
        detectorId: "pitchy-mpm",
        detectorVersion: 1,
        frames: [{ confidence: 1, frequencyHz: 440, timeSeconds: 0 }],
        hopSeconds: 0.01,
        sampleRate: 48_000,
        schemaVersion: 1,
      },
    });
    await rememberDirectory(directory);
    await writeBackupNow();

    directory.child("audio").writeText("vocal-analyzed.analysis.json", JSON.stringify({ frames: [] }));

    await expect(syncBackupBeforeActivity({ requestPermission: true })).resolves.toMatchObject({
      result: "data-conflict",
    });
    await expect(db.backupStates.get("default")).resolves.toMatchObject({
      conflictLearningData: false,
      conflictVocalAudio: true,
    });

    await resolveBackupConflict({ vocalAudio: "browser" });

    expect(directory.child("audio").readJson<{ frames: unknown[] }>("vocal-analyzed.analysis.json").frames).toEqual([
      { confidence: 1, frequencyHz: 440, timeSeconds: 0 },
    ]);
    await expect(db.backupStates.get("default")).resolves.toMatchObject({
      dataConflictBeforeBackup: false,
      syncRequiredBeforeBackup: false,
    });
  });

  it("rewrites a missing audio backup file when keeping the browser domain", async () => {
    const directory = new MemoryDirectoryHandle("backup");
    await seedBrowserData();
    await db.vocalAudioMaterials.put(await makeBackedVocalAudioMaterial("vocal-missing"));
    await rememberDirectory(directory);
    await writeBackupNow();
    await directory.child("audio").removeEntry("vocal-missing.webm");

    await expect(syncBackupBeforeActivity({ requestPermission: true })).resolves.toMatchObject({
      result: "data-conflict",
    });
    await resolveBackupConflict({ vocalAudio: "browser" });

    expect(directory.child("audio").readText("vocal-missing.webm")).toBe("[object Blob]");
    await expect(db.backupStates.get("default")).resolves.toMatchObject({
      dataConflictBeforeBackup: false,
      syncRequiredBeforeBackup: false,
    });
  });

  it("imports backup data before practice when the browser has no practice data", async () => {
    const directory = new MemoryDirectoryHandle("backup");
    await seedBackupDirectory(directory);
    await rememberDirectory(directory);
    directory.resetReadCounts();

    const outcome = await syncBackupBeforeActivity({ requestPermission: true });

    expect(outcome).toMatchObject({
      result: "synced-up",
      importedData: {
        reviews: [{ id: "review-backup" }],
        settings: { dataSetId: "dataset-backup" },
      },
    });
    expect(directory.child("days").readCount("2026-07-05.json")).toBe(1);
    await expect(db.reviews.toArray()).resolves.toMatchObject([{ id: "review-backup" }]);
    await expect(db.settings.get("default")).resolves.toMatchObject({ dataSetId: "dataset-backup" });
  });

  it("rejects a complete digest manifest when a day file no longer matches it", async () => {
    const directory = new MemoryDirectoryHandle("backup");
    await seedBackupDirectory(directory);
    const daysDirectory = directory.child("days");
    daysDirectory.writeText("2026-07-05.json", `${daysDirectory.readText("2026-07-05.json")}\n`);
    await rememberDirectory(directory);

    await expect(syncBackupBeforeActivity({ requestPermission: true })).rejects.toThrow(
      backupText.errors.dayFileDigestMismatch,
    );

    await expect(db.reviews.count()).resolves.toBe(0);
  });

  it("normalizes the legacy answer-pitch key without rewriting the imported backup", async () => {
    const directory = new MemoryDirectoryHandle("backup");
    await seedBackupDirectory(directory);
    const manifest = directory.readJson<BackupManifest>("manifest.json");
    delete manifest.learningDataDigest;
    (manifest.settings as unknown as { answerPitchMode: string }).answerPitchMode = "absolute-pitch";
    directory.writeText("manifest.json", JSON.stringify(manifest));
    await rememberDirectory(directory);

    await expect(syncBackupBeforeActivity({ requestPermission: true })).resolves.toMatchObject({ result: "synced-up" });

    await expect(db.settings.get("default")).resolves.toMatchObject({ answerPitchMode: "exact-pitch" });
    expect(
      (directory.readJson<BackupManifest>("manifest.json").settings as unknown as { answerPitchMode: string })
        .answerPitchMode,
    ).toBe("absolute-pitch");
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

  it("backs up a cross-day browser append during activity preflight", async () => {
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
      result: "synced-down",
      backupStateChanged: true,
    });
    const state = await db.backupStates.get("default");
    expect(Object.keys(state?.lastSeenBackupDayFileMetadata ?? {})).toEqual(["2026-07-04", "2026-07-05"]);
    directory.resetReadCounts();

    await expect(syncBackupBeforeActivity({ requestPermission: true })).resolves.toEqual({
      result: "ready",
      backupStateChanged: false,
    });
    expect(directory.child("days").totalReadCount()).toBe(0);
  });

  it("writes only the changed day after an established backup", async () => {
    const directory = new MemoryDirectoryHandle("backup");
    await seedBrowserData();
    await db.reviews.put(
      makeReview({
        id: "review-next-day",
        sessionId: "session-browser",
        targetNoteId: "D4",
        startedAt: "2026-07-05T10:00:00.000+08:00",
        answeredAt: "2026-07-05T10:00:02.000+08:00",
        endedAt: "2026-07-05T10:00:02.000+08:00",
      }),
    );
    await rememberDirectory(directory);
    await writeBackupNow();
    const firstManifest = directory.readJson<BackupManifest>("manifest.json");
    expect(firstManifest.dayFileDigests).toEqual({
      "2026-07-04": expect.stringMatching(/^sha256:[0-9a-f]{64}$/),
      "2026-07-05": expect.stringMatching(/^sha256:[0-9a-f]{64}$/),
    });

    await db.reviews.update("review-next-day", { activeMs: 1234 });
    directory.resetReadCounts();
    directory.resetWriteCounts();

    await writeBackupNow();

    const daysDirectory = directory.child("days");
    expect(daysDirectory.totalReadCount()).toBe(0);
    expect(daysDirectory.writeCount("2026-07-04.json")).toBe(0);
    expect(daysDirectory.writeCount("2026-07-05.json")).toBe(1);
    expect(directory.writeCount("manifest.json")).toBe(1);
  });

  it("rewrites an older day when its browser data changes", async () => {
    const directory = new MemoryDirectoryHandle("backup");
    await seedBrowserData();
    await db.reviews.put(
      makeReview({
        id: "review-next-day",
        sessionId: "session-browser",
        targetNoteId: "D4",
        startedAt: "2026-07-05T10:00:00.000+08:00",
        answeredAt: "2026-07-05T10:00:02.000+08:00",
        endedAt: "2026-07-05T10:00:02.000+08:00",
      }),
    );
    await rememberDirectory(directory);
    await writeBackupNow();
    await db.reviews.update("review-browser", { activeMs: 2345 });
    directory.resetWriteCounts();

    await writeBackupNow();

    const daysDirectory = directory.child("days");
    expect(daysDirectory.writeCount("2026-07-04.json")).toBe(1);
    expect(daysDirectory.writeCount("2026-07-05.json")).toBe(0);
  });

  it("establishes day digests with one full write for a legacy manifest", async () => {
    const directory = new MemoryDirectoryHandle("backup");
    await seedBrowserData();
    await rememberDirectory(directory);
    await writeBackupNow();
    const manifest = directory.readJson<BackupManifest>("manifest.json");
    delete manifest.dayFileDigests;
    directory.writeText("manifest.json", JSON.stringify(manifest));
    directory.resetReadCounts();
    directory.resetWriteCounts();

    await writeBackupNow();

    const daysDirectory = directory.child("days");
    expect(daysDirectory.totalReadCount()).toBe(0);
    expect(daysDirectory.writeCount("2026-07-04.json")).toBe(1);
    expect(directory.readJson<BackupManifest>("manifest.json").dayFileDigests).toEqual({
      "2026-07-04": expect.stringMatching(/^sha256:[0-9a-f]{64}$/),
    });
  });

  it("falls back to full inspection and writing after external day-file metadata changes", async () => {
    const directory = new MemoryDirectoryHandle("backup");
    await seedBrowserData();
    await rememberDirectory(directory);
    await writeBackupNow();
    const daysDirectory = directory.child("days");
    const dayText = daysDirectory.readText("2026-07-04.json");
    daysDirectory.writeText("2026-07-04.json", dayText);
    directory.resetReadCounts();
    directory.resetWriteCounts();

    await writeBackupNow();

    expect(daysDirectory.totalReadCount()).toBeGreaterThan(0);
    expect(daysDirectory.writeCount("2026-07-04.json")).toBe(1);
  });

  it("imports only changed days and applies record-level additions and deletions", async () => {
    const directory = new MemoryDirectoryHandle("backup");
    const { reviews, sessions, settings } = await seedBrowserData({ dataSetId: "dataset-shared" });
    const keptReview = makeReview({
      id: "review-kept",
      sessionId: sessions[0].id,
      targetNoteId: "D4",
      startedAt: "2026-07-05T10:00:00.000+08:00",
      answeredAt: "2026-07-05T10:00:02.000+08:00",
      endedAt: "2026-07-05T10:00:02.000+08:00",
    });
    const deletedReview = makeReview({
      id: "review-deleted",
      sessionId: sessions[0].id,
      targetNoteId: "E4",
      startedAt: "2026-07-05T10:30:00.000+08:00",
      answeredAt: "2026-07-05T10:30:02.000+08:00",
      endedAt: "2026-07-05T10:30:02.000+08:00",
    });
    await db.reviews.bulkPut([keptReview, deletedReview]);
    await rememberDirectory(directory);
    await writeBackupNow();

    const addedReview = makeReview({
      id: "review-added",
      sessionId: sessions[0].id,
      targetNoteId: "F4",
      startedAt: "2026-07-05T11:00:00.000+08:00",
      answeredAt: "2026-07-05T11:00:02.000+08:00",
      endedAt: "2026-07-05T11:00:02.000+08:00",
    });
    const updatedReview = { ...keptReview, activeMs: 1_234 };
    await writeBackupSnapshot(
      directory.handle(),
      buildBackupSnapshot(
        settings,
        sessions,
        [reviews[0], updatedReview, addedReview],
        "2099-01-01T00:00:00.000Z",
      ),
    );
    directory.resetReadCounts();
    const clearReviews = vi.spyOn(db.reviews, "clear");
    const deleteReviews = vi.spyOn(db.reviews, "bulkDelete");
    const putReviews = vi.spyOn(db.reviews, "bulkPut");

    const outcome = await syncBackupBeforeActivity({ requestPermission: true });

    expect(outcome.result).toBe("synced-up");
    expect(outcome.importedData?.reviews.map((review) => review.id)).toEqual([
      "review-browser",
      "review-kept",
      "review-added",
    ]);
    expect(directory.child("days").readCount("2026-07-04.json")).toBe(0);
    expect(directory.child("days").readCount("2026-07-05.json")).toBe(1);
    expect(clearReviews).not.toHaveBeenCalled();
    expect(deleteReviews).toHaveBeenCalledWith(["review-deleted"]);
    expect(putReviews).toHaveBeenCalledWith([updatedReview, addedReview]);
    await expect(db.reviews.orderBy("startedAt").toArray()).resolves.toEqual([reviews[0], updatedReview, addedReview]);
  });

  it("imports remote vocal audio changes with the whole snapshot", async () => {
    const directory = new MemoryDirectoryHandle("backup");
    await seedBrowserData({ dataSetId: "dataset-shared" });
    const localMaterial = await makeBackedVocalAudioMaterial("vocal-local");
    await db.vocalAudioMaterials.put(localMaterial);
    await rememberDirectory(directory);
    await writeBackupNow();
    const localBackupState = await db.backupStates.get("default");

    const remoteMaterial = await makeBackedVocalAudioMaterial("vocal-remote");
    await db.vocalAudioMaterials.clear();
    await db.vocalAudioMaterials.put(remoteMaterial);
    await writeBackupNow();

    await db.vocalAudioMaterials.clear();
    await db.vocalAudioMaterials.put(localMaterial);
    await db.backupStates.put({ ...localBackupState!, lastBackupAt: "2000-01-01T00:00:00.000Z" });

    const outcome = await syncBackupBeforeActivity({ requestPermission: true });

    expect(outcome.result).toBe("synced-up");
    await expect(db.vocalAudioMaterials.toArray()).resolves.toMatchObject([{ id: "vocal-remote" }]);
  });

  it("merges newer backup practice data with a local vocal audio change", async () => {
    const directory = new MemoryDirectoryHandle("backup");
    const { reviews, sessions, settings } = await seedBrowserData({ dataSetId: "dataset-shared" });
    await db.vocalAudioMaterials.put(makeVocalAudioMaterial("vocal-original", "recording"));
    await rememberDirectory(directory);
    await writeBackupNow();

    const localMaterial = makeVocalAudioMaterial("vocal-local-change", "recording");
    await db.vocalAudioMaterials.clear();
    await db.vocalAudioMaterials.put(localMaterial);
    const remoteReview = {
      ...reviews[0],
      answeredAt: "2099-01-01T00:00:02.000Z",
      endedAt: "2099-01-01T00:00:02.000Z",
      startedAt: "2099-01-01T00:00:00.000Z",
    };
    const remoteManifest = await writeBackupSnapshot(
      directory.handle(),
      buildBackupSnapshot(settings, sessions, [remoteReview], "2099-01-01T00:01:00.000Z"),
    );
    directory.writeText("manifest.json", JSON.stringify({
      ...remoteManifest,
      vocalAudioLibraryDigest: (await db.backupStates.get("default"))?.lastSeenVocalAudioLibraryDigest,
    }));

    await expect(syncBackupBeforeActivity({ requestPermission: true })).resolves.toMatchObject({
      result: "synced-up",
    });
    await expect(db.vocalAudioMaterials.toArray()).resolves.toMatchObject([{ id: localMaterial.id }]);
    await expect(db.reviews.toArray()).resolves.toMatchObject([{ endedAt: remoteReview.endedAt }]);
  });

  it("merges a local practice change with newer backup vocal audio", async () => {
    const directory = new MemoryDirectoryHandle("backup");
    const { reviews } = await seedBrowserData({ dataSetId: "dataset-shared" });
    const originalMaterial = await makeBackedVocalAudioMaterial("vocal-original");
    await db.vocalAudioMaterials.put(originalMaterial);
    await rememberDirectory(directory);
    await writeBackupNow();
    const localBackupState = await db.backupStates.get("default");

    const remoteMaterial = await makeBackedVocalAudioMaterial("vocal-remote");
    await db.vocalAudioMaterials.clear();
    await db.vocalAudioMaterials.put(remoteMaterial);
    await writeBackupNow();

    const localReview = {
      ...reviews[0],
      id: "review-local-change",
      answeredAt: "2099-01-01T00:00:02.000Z",
      endedAt: "2099-01-01T00:00:02.000Z",
      startedAt: "2099-01-01T00:00:00.000Z",
    };
    await db.reviews.put(localReview);
    await db.vocalAudioMaterials.clear();
    await db.vocalAudioMaterials.put(originalMaterial);
    await db.backupStates.put({ ...localBackupState!, lastBackupAt: "2000-01-01T00:00:00.000Z" });

    await expect(syncBackupBeforeActivity({ requestPermission: true })).resolves.toMatchObject({
      result: "synced-up",
    });
    await expect(db.reviews.get(localReview.id)).resolves.toMatchObject({ id: localReview.id });
    await expect(db.vocalAudioMaterials.toArray()).resolves.toMatchObject([{ id: remoteMaterial.id }]);
  });

  it("preserves local settings while importing newer backup vocal audio", async () => {
    const directory = new MemoryDirectoryHandle("backup");
    const { settings } = await seedBrowserData({ dataSetId: "dataset-shared" });
    const originalMaterial = await makeBackedVocalAudioMaterial("vocal-original");
    await db.vocalAudioMaterials.put(originalMaterial);
    await rememberDirectory(directory);
    await writeBackupNow();
    const baselineState = await db.backupStates.get("default");

    const remoteMaterial = await makeBackedVocalAudioMaterial("vocal-remote");
    await db.vocalAudioMaterials.clear();
    await db.vocalAudioMaterials.put(remoteMaterial);
    await writeBackupNow();

    await db.settings.put({ ...settings, pianoVolume: 0.21 });
    await db.vocalAudioMaterials.clear();
    await db.vocalAudioMaterials.put(originalMaterial);
    await db.backupStates.put(baselineState!);

    await expect(syncBackupBeforeActivity({ requestPermission: true })).resolves.toMatchObject({
      result: "synced-up",
    });
    await expect(db.settings.get("default")).resolves.toMatchObject({ pianoVolume: 0.21 });
    await expect(db.vocalAudioMaterials.toArray()).resolves.toMatchObject([{ id: remoteMaterial.id }]);
  });

  it("preserves a locally emptied learning domain while importing newer backup vocal audio", async () => {
    const directory = new MemoryDirectoryHandle("backup");
    await seedBrowserData({ dataSetId: "dataset-shared" });
    await rememberDirectory(directory);
    await writeBackupNow();
    const baselineState = await db.backupStates.get("default");

    const remoteMaterial = await makeBackedVocalAudioMaterial("vocal-remote");
    await db.vocalAudioMaterials.put(remoteMaterial);
    await writeBackupNow();

    await db.practiceSessions.clear();
    await db.reviews.clear();
    await db.staffRecallRuns.clear();
    await db.vocalAudioMaterials.clear();
    await db.backupStates.put(baselineState!);

    await expect(syncBackupBeforeActivity({ requestPermission: true })).resolves.toMatchObject({
      result: "synced-up",
    });
    await expect(db.practiceSessions.count()).resolves.toBe(0);
    await expect(db.reviews.count()).resolves.toBe(0);
    await expect(db.staffRecallRuns.count()).resolves.toBe(0);
    await expect(db.vocalAudioMaterials.toArray()).resolves.toMatchObject([{ id: remoteMaterial.id }]);
  });

  it("reports a conflict when local learning data is emptied and backup learning data changes", async () => {
    const directory = new MemoryDirectoryHandle("backup");
    const { sessions } = await seedBrowserData({ dataSetId: "dataset-shared" });
    await rememberDirectory(directory);
    await writeBackupNow();
    const baselineState = await db.backupStates.get("default");

    await db.reviews.put(
      makeReview({
        id: "review-remote",
        sessionId: sessions[0].id,
        targetNoteId: "D4",
        startedAt: "2026-07-05T11:00:00.000+08:00",
        answeredAt: "2026-07-05T11:00:02.000+08:00",
        endedAt: "2026-07-05T11:00:02.000+08:00",
      }),
    );
    await writeBackupNow();

    await db.practiceSessions.clear();
    await db.reviews.clear();
    await db.staffRecallRuns.clear();
    await db.backupStates.put(baselineState!);

    await expect(syncBackupBeforeActivity({ requestPermission: true })).resolves.toMatchObject({
      result: "data-conflict",
    });
    await expect(db.practiceSessions.count()).resolves.toBe(0);
    await expect(db.reviews.count()).resolves.toBe(0);
  });

  it("reports a conflict when local settings and backup learning records both change", async () => {
    const directory = new MemoryDirectoryHandle("backup");
    const { reviews, sessions, settings } = await seedBrowserData({ dataSetId: "dataset-shared" });
    const originalMaterial = await makeBackedVocalAudioMaterial("vocal-original");
    await db.vocalAudioMaterials.put(originalMaterial);
    await rememberDirectory(directory);
    await writeBackupNow();
    const baselineState = await db.backupStates.get("default");

    const remoteReview = makeReview({
      id: "review-remote",
      sessionId: sessions[0].id,
      targetNoteId: "D4",
      startedAt: "2026-07-05T11:00:00.000+08:00",
      answeredAt: "2026-07-05T11:00:02.000+08:00",
      endedAt: "2026-07-05T11:00:02.000+08:00",
    });
    await db.reviews.put(remoteReview);
    const remoteMaterial = await makeBackedVocalAudioMaterial("vocal-remote");
    await db.vocalAudioMaterials.clear();
    await db.vocalAudioMaterials.put(remoteMaterial);
    await writeBackupNow();

    await db.reviews.clear();
    await db.reviews.bulkPut(reviews);
    await db.settings.put({ ...settings, pianoVolume: 0.21 });
    await db.vocalAudioMaterials.clear();
    await db.vocalAudioMaterials.put(originalMaterial);
    await db.backupStates.put(baselineState!);

    await expect(syncBackupBeforeActivity({ requestPermission: true })).resolves.toMatchObject({
      result: "data-conflict",
    });
    await expect(db.backupStates.get("default")).resolves.toMatchObject({
      conflictLearningData: true,
      conflictVocalAudio: false,
    });
    await expect(db.settings.get("default")).resolves.toMatchObject({ pianoVolume: 0.21 });
    await expect(db.reviews.get(remoteReview.id)).resolves.toBeUndefined();

    await resolveBackupConflict({ learningData: "browser" });

    await expect(db.settings.get("default")).resolves.toMatchObject({ pianoVolume: 0.21 });
    await expect(db.reviews.get(remoteReview.id)).resolves.toBeUndefined();
    await expect(db.vocalAudioMaterials.toArray()).resolves.toMatchObject([{ id: remoteMaterial.id }]);
  });

  it("imports a remote vocal audio deletion", async () => {
    const directory = new MemoryDirectoryHandle("backup");
    await seedBrowserData({ dataSetId: "dataset-shared" });
    const originalMaterial = await makeBackedVocalAudioMaterial("vocal-original");
    await db.vocalAudioMaterials.put(originalMaterial);
    await rememberDirectory(directory);
    await writeBackupNow();
    const localBackupState = await db.backupStates.get("default");

    await db.vocalAudioMaterials.clear();
    await writeBackupNow();

    await db.vocalAudioMaterials.put(originalMaterial);
    await db.backupStates.put({ ...localBackupState!, lastBackupAt: "2000-01-01T00:00:00.000Z" });

    await expect(syncBackupBeforeActivity({ requestPermission: true })).resolves.toMatchObject({ result: "synced-up" });
    await expect(db.vocalAudioMaterials.count()).resolves.toBe(0);
  });

  it("requires a vocal-domain choice before applying an older vocal snapshot", async () => {
    const directory = new MemoryDirectoryHandle("backup");
    await seedBrowserData({ dataSetId: "dataset-shared" });
    const originalMaterial = await makeBackedVocalAudioMaterial("vocal-original");
    await db.vocalAudioMaterials.put(originalMaterial);
    await rememberDirectory(directory);
    await writeBackupNow();
    const baselineState = await db.backupStates.get("default");

    const olderMaterial = await makeBackedVocalAudioMaterial("vocal-older");
    await db.vocalAudioMaterials.clear();
    await db.vocalAudioMaterials.put(olderMaterial);
    await writeBackupNow();
    const olderManifest = directory.readJson<BackupManifest>("manifest.json");
    directory.writeText("manifest.json", JSON.stringify({
      ...olderManifest,
      lastBackupAt: "2000-01-01T00:00:00.000Z",
    }));

    await db.vocalAudioMaterials.clear();
    await db.vocalAudioMaterials.put(originalMaterial);
    await db.backupStates.put(baselineState!);

    await expect(syncBackupBeforeActivity({ requestPermission: true })).resolves.toMatchObject({
      result: "data-conflict",
    });
    await expect(db.backupStates.get("default")).resolves.toMatchObject({
      conflictLearningData: false,
      conflictVocalAudio: true,
    });
    await expect(db.vocalAudioMaterials.toArray()).resolves.toMatchObject([{ id: originalMaterial.id }]);
  });

  it("backs up a local vocal audio deletion as the next library version", async () => {
    const directory = new MemoryDirectoryHandle("backup");
    await seedBrowserData({ dataSetId: "dataset-shared" });
    await db.vocalAudioMaterials.put(await makeBackedVocalAudioMaterial("vocal-original"));
    await rememberDirectory(directory);
    await writeBackupNow();

    await db.vocalAudioMaterials.clear();
    await writeBackupNow();

    expect(directory.child("audio").readJson<{ materials: unknown[] }>("index.json").materials).toEqual([]);
    await expect(db.backupStates.get("default")).resolves.toMatchObject({
      dataConflictBeforeBackup: false,
      syncRequiredBeforeBackup: false,
    });
  });

  it("writes a local settings change during the next activity preflight", async () => {
    const directory = new MemoryDirectoryHandle("backup");
    const { settings } = await seedBrowserData({ dataSetId: "dataset-shared" });
    await rememberDirectory(directory);
    await writeBackupNow();

    await db.settings.put({ ...settings, pianoVolume: 0.21 });

    await expect(syncBackupBeforeActivity({ requestPermission: true })).resolves.toMatchObject({
      result: "synced-down",
    });
    expect(directory.readJson<BackupManifest>("manifest.json").settings).toMatchObject({ pianoVolume: 0.21 });
  });

  it("writes a local vocal audio deletion during the next activity preflight", async () => {
    const directory = new MemoryDirectoryHandle("backup");
    await seedBrowserData({ dataSetId: "dataset-shared" });
    await db.vocalAudioMaterials.put(await makeBackedVocalAudioMaterial("vocal-original"));
    await rememberDirectory(directory);
    await writeBackupNow();

    await db.vocalAudioMaterials.clear();

    await expect(syncBackupBeforeActivity({ requestPermission: true })).resolves.toMatchObject({
      result: "synced-down",
    });
    expect(directory.child("audio").readJson<{ materials: unknown[] }>("index.json").materials).toEqual([]);
  });

  it("resolves learning and vocal audio conflicts from different sources", async () => {
    const directory = new MemoryDirectoryHandle("backup");
    const { reviews } = await seedBrowserData({ dataSetId: "dataset-shared" });
    const originalMaterial = await makeBackedVocalAudioMaterial("vocal-original");
    await db.vocalAudioMaterials.put(originalMaterial);
    await rememberDirectory(directory);
    await writeBackupNow();
    const baselineState = await db.backupStates.get("default");

    const remoteReview = {
      ...reviews[0],
      answeredAt: "2099-01-01T00:00:02.000Z",
      endedAt: "2099-01-01T00:00:03.000Z",
    };
    const remoteMaterial = await makeBackedVocalAudioMaterial("vocal-remote");
    await db.reviews.put(remoteReview);
    await db.vocalAudioMaterials.clear();
    await db.vocalAudioMaterials.put(remoteMaterial);
    await writeBackupNow();

    const localReview = {
      ...reviews[0],
      answeredAt: "2088-01-01T00:00:02.000Z",
      endedAt: "2088-01-01T00:00:03.000Z",
    };
    const localMaterial = await makeBackedVocalAudioMaterial("vocal-local");
    await db.reviews.put(localReview);
    await db.vocalAudioMaterials.clear();
    await db.vocalAudioMaterials.put(localMaterial);
    await db.backupStates.put(baselineState!);

    await expect(syncBackupBeforeActivity({ requestPermission: true })).resolves.toMatchObject({
      result: "data-conflict",
    });
    const conflictState = await db.backupStates.get("default");
    expect(conflictState).toMatchObject({
      conflictLearningData: true,
      conflictVocalAudio: true,
    });

    const revisedLocalMaterial = {
      ...localMaterial,
      name: "本地冲突期间修改",
      updatedAt: "2099-01-02T00:00:00.000Z",
    };
    await db.vocalAudioMaterials.put(revisedLocalMaterial);
    await expect(resolveBackupConflict({ learningData: "backup", vocalAudio: "browser" })).rejects.toThrow(
      backupText.messages.conflictChanged,
    );
    expect((await db.backupStates.get("default"))?.conflictRevision).not.toEqual(conflictState?.conflictRevision);

    await resolveBackupConflict({ learningData: "backup", vocalAudio: "browser" });

    await expect(db.reviews.get(remoteReview.id)).resolves.toMatchObject({ endedAt: remoteReview.endedAt });
    await expect(db.vocalAudioMaterials.toArray()).resolves.toMatchObject([
      { id: revisedLocalMaterial.id, name: revisedLocalMaterial.name },
    ]);
    await expect(db.backupStates.get("default")).resolves.toMatchObject({
      dataConflictBeforeBackup: false,
      syncRequiredBeforeBackup: false,
    });
  });

  it("incrementally imports a newer deletion-only snapshot but rejects an older rollback", async () => {
    const directory = new MemoryDirectoryHandle("backup");
    const { reviews, sessions, settings } = await seedBrowserData({ dataSetId: "dataset-shared" });
    const emptySession = makeSession({
      id: "session-empty",
      startedAt: "2026-07-06T10:00:00.000+08:00",
      endedAt: "2026-07-06T10:01:00.000+08:00",
    });
    await db.practiceSessions.put(emptySession);
    await rememberDirectory(directory);
    await writeBackupNow();
    const previousManifest = directory.readJson<BackupManifest>("manifest.json");

    await writeBackupSnapshot(
      directory.handle(),
      buildBackupSnapshot(settings, sessions, reviews, "2099-01-01T00:00:00.000Z"),
    );
    const deletionManifest = directory.readJson<BackupManifest>("manifest.json");
    expect(deletionManifest.dataModifiedAt!.localeCompare(previousManifest.dataModifiedAt!)).toBeLessThan(0);
    const clearSessions = vi.spyOn(db.practiceSessions, "clear");
    const deleteSessions = vi.spyOn(db.practiceSessions, "bulkDelete");

    await expect(syncBackupBeforeActivity({ requestPermission: true })).resolves.toMatchObject({ result: "synced-up" });

    expect(clearSessions).not.toHaveBeenCalled();
    expect(deleteSessions).toHaveBeenCalledWith(["session-empty"]);
    await expect(db.practiceSessions.get("session-empty")).resolves.toBeUndefined();

    await writeBackupSnapshot(
      directory.handle(),
      buildBackupSnapshot(settings, [emptySession, ...sessions], reviews, "2000-01-01T00:00:00.000Z"),
    );
    const rollbackManifest = directory.readJson<BackupManifest>("manifest.json");
    expect(rollbackManifest.dataModifiedAt!.localeCompare(deletionManifest.dataModifiedAt!)).toBeGreaterThan(0);

    await expect(syncBackupBeforeActivity({ requestPermission: true })).resolves.toMatchObject({
      result: "data-conflict",
    });
    expect(clearSessions).not.toHaveBeenCalled();
    await expect(db.practiceSessions.get("session-empty")).resolves.toBeUndefined();
  });

  it("keeps a newer empty snapshot ready and blocks an older backup-only rollback", async () => {
    const directory = new MemoryDirectoryHandle("backup");
    const { reviews, sessions, settings } = await seedBrowserData({ dataSetId: "dataset-shared" });
    await rememberDirectory(directory);
    await writeBackupNow();

    await writeBackupSnapshot(
      directory.handle(),
      buildBackupSnapshot(settings, [], [], "2099-01-01T00:00:00.000Z"),
    );
    const emptyManifest = directory.readJson<BackupManifest>("manifest.json");

    await expect(syncBackupBeforeActivity({ requestPermission: true })).resolves.toMatchObject({ result: "synced-up" });
    await expect(db.practiceSessions.count()).resolves.toBe(0);
    await expect(db.reviews.count()).resolves.toBe(0);
    await expect(syncBackupBeforeActivity({ requestPermission: true })).resolves.toEqual({
      result: "synced-down",
      backupStateChanged: true,
    });

    await writeBackupSnapshot(
      directory.handle(),
      buildBackupSnapshot(settings, sessions, reviews, "2000-01-01T00:00:00.000Z"),
    );
    const rollbackManifest = directory.readJson<BackupManifest>("manifest.json");
    expect(rollbackManifest.dataModifiedAt!.localeCompare(emptyManifest.dataModifiedAt!)).toBeGreaterThan(0);

    await expect(syncBackupBeforeActivity({ requestPermission: true })).resolves.toMatchObject({
      result: "data-conflict",
    });
    await expect(db.practiceSessions.count()).resolves.toBe(0);
    await expect(db.reviews.count()).resolves.toBe(0);
  });

  it("reports a conflict when browser and backup learning records both change", async () => {
    const directory = new MemoryDirectoryHandle("backup");
    const { reviews, sessions, settings } = await seedBrowserData({ dataSetId: "dataset-shared" });
    await rememberDirectory(directory);
    await writeBackupNow();
    await db.reviews.update(reviews[0].id, { activeMs: 1_234 });

    const addedReview = makeReview({
      id: "review-added",
      sessionId: sessions[0].id,
      targetNoteId: "D4",
      startedAt: "2026-07-05T11:00:00.000+08:00",
      answeredAt: "2026-07-05T11:00:02.000+08:00",
      endedAt: "2026-07-05T11:00:02.000+08:00",
    });
    await writeBackupSnapshot(
      directory.handle(),
      buildBackupSnapshot(settings, sessions, [reviews[0], addedReview], "2099-01-01T00:00:00.000Z"),
    );
    directory.resetReadCounts();
    const clearReviews = vi.spyOn(db.reviews, "clear");

    await expect(syncBackupBeforeActivity({ requestPermission: true })).resolves.toMatchObject({
      result: "data-conflict",
    });

    expect(clearReviews).not.toHaveBeenCalled();
    expect(directory.child("days").readCount("2026-07-04.json")).toBe(1);
    expect(directory.child("days").readCount("2026-07-05.json")).toBe(1);
    await expect(db.reviews.get(reviews[0].id)).resolves.toMatchObject({ activeMs: 1_234 });
    await expect(db.reviews.get(addedReview.id)).resolves.toBeUndefined();
  });

  it("reads day files when an established backup manifest changes externally", async () => {
    const directory = new MemoryDirectoryHandle("backup");
    await seedBrowserData({ dataSetId: "dataset-shared" });
    await rememberDirectory(directory);
    await writeBackupNow();
    await seedBackupDirectory(directory, {
      backupAt: "2099-01-01T00:00:00.000Z",
      dataSetId: "dataset-shared",
      reviewEndedAt: "2026-07-05T10:00:02.000+08:00",
    });
    directory.resetReadCounts();

    await expect(syncBackupBeforeActivity({ requestPermission: true })).resolves.toMatchObject({ result: "synced-up" });

    expect(directory.child("days").totalReadCount()).toBeGreaterThan(0);
    await expect(db.reviews.toArray()).resolves.toMatchObject([{ id: "review-backup" }]);
  });

  it("requires a choice for a legacy backup with no shared baseline", async () => {
    const directory = new MemoryDirectoryHandle("backup");
    await seedBrowserData({
      dataSetId: "dataset-shared",
      reviewEndedAt: "2026-07-04T10:00:02.000+08:00",
    });
    await seedBackupDirectory(directory, {
      dataSetId: "dataset-shared",
      reviewEndedAt: "2026-07-05T10:00:02.000+08:00",
    });
    const legacyManifest = directory.readJson<BackupManifest>("manifest.json");
    delete legacyManifest.learningDataDigest;
    directory.writeText("manifest.json", JSON.stringify(legacyManifest));
    await rememberDirectory(directory);
    directory.resetReadCounts();

    await expect(syncBackupBeforeActivity({ requestPermission: true })).resolves.toMatchObject({
      result: "data-conflict",
    });

    expect(directory.child("days").readCount("2026-07-05.json")).toBe(1);
    await expect(db.reviews.toArray()).resolves.toMatchObject([{ id: "review-browser" }]);
    await expect(db.backupStates.get("default")).resolves.toMatchObject({
      dataConflictBeforeBackup: true,
      syncRequiredBeforeBackup: true,
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
    await db.vocalAudioMaterials.bulkPut([
      makeVocalAudioMaterial("browser-recording-1", "recording"),
      makeVocalAudioMaterial("browser-recording-2", "recording"),
      makeVocalAudioMaterial("browser-upload", "upload"),
    ]);
    const backupMaterials = [
      makeVocalAudioMaterial("backup-recording", "recording"),
      makeVocalAudioMaterial("backup-upload", "upload"),
    ];
    const audioDirectory = (await directory.getDirectoryHandle("audio", { create: true })) as unknown as MemoryDirectoryHandle;
    audioDirectory.writeText(
      "index.json",
      JSON.stringify({
        schemaVersion: 1,
        updatedAt: "2026-07-05T12:00:00.000+08:00",
        materials: backupMaterials.map(({ analysis: _analysis, audioBlob: _audioBlob, schemaVersion: _schemaVersion, ...material }) => ({
          ...material,
          audioFileName: `${material.id}.webm`,
        })),
      }),
    );
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
      conflictBackupVocalAudioCounts: { materialCount: 2, recordingCount: 1, uploadCount: 1 },
      conflictBrowserFirstDataAt: "2026-07-04T10:00:00.000+08:00",
      conflictBrowserLastDataAt: "2026-07-04T10:00:02.000+08:00",
      conflictBrowserRecordCount: 1,
      conflictBrowserReviewCount: 1,
      conflictBrowserStaffRecallRunCount: 0,
      conflictBrowserVocalAudioCounts: { materialCount: 3, recordingCount: 2, uploadCount: 1 },
      dataConflictBeforeBackup: true,
      lastError: backupText.messages.dataConflictBeforeBackup,
      syncRequiredBeforeBackup: true,
    });
  });
});
