import { buildBackupSnapshot, getBackupDataModifiedAt, getBackupManifestVersion } from "../domain/backupSnapshot";
import { deriveBackupDataStatus, type BackupDataStatus } from "../domain/backupSync";
import { backupText } from "../domain/backupText";
import { normalizePracticeGroupIds } from "../domain/notes";
import { normalizePianoVolume } from "../domain/settings";
import type {
  AppSettings,
  BackupDayFile,
  BackupManifest,
  BackupSnapshot,
  BackupState,
  PracticeSessionRecord,
  ReviewRecord,
  StaffRecallRunRecord,
} from "../domain/types";
import {
  db,
  getBackupState,
  loadAllData,
  makeDefaultSettings,
  replaceAllData,
  resolveDrillNoteNames,
  resolveQueueStrategy,
} from "./db";

type LegacyBackupState = BackupState & { restoreRequiredBeforeBackup?: boolean; syncRequiredReason?: unknown };

interface BrowserData {
  settings: AppSettings;
  sessions: PracticeSessionRecord[];
  reviews: ReviewRecord[];
  staffRecallRuns: StaffRecallRunRecord[];
}

interface BackupStatusInspection {
  data: BrowserData;
  browserSummary: DataSummary;
  backupSummary?: DataSummary;
  browserModifiedAt: string;
  backupModifiedAt?: string;
  manifest: BackupManifest | null;
  status: BackupDataStatus;
}

export type BackupDirectorySelectionResult = "ready" | "synced-down" | "synced-up" | "diverged";
export type BackupPreflightResult =
  | "needs-directory"
  | "ready"
  | "synced-down"
  | "synced-up"
  | "data-conflict"
  | "skipped";

interface DataSummary {
  firstDataAt?: string;
  lastDataAt?: string;
  recordCount: number;
  reviewCount: number;
  staffRecallRunCount: number;
}

function cleanBackupState(state: BackupState): BackupState {
  const {
    restoreRequiredBeforeBackup: _restoreRequiredBeforeBackup,
    syncRequiredReason: _syncRequiredReason,
    ...currentState
  } = state as LegacyBackupState;
  return currentState;
}

function explicitDataConflict(state: BackupState): boolean {
  const stored = state as LegacyBackupState;
  return Boolean(state.dataConflictBeforeBackup ?? state.syncRequiredBeforeBackup ?? stored.restoreRequiredBeforeBackup);
}

function conflictDetailsMissing(state: BackupState): boolean {
  return (
    state.conflictBrowserReviewCount === undefined ||
    state.conflictBackupReviewCount === undefined ||
    state.conflictBrowserStaffRecallRunCount === undefined ||
    state.conflictBackupStaffRecallRunCount === undefined
  );
}

function hasBrowserData(data: Pick<BrowserData, "sessions" | "reviews" | "staffRecallRuns">): boolean {
  return data.sessions.length > 0 || data.reviews.length > 0 || data.staffRecallRuns.length > 0;
}

function getManifestDataModifiedAt(manifest: BackupManifest | null): string | undefined {
  return manifest?.dataModifiedAt ?? manifest?.lastBackupAt;
}

function summarizeData(reviews: ReviewRecord[], staffRecallRuns: StaffRecallRunRecord[]): DataSummary {
  const times = [
    ...reviews.flatMap((review) => [review.startedAt, review.answeredAt, review.endedAt]),
    ...staffRecallRuns.flatMap((run) => [run.startedAt, run.endedAt]),
  ].filter((time): time is string => Boolean(time));
  const sortedTimes = [...times].sort((a, b) => a.localeCompare(b));
  return {
    firstDataAt: sortedTimes[0],
    lastDataAt: sortedTimes[sortedTimes.length - 1],
    recordCount: reviews.length + staffRecallRuns.length,
    reviewCount: reviews.length,
    staffRecallRunCount: staffRecallRuns.length,
  };
}

function compareTimestamp(a?: string, b?: string): number {
  if (!a && !b) {
    return 0;
  }
  if (!a) {
    return -1;
  }
  if (!b) {
    return 1;
  }
  const parsedA = Date.parse(a);
  const parsedB = Date.parse(b);
  if (Number.isFinite(parsedA) && Number.isFinite(parsedB)) {
    return parsedA - parsedB;
  }
  return a.localeCompare(b);
}

function backupDataNewerThanBrowser(inspection: BackupStatusInspection): boolean {
  return compareTimestamp(inspection.backupModifiedAt, inspection.browserModifiedAt) > 0;
}

function backupDataConsistent(
  data: BrowserData,
  state: BackupState,
  manifest: BackupManifest | null,
): boolean {
  if (!manifest || !state.lastSeenBackupVersion) {
    return false;
  }
  if (manifest.dataSetId !== data.settings.dataSetId || getBackupManifestVersion(manifest) !== state.lastSeenBackupVersion) {
    return false;
  }
  const latestReviewPresent = !manifest.lastReviewId || data.reviews.some((review) => review.id === manifest.lastReviewId);
  const latestStaffRecallRunPresent =
    !manifest.lastStaffRecallRunId || data.staffRecallRuns.some((run) => run.id === manifest.lastStaffRecallRunId);
  return latestReviewPresent && latestStaffRecallRunPresent;
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

async function inspectBackupStatus(
  directory: FileSystemDirectoryHandle,
  state: BackupState,
): Promise<BackupStatusInspection> {
  const [data, manifest] = await Promise.all([loadAllData(), readBackupManifestIfExists(directory)]);
  const backupData = manifest && manifest.dates.length > 0 ? await readBackupSnapshot(directory) : undefined;
  const backupSummary = backupData ? summarizeData(backupData.reviews, backupData.staffRecallRuns) : undefined;
  const browserModifiedAt = getBackupDataModifiedAt(data.settings, data.sessions, data.reviews, data.staffRecallRuns);
  const backupModifiedAt = getManifestDataModifiedAt(manifest);
  const browserSummary = summarizeData(data.reviews, data.staffRecallRuns);
  const status = deriveBackupDataStatus({
    hasDirectoryHandle: true,
    hasBrowserData: hasBrowserData(data),
    hasBackupManifest: Boolean(manifest),
    dataConsistent: backupDataConsistent(data, state, manifest),
  });
  return { data, browserSummary, backupSummary, browserModifiedAt, backupModifiedAt, manifest, status };
}

function buildReadyBackupState(
  state: BackupState,
  directory: FileSystemDirectoryHandle,
  manifest: BackupManifest | null,
): BackupState {
  return {
    ...cleanBackupState(state),
    id: "default",
    schemaVersion: 1,
    directoryHandle: directory,
    directoryName: directory.name,
    dataConflictBeforeBackup: false,
    syncRequiredBeforeBackup: false,
    conflictBrowserModifiedAt: undefined,
    conflictBackupModifiedAt: undefined,
    conflictBrowserFirstReviewAt: undefined,
    conflictBrowserLastReviewAt: undefined,
    conflictBrowserReviewCount: undefined,
    conflictBackupFirstReviewAt: undefined,
    conflictBackupLastReviewAt: undefined,
    conflictBackupReviewCount: undefined,
    conflictBrowserFirstDataAt: undefined,
    conflictBrowserLastDataAt: undefined,
    conflictBrowserRecordCount: undefined,
    conflictBrowserStaffRecallRunCount: undefined,
    conflictBackupFirstDataAt: undefined,
    conflictBackupLastDataAt: undefined,
    conflictBackupRecordCount: undefined,
    conflictBackupStaffRecallRunCount: undefined,
    lastSeenBackupVersion: manifest ? getBackupManifestVersion(manifest) : undefined,
    backupDataModifiedAt: getManifestDataModifiedAt(manifest),
    lastBackupAt: manifest?.lastBackupAt,
    lastBackupReviewId: manifest?.lastReviewId,
    lastError: undefined,
  };
}

async function saveReadyBackupState(
  state: BackupState,
  directory: FileSystemDirectoryHandle,
  manifest: BackupManifest | null,
): Promise<void> {
  await db.backupStates.put(buildReadyBackupState(state, directory, manifest));
}

async function saveDivergedBackupState(
  state: BackupState,
  directory: FileSystemDirectoryHandle,
  inspection: BackupStatusInspection,
): Promise<void> {
  await db.backupStates.put({
    ...cleanBackupState(state),
    id: "default",
    schemaVersion: 1,
    directoryHandle: directory,
    directoryName: directory.name,
    dataConflictBeforeBackup: true,
    syncRequiredBeforeBackup: true,
    conflictBrowserModifiedAt: inspection.browserModifiedAt,
    conflictBackupModifiedAt: inspection.backupModifiedAt,
    conflictBrowserFirstReviewAt: undefined,
    conflictBrowserLastReviewAt: undefined,
    conflictBrowserReviewCount: inspection.browserSummary.reviewCount,
    conflictBackupFirstReviewAt: undefined,
    conflictBackupLastReviewAt: undefined,
    conflictBackupReviewCount: inspection.backupSummary?.reviewCount ?? 0,
    conflictBrowserFirstDataAt: inspection.browserSummary.firstDataAt,
    conflictBrowserLastDataAt: inspection.browserSummary.lastDataAt,
    conflictBrowserRecordCount: inspection.browserSummary.recordCount,
    conflictBrowserStaffRecallRunCount: inspection.browserSummary.staffRecallRunCount,
    conflictBackupFirstDataAt: inspection.backupSummary?.firstDataAt,
    conflictBackupLastDataAt: inspection.backupSummary?.lastDataAt,
    conflictBackupRecordCount: inspection.backupSummary?.recordCount ?? 0,
    conflictBackupStaffRecallRunCount: inspection.backupSummary?.staffRecallRunCount ?? 0,
    lastSeenBackupVersion: undefined,
    lastBackupAt: inspection.manifest?.lastBackupAt,
    lastBackupReviewId: inspection.manifest?.lastReviewId,
    lastError: backupText.messages.dataConflictBeforeBackup,
  });
}

async function writeBrowserSnapshotToDirectory(
  directory: FileSystemDirectoryHandle,
  data: BrowserData,
  backupAt = new Date().toISOString(),
): Promise<BackupSnapshot> {
  const snapshot = buildBackupSnapshot(data.settings, data.sessions, data.reviews, backupAt, data.staffRecallRuns);
  await writeBackupSnapshot(directory, snapshot);
  return snapshot;
}

async function importDirectorySnapshot(
  directory: FileSystemDirectoryHandle,
  state: BackupState,
): Promise<void> {
  const snapshot = await readBackupSnapshot(directory);
  await replaceAllData(snapshot.settings, snapshot.sessions, snapshot.reviews, snapshot.staffRecallRuns);
  await saveReadyBackupState(state, directory, snapshot.manifest);
}

export function supportsFileBackups(): boolean {
  return typeof window !== "undefined" && typeof window.showDirectoryPicker === "function";
}

export async function chooseBackupDirectory(): Promise<BackupDirectorySelectionResult> {
  if (!window.showDirectoryPicker) {
    throw new Error(backupText.errors.unsupportedDirectoryPicker);
  }
  const directory = await window.showDirectoryPicker({ id: "anki-note-backup", mode: "readwrite" });
  const granted = await ensureReadWritePermission(directory);
  if (!granted) {
    throw new Error(backupText.errors.writePermissionDenied);
  }

  const state = await getBackupState();
  const inspection = await inspectBackupStatus(directory, state);
  if (inspection.status === "browser-only") {
    const snapshot = await writeBrowserSnapshotToDirectory(directory, inspection.data);
    await saveReadyBackupState(state, directory, snapshot.manifest);
    return "synced-down";
  }
  if (inspection.status === "backup-only") {
    await importDirectorySnapshot(directory, state);
    return "synced-up";
  }
  if (inspection.status === "diverged") {
    await saveDivergedBackupState(state, directory, inspection);
    return "diverged";
  }

  await saveReadyBackupState(state, directory, inspection.manifest);
  return "ready";
}

export async function syncBackupBeforeActivity({
  requestPermission = false,
}: {
  requestPermission?: boolean;
} = {}): Promise<BackupPreflightResult> {
  const state = await getBackupState();
  if (!state.directoryHandle) {
    return "needs-directory";
  }
  if (explicitDataConflict(state)) {
    if (conflictDetailsMissing(state)) {
      await refreshBackupConflictDetails({ requestPermission });
    }
    return "data-conflict";
  }
  if (!(await hasReadWritePermission(state.directoryHandle, requestPermission))) {
    return "skipped";
  }

  const inspection = await inspectBackupStatus(state.directoryHandle, state);
  if (inspection.status === "browser-only") {
    const snapshot = await writeBrowserSnapshotToDirectory(state.directoryHandle, inspection.data);
    await saveReadyBackupState(state, state.directoryHandle, snapshot.manifest);
    return "synced-down";
  }
  if (inspection.status === "backup-only" || (inspection.status === "diverged" && backupDataNewerThanBrowser(inspection))) {
    await importDirectorySnapshot(state.directoryHandle, state);
    return "synced-up";
  }
  if (inspection.status === "diverged") {
    await saveDivergedBackupState(state, state.directoryHandle, inspection);
    return "data-conflict";
  }

  await saveReadyBackupState(state, state.directoryHandle, inspection.manifest);
  return "ready";
}

export async function refreshBackupConflictDetails({
  requestPermission = false,
}: {
  requestPermission?: boolean;
} = {}): Promise<boolean> {
  const state = await getBackupState();
  if (!state.directoryHandle || !explicitDataConflict(state) || !conflictDetailsMissing(state)) {
    return false;
  }
  if (!(await hasReadWritePermission(state.directoryHandle, requestPermission))) {
    return false;
  }
  const inspection = await inspectBackupStatus(state.directoryHandle, state);
  await saveDivergedBackupState(state, state.directoryHandle, inspection);
  return true;
}

export async function writeBackupNow(): Promise<void> {
  const state = await getBackupState();
  if (!state.directoryHandle) {
    return;
  }
  if (explicitDataConflict(state)) {
    await db.backupStates.put({
      ...cleanBackupState(state),
      dataConflictBeforeBackup: true,
      syncRequiredBeforeBackup: true,
      lastError: backupText.messages.dataConflictBeforeBackup,
    });
    throw new Error(backupText.messages.dataConflictBeforeBackup);
  }

  try {
    const granted = await ensureReadWritePermission(state.directoryHandle);
    if (!granted) {
      throw new Error(backupText.errors.permissionExpired);
    }

    const inspection = await inspectBackupStatus(state.directoryHandle, state);
    if (inspection.status === "backup-only" || inspection.status === "diverged") {
      await saveDivergedBackupState(state, state.directoryHandle, inspection);
      throw new Error(backupText.messages.dataConflictBeforeBackup);
    }
    if (inspection.status === "ready" && !inspection.manifest && !hasBrowserData(inspection.data)) {
      await saveReadyBackupState(state, state.directoryHandle, null);
      return;
    }

    const snapshot = await writeBrowserSnapshotToDirectory(state.directoryHandle, inspection.data);
    await saveReadyBackupState(state, state.directoryHandle, snapshot.manifest);
  } catch (error) {
    const latestState = await getBackupState();
    await db.backupStates.put({
      ...cleanBackupState(latestState),
      lastError: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}

export async function writeBackupIfSafe(): Promise<void> {
  const state = await getBackupState();
  if (!state.directoryHandle || explicitDataConflict(state)) {
    return;
  }
  try {
    if (!(await hasReadWritePermission(state.directoryHandle, false))) {
      return;
    }
    const inspection = await inspectBackupStatus(state.directoryHandle, state);
    if (inspection.status === "backup-only" || inspection.status === "diverged") {
      await saveDivergedBackupState(state, state.directoryHandle, inspection);
      return;
    }
    if (inspection.status === "ready" && !inspection.manifest && !hasBrowserData(inspection.data)) {
      await saveReadyBackupState(state, state.directoryHandle, null);
      return;
    }
    const snapshot = await writeBrowserSnapshotToDirectory(state.directoryHandle, inspection.data);
    await saveReadyBackupState(state, state.directoryHandle, snapshot.manifest);
  } catch (error) {
    const latestState = await getBackupState();
    await db.backupStates.put({
      ...cleanBackupState(latestState),
      lastError: error instanceof Error ? error.message : String(error),
    });
  }
}

export async function writeBrowserDataToBackupDirectory(): Promise<void> {
  const state = await getBackupState();
  if (!state.directoryHandle) {
    return;
  }
  const granted = await ensureReadWritePermission(state.directoryHandle);
  if (!granted) {
    throw new Error(backupText.errors.permissionExpired);
  }
  const data = await loadAllData();
  const snapshot = await writeBrowserSnapshotToDirectory(state.directoryHandle, data);
  await saveReadyBackupState(state, state.directoryHandle, snapshot.manifest);
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
  staffRecallRuns: StaffRecallRunRecord[];
}> {
  const manifest = await readJson<BackupManifest>(directory, "manifest.json");
  const daysDirectory = await directory.getDirectoryHandle("days");
  const dayFiles = await Promise.all(manifest.dates.map((date) => readJson<BackupDayFile>(daysDirectory, `${date}.json`)));
  const sessions = dayFiles.flatMap((day) => day.sessions);
  const reviews = dayFiles.flatMap((day) => day.reviews);
  const staffRecallRuns = dayFiles.flatMap((day) => day.staffRecallRuns ?? []);
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
    pianoVolume: normalizePianoVolume(baseSettings.pianoVolume),
    promptDisplayMode: baseSettings.promptDisplayMode ?? "staff-page",
    promptNoteDuration: baseSettings.promptNoteDuration ?? "quarter",
  };
  return { manifest, settings, sessions, reviews, staffRecallRuns };
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
  const state = await getBackupState();
  await importDirectorySnapshot(directory, state);
}
