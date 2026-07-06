import { buildBackupSnapshot, getBackupManifestVersion } from "../domain/backupSnapshot";
import { backupText } from "../domain/backupText";
import { deriveBackupSyncState } from "../domain/backupSync";
import { normalizePracticeGroupIds } from "../domain/notes";
import type { AppSettings, BackupDayFile, BackupManifest, BackupSnapshot, BackupState, PracticeSessionRecord, ReviewRecord } from "../domain/types";
import {
  db,
  getBackupState,
  loadAllData,
  makeDefaultSettings,
  replaceAllData,
  resolveDrillNoteNames,
  resolveQueueStrategy,
} from "./db";

type StoredBackupState = BackupState & { restoreRequiredBeforeBackup?: boolean };

export type BackupPreflightResult = "import-required" | "imported" | "ready" | "skipped";

function cleanBackupState(state: BackupState): BackupState {
  const { restoreRequiredBeforeBackup: _restoreRequiredBeforeBackup, ...currentState } = state as StoredBackupState;
  return currentState;
}

function syncRequiredBeforeBackup(state: BackupState): boolean {
  const stored = state as StoredBackupState;
  return Boolean(state.syncRequiredBeforeBackup ?? stored.restoreRequiredBeforeBackup);
}

function makeBackupSyncInput({
  supportsFileBackups,
  hasDirectoryHandle,
  settings,
  sessions,
  reviews,
  backupManifest,
  lastSeenBackupVersion,
}: {
  supportsFileBackups: boolean;
  hasDirectoryHandle: boolean;
  settings: AppSettings;
  sessions: PracticeSessionRecord[];
  reviews: ReviewRecord[];
  backupManifest: BackupManifest | null;
  lastSeenBackupVersion?: string;
}): Parameters<typeof deriveBackupSyncState>[0] {
  const backupVersion = backupManifest ? getBackupManifestVersion(backupManifest) : undefined;
  return {
    supportsFileBackups,
    hasDirectoryHandle,
    reminderSuppressedToday: false,
    hasBrowserPracticeData: sessions.length > 0 || reviews.length > 0,
    hasBackupManifest: Boolean(backupManifest),
    backupMatchesBrowserDataSet: !backupManifest || backupManifest.dataSetId === settings.dataSetId,
    hasLastSeenBackupVersion: Boolean(lastSeenBackupVersion),
    backupVersionMatchesLastSeen: Boolean(backupVersion && lastSeenBackupVersion === backupVersion),
  };
}

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

async function hasReadWritePermission(handle: FileSystemDirectoryHandle, requestPermission: boolean): Promise<boolean> {
  if (!handle.queryPermission || !handle.requestPermission) {
    return true;
  }
  const descriptor = { mode: "readwrite" as const };
  const current = await handle.queryPermission(descriptor);
  if (current === "granted") {
    return true;
  }
  if (!requestPermission) {
    return false;
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

async function fileExists(directory: FileSystemDirectoryHandle, filename: string): Promise<boolean> {
  try {
    await directory.getFileHandle(filename);
    return true;
  } catch (error) {
    if (error instanceof DOMException && error.name === "NotFoundError") {
      return false;
    }
    throw error;
  }
}

async function readBackupManifestIfExists(directory: FileSystemDirectoryHandle): Promise<BackupManifest | null> {
  if (!(await fileExists(directory, "manifest.json"))) {
    return null;
  }
  return readJson<BackupManifest>(directory, "manifest.json");
}

export function supportsFileBackups(): boolean {
  return typeof window !== "undefined" && typeof window.showDirectoryPicker === "function";
}

export async function preflightBackupDirectory({
  requestPermission = false,
}: {
  requestPermission?: boolean;
} = {}): Promise<BackupPreflightResult> {
  const state = await getBackupState();
  if (!state.directoryHandle) {
    return "skipped";
  }
  if (syncRequiredBeforeBackup(state)) {
    return "import-required";
  }
  if (!(await hasReadWritePermission(state.directoryHandle, requestPermission))) {
    return "skipped";
  }

  const [{ settings, sessions, reviews }, existingManifest] = await Promise.all([
    loadAllData(),
    readBackupManifestIfExists(state.directoryHandle),
  ]);
  if (!existingManifest) {
    return "ready";
  }

  const hasBrowserPracticeData = sessions.length > 0 || reviews.length > 0;
  if (!hasBrowserPracticeData) {
    const snapshot = await readBackupSnapshot(state.directoryHandle);
    await replaceAllData(snapshot.settings, snapshot.sessions, snapshot.reviews);
    await db.backupStates.put({
      ...cleanBackupState(state),
      syncRequiredBeforeBackup: false,
      lastSeenBackupVersion: getBackupManifestVersion(snapshot.manifest),
      lastBackupAt: snapshot.manifest.lastBackupAt,
      lastBackupReviewId: snapshot.manifest.lastReviewId,
      lastError: undefined,
    });
    return "imported";
  }

  const backupSyncState = deriveBackupSyncState(
    makeBackupSyncInput({
      supportsFileBackups: true,
      hasDirectoryHandle: true,
      settings,
      sessions,
      reviews,
      backupManifest: existingManifest,
      lastSeenBackupVersion: state.lastSeenBackupVersion,
    }),
  );
  if (backupSyncState.canWriteBackup) {
    return "ready";
  }

  await db.backupStates.put({
    ...cleanBackupState(state),
    syncRequiredBeforeBackup: true,
    lastSeenBackupVersion: undefined,
    lastError: backupText.messages.backupDirectoryChanged,
  });
  return "import-required";
}

export async function chooseBackupDirectory(): Promise<void> {
  if (!window.showDirectoryPicker) {
    throw new Error(backupText.errors.unsupportedDirectoryPicker);
  }
  const handle = await window.showDirectoryPicker({ id: "anki-note-backup", mode: "readwrite" });
  const granted = await ensureReadWritePermission(handle);
  if (!granted) {
    throw new Error(backupText.errors.writePermissionDenied);
  }
  const state = await getBackupState();
  const [{ settings, sessions, reviews }, existingManifest] = await Promise.all([loadAllData(), readBackupManifestIfExists(handle)]);
  const hasBrowserPracticeData = sessions.length > 0 || reviews.length > 0;
  if (existingManifest && !hasBrowserPracticeData) {
    const snapshot = await readBackupSnapshot(handle);
    await replaceAllData(snapshot.settings, snapshot.sessions, snapshot.reviews);
    await db.backupStates.put({
      ...cleanBackupState(state),
      id: "default",
      schemaVersion: 1,
      directoryHandle: handle,
      directoryName: handle.name,
      syncRequiredBeforeBackup: false,
      lastSeenBackupVersion: getBackupManifestVersion(snapshot.manifest),
      lastBackupAt: snapshot.manifest.lastBackupAt,
      lastBackupReviewId: snapshot.manifest.lastReviewId,
      lastError: undefined,
    });
    return;
  }
  const backupVersion = existingManifest ? getBackupManifestVersion(existingManifest) : undefined;
  const backupSyncState = deriveBackupSyncState(
    makeBackupSyncInput({
      supportsFileBackups: true,
      hasDirectoryHandle: true,
      settings,
      sessions,
      reviews,
      backupManifest: existingManifest,
      lastSeenBackupVersion: state.lastSeenBackupVersion,
    }),
  );
  const requiresSync = backupSyncState.kind === "sync-before-backup";
  const initialBackup =
    !existingManifest && hasBrowserPracticeData
      ? buildBackupSnapshot(settings, sessions, reviews, new Date().toISOString())
      : null;
  if (initialBackup) {
    await writeBackupSnapshot(handle, initialBackup);
  }
  const selectedBackupVersion = initialBackup ? getBackupManifestVersion(initialBackup.manifest) : backupVersion;
  await db.backupStates.put({
    ...cleanBackupState(state),
    id: "default",
    schemaVersion: 1,
    directoryHandle: handle,
    directoryName: handle.name,
    syncRequiredBeforeBackup: requiresSync,
    lastSeenBackupVersion: requiresSync ? undefined : selectedBackupVersion,
    lastBackupAt: initialBackup?.manifest.lastBackupAt ?? state.lastBackupAt,
    lastBackupReviewId: initialBackup?.manifest.lastReviewId ?? state.lastBackupReviewId,
    lastError: undefined,
  });
}

export async function writeBackupNow(): Promise<void> {
  const state = await getBackupState();
  if (!state.directoryHandle) {
    return;
  }
  if (syncRequiredBeforeBackup(state)) {
    throw new Error(backupText.messages.importRequiredBeforeBackup);
  }

  const now = new Date().toISOString();
  try {
    const granted = await ensureReadWritePermission(state.directoryHandle);
    if (!granted) {
      throw new Error(backupText.errors.permissionExpired);
    }
    const { settings, sessions, reviews } = await loadAllData();
    const existingManifest = await readBackupManifestIfExists(state.directoryHandle);
    const backupSyncState = deriveBackupSyncState(
      makeBackupSyncInput({
        supportsFileBackups: true,
        hasDirectoryHandle: true,
        settings,
        sessions,
        reviews,
        backupManifest: existingManifest,
        lastSeenBackupVersion: state.lastSeenBackupVersion,
      }),
    );
    if (!backupSyncState.canWriteBackup) {
      await db.backupStates.put({
        ...cleanBackupState(state),
        syncRequiredBeforeBackup: true,
        lastSeenBackupVersion: undefined,
        lastError: backupText.messages.backupDirectoryChanged,
      });
      throw new Error(backupText.messages.backupDirectoryChanged);
    }
    const snapshot = buildBackupSnapshot(settings, sessions, reviews, now);
    await writeBackupSnapshot(state.directoryHandle, snapshot);
    await db.backupStates.put({
      ...cleanBackupState(state),
      syncRequiredBeforeBackup: false,
      lastSeenBackupVersion: getBackupManifestVersion(snapshot.manifest),
      lastBackupAt: now,
      lastBackupReviewId: snapshot.manifest.lastReviewId,
      lastError: undefined,
    });
  } catch (error) {
    const latestState = await getBackupState();
    await db.backupStates.put({
      ...cleanBackupState(latestState),
      lastError: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}

export async function writeBackupSnapshot(directory: FileSystemDirectoryHandle, snapshot: BackupSnapshot): Promise<void> {
  const daysDirectory = await directory.getDirectoryHandle("days", { create: true });
  for (const [date, day] of Object.entries(snapshot.days)) {
    await writeJson(daysDirectory, `${date}.json`, day);
  }
  await writeJson(directory, "manifest.json", snapshot.manifest);
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
  const baseSettings = manifest.settings ?? existingSettings ?? makeDefaultSettings();
  const settings: AppSettings = {
    ...baseSettings,
    dataSetId: manifest.dataSetId,
    createdAt: manifest.createdAt,
    firstReviewAt: manifest.firstReviewAt,
    enabledGroupIds: normalizePracticeGroupIds(baseSettings.enabledGroupIds ?? []),
    includeLedgerVariants: baseSettings.includeLedgerVariants ?? true,
    queueStrategy: resolveQueueStrategy(baseSettings),
    drillNoteNames: resolveDrillNoteNames(baseSettings),
    focusedTraining: baseSettings.focusedTraining ?? resolveQueueStrategy(baseSettings) === "focused",
    promptDisplayMode: baseSettings.promptDisplayMode ?? "staff-page",
    promptNoteDuration: baseSettings.promptNoteDuration ?? "quarter",
  };
  return { manifest, settings, sessions, reviews };
}

export async function restoreBackupFromDirectory(directory: FileSystemDirectoryHandle): Promise<void> {
  const granted = await ensureReadWritePermission(directory);
  if (!granted) {
    throw new Error(backupText.errors.readPermissionDenied);
  }
  const manifest = await readBackupManifestIfExists(directory);
  if (!manifest) {
    throw new Error(backupText.messages.emptyBackupDirectory);
  }
  const snapshot = await readBackupSnapshot(directory);
  await replaceAllData(snapshot.settings, snapshot.sessions, snapshot.reviews);
  const state = await getBackupState();
  await db.backupStates.put({
    ...cleanBackupState(state),
    directoryHandle: state.directoryHandle ?? directory,
    directoryName: state.directoryName ?? directory.name,
    syncRequiredBeforeBackup: false,
    lastSeenBackupVersion: getBackupManifestVersion(snapshot.manifest),
    lastBackupAt: snapshot.manifest.lastBackupAt,
    lastBackupReviewId: snapshot.manifest.lastReviewId,
    lastError: undefined,
  });
}
