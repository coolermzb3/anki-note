import { buildBackupSnapshot } from "../domain/backupSnapshot";
import type { AppSettings, BackupDayFile, BackupManifest, BackupSnapshot, PracticeSessionRecord, ReviewRecord } from "../domain/types";
import { db, getBackupState, loadAllData, replaceAllData } from "./db";

async function ensureReadWritePermission(handle: FileSystemDirectoryHandle): Promise<boolean> {
  if (!handle.queryPermission || !handle.requestPermission) {
    return true;
  }
  const descriptor = { mode: "readwrite" as const };
  const current = await handle.queryPermission(descriptor);
  if (current === "granted") {
    return true;
  }
  return (await handle.requestPermission(descriptor)) === "granted";
}

async function writeJson(directory: FileSystemDirectoryHandle, filename: string, value: unknown): Promise<void> {
  const handle = await directory.getFileHandle(filename, { create: true });
  const writable = await handle.createWritable();
  await writable.write(JSON.stringify(value, null, 2));
  await writable.close();
}

async function readJson<T>(directory: FileSystemDirectoryHandle, filename: string): Promise<T> {
  const handle = await directory.getFileHandle(filename);
  const file = await handle.getFile();
  return JSON.parse(await file.text()) as T;
}

export function supportsFileBackups(): boolean {
  return typeof window !== "undefined" && typeof window.showDirectoryPicker === "function";
}

export async function chooseBackupDirectory(): Promise<void> {
  if (!window.showDirectoryPicker) {
    throw new Error("当前浏览器不支持选择备份目录。");
  }
  const handle = await window.showDirectoryPicker({ id: "anki-note-backup", mode: "readwrite" });
  const granted = await ensureReadWritePermission(handle);
  if (!granted) {
    throw new Error("未获得备份目录写入权限。");
  }
  await db.backupStates.put({
    id: "default",
    schemaVersion: 1,
    directoryHandle: handle,
    directoryName: handle.name,
    lastError: undefined,
  });
}

export async function writeBackupNow(): Promise<void> {
  const state = await getBackupState();
  if (!state.directoryHandle) {
    return;
  }

  const now = new Date().toISOString();
  try {
    const granted = await ensureReadWritePermission(state.directoryHandle);
    if (!granted) {
      throw new Error("备份目录权限已失效。");
    }
    const { settings, sessions, reviews } = await loadAllData();
    const snapshot = buildBackupSnapshot(settings, sessions, reviews, now);
    await writeBackupSnapshot(state.directoryHandle, snapshot);
    await db.backupStates.put({
      ...state,
      lastBackupAt: now,
      lastBackupReviewId: snapshot.manifest.lastReviewId,
      lastError: undefined,
    });
  } catch (error) {
    await db.backupStates.put({
      ...state,
      lastError: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}

export async function writeBackupSnapshot(directory: FileSystemDirectoryHandle, snapshot: BackupSnapshot): Promise<void> {
  await writeJson(directory, "manifest.json", snapshot.manifest);
  const daysDirectory = await directory.getDirectoryHandle("days", { create: true });
  for (const [date, day] of Object.entries(snapshot.days)) {
    await writeJson(daysDirectory, `${date}.json`, day);
  }
}

export async function readBackupSnapshot(directory: FileSystemDirectoryHandle): Promise<{
  manifest: BackupManifest;
  settings: AppSettings;
  sessions: PracticeSessionRecord[];
  reviews: ReviewRecord[];
}> {
  const manifest = await readJson<BackupManifest>(directory, "manifest.json");
  const daysDirectory = await directory.getDirectoryHandle("days");
  const dayFiles = await Promise.all(manifest.dates.map((date) => readJson<BackupDayFile>(daysDirectory, `${date}.json`)));
  const sessions = dayFiles.flatMap((day) => day.sessions);
  const reviews = dayFiles.flatMap((day) => day.reviews);
  const existingSettings = await db.settings.get("default");
  const settings: AppSettings = {
    ...(existingSettings ?? {
      id: "default",
      schemaVersion: 1,
      dataSetId: manifest.dataSetId,
      createdAt: manifest.createdAt,
      enabledGroupIds: ["C4-B4"],
      defaultMode: "open-ended",
      fixedCount: 20,
      fixedDurationSeconds: 180,
      autoPlayTarget: true,
      includeLedgerVariants: true,
      focusedTraining: false,
      inactivityThresholdSeconds: 30,
      correctDelayMs: 400,
    }),
    dataSetId: manifest.dataSetId,
    createdAt: manifest.createdAt,
    firstReviewAt: manifest.firstReviewAt,
    includeLedgerVariants: existingSettings?.includeLedgerVariants ?? true,
    focusedTraining: existingSettings?.focusedTraining ?? false,
  };
  return { manifest, settings, sessions, reviews };
}

export async function restoreBackupFromDirectory(directory: FileSystemDirectoryHandle): Promise<void> {
  const granted = await ensureReadWritePermission(directory);
  if (!granted) {
    throw new Error("未获得备份目录读取权限。");
  }
  const snapshot = await readBackupSnapshot(directory);
  await replaceAllData(snapshot.settings, snapshot.sessions, snapshot.reviews);
}
