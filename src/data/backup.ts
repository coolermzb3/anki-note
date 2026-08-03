import { buildBackupSnapshot, getBackupDataModifiedAt, getBackupManifestVersion } from "../domain/backupSnapshot";
import { deriveBackupDataStatus, type BackupDataStatus } from "../domain/backupSync";
import { backupText } from "../domain/backupText";
import { normalizeCurrentPracticeGroupIds } from "../domain/notes";
import { normalizeAnswerKeyboardScale, normalizePianoVolume } from "../domain/settings";
import type {
  AppSettings,
  BackupDayFile,
  BackupDayFileMetadata,
  BackupManifest,
  BackupSnapshot,
  BackupState,
  PracticeSessionRecord,
  ReviewRecord,
  StaffRecallRunRecord,
} from "../domain/types";
import type { VocalAudioCounts, VocalAudioMaterial } from "../domain/vocalPitch";
import {
  applyBackupDataChanges,
  db,
  ensureSettings,
  getBackupState,
  loadAllData,
  makeDefaultSettings,
  normalizeAppSettings,
  replaceAllData,
  resolveDrillNoteNames,
  resolveQueueStrategy,
} from "./db";
import {
  getVocalAudioLibraryDigest,
  inspectVocalAudioBackup,
  readVocalAudioLibrary,
  syncVocalAudioLibrary,
} from "./vocalAudioBackup";

type LegacyBackupState = BackupState & { restoreRequiredBeforeBackup?: boolean; syncRequiredReason?: unknown };

interface BrowserData {
  settings: AppSettings;
  sessions: PracticeSessionRecord[];
  reviews: ReviewRecord[];
  staffRecallRuns: StaffRecallRunRecord[];
}

interface BackupBrowserFacts {
  dataSetId: string;
  hasRecords: boolean;
  hasPracticeRecords: boolean;
  latestReviewPresent: boolean;
  latestStaffRecallRunPresent: boolean;
  vocalAudioBackupDigest: string;
  vocalAudioBackupFilesValid: boolean;
  hasVocalAudioMaterials: boolean;
  vocalAudioLibraryDigest: string;
}

interface BackupStatusInspection {
  backupVocalAudioCounts: VocalAudioCounts;
  data: BrowserData;
  browserSummary: DataSummary;
  backupSummary?: DataSummary;
  backupSnapshot?: ImportedBackupSnapshot;
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

export interface BackupPreflightOutcome {
  result: BackupPreflightResult;
  backupStateChanged: boolean;
  importedData?: BackupImportedData;
}

export interface BackupImportedData extends BrowserData {
  backupState: BackupState;
}

interface ImportedBackupSnapshot extends BrowserData {
  manifest: BackupManifest;
}

interface RecordChanges<T> {
  deletes: string[];
  puts: T[];
}

interface DataSummary {
  firstDataAt?: string;
  lastDataAt?: string;
  recordCount: number;
  reviewCount: number;
  staffRecallRunCount: number;
  vocalAudioCounts: VocalAudioCounts;
}

interface WriteBackupSnapshotOptions {
  deferManifestWrite?: boolean;
  reuseDayFilesFrom?: BackupManifest;
}

const INCREMENTAL_IMPORT_MAX_MUTATIONS = 2_000;

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
    state.conflictBackupStaffRecallRunCount === undefined ||
    state.conflictBrowserVocalAudioCounts === undefined ||
    state.conflictBackupVocalAudioCounts === undefined
  );
}

function hasBrowserData(data: Pick<BrowserData, "sessions" | "reviews" | "staffRecallRuns">): boolean {
  return data.sessions.length > 0 || data.reviews.length > 0 || data.staffRecallRuns.length > 0;
}

function getManifestDataModifiedAt(manifest: BackupManifest | null): string | undefined {
  return manifest?.dataModifiedAt ?? manifest?.lastBackupAt;
}

function summarizeVocalAudio(materials: readonly Pick<VocalAudioMaterial, "source">[]): VocalAudioCounts {
  return {
    materialCount: materials.length,
    recordingCount: materials.filter((material) => material.source === "recording").length,
    uploadCount: materials.filter((material) => material.source === "upload").length,
  };
}

function summarizeData(
  reviews: ReviewRecord[],
  staffRecallRuns: StaffRecallRunRecord[],
  vocalAudioCounts: VocalAudioCounts = { materialCount: 0, recordingCount: 0, uploadCount: 0 },
): DataSummary {
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
    vocalAudioCounts,
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
  state: BackupState,
  manifest: BackupManifest | null,
  browser: BackupBrowserFacts,
): boolean {
  const vocalAudioBackupUnchanged = state.lastSeenVocalAudioLibraryDigest
    ? manifest?.vocalAudioLibraryDigest === state.lastSeenVocalAudioLibraryDigest &&
      browser.vocalAudioBackupDigest === state.lastSeenVocalAudioLibraryDigest
    : browser.vocalAudioLibraryDigest === browser.vocalAudioBackupDigest &&
      (manifest?.vocalAudioLibraryDigest === undefined ||
        manifest.vocalAudioLibraryDigest === browser.vocalAudioBackupDigest);
  return Boolean(
    manifest &&
      state.lastSeenBackupVersion &&
      manifest.dataSetId === browser.dataSetId &&
      getBackupManifestVersion(manifest) === state.lastSeenBackupVersion &&
      browser.hasPracticeRecords === (manifest.dates.length > 0) &&
      browser.latestReviewPresent &&
      browser.latestStaffRecallRunPresent &&
      vocalAudioBackupUnchanged &&
      browser.vocalAudioBackupFilesValid,
  );
}

function getBackupBrowserFacts(
  data: BrowserData,
  manifest: BackupManifest | null,
  vocalAudioLibraryDigest: string,
  vocalAudioBackupDigest: string,
  vocalAudioBackupFilesValid: boolean,
  hasVocalAudioMaterials: boolean,
  hasLocallyChangedVocalAudio: boolean,
): BackupBrowserFacts {
  const lastReviewId = manifest?.lastReviewId;
  const lastStaffRecallRunId = manifest?.lastStaffRecallRunId;
  return {
    dataSetId: data.settings.dataSetId,
    hasRecords: hasBrowserData(data) || hasVocalAudioMaterials || hasLocallyChangedVocalAudio,
    hasPracticeRecords: hasBrowserData(data),
    latestReviewPresent: !lastReviewId || data.reviews.some((review) => review.id === lastReviewId),
    latestStaffRecallRunPresent:
      !lastStaffRecallRunId || data.staffRecallRuns.some((run) => run.id === lastStaffRecallRunId),
    vocalAudioBackupDigest,
    vocalAudioBackupFilesValid,
    hasVocalAudioMaterials,
    vocalAudioLibraryDigest,
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
  await writeText(directory, filename, JSON.stringify(value, null, 2));
}

async function writeText(directory: FileSystemDirectoryHandle, filename: string, value: string): Promise<void> {
  const handle = await directory.getFileHandle(filename, { create: true });
  const writable = await handle.createWritable();
  await writable.write(value);
  await writable.close();
}

async function sha256(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  const hex = [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
  return `sha256:${hex}`;
}

async function serializeBackupDays(days: Record<string, BackupDayFile>): Promise<{
  dayFileDigests: Record<string, string>;
  serializedDays: Array<{ date: string; digest: string; json: string }>;
}> {
  const serializedDays = await Promise.all(
    Object.entries(days).map(async ([date, day]) => {
      const json = JSON.stringify(day, null, 2);
      return { date, digest: await sha256(json), json };
    }),
  );
  return {
    dayFileDigests: Object.fromEntries(serializedDays.map(({ date, digest }) => [date, digest])),
    serializedDays,
  };
}

function dayFileDigestsMatch(
  dates: string[],
  expected: Record<string, string> | undefined,
  actual: Record<string, string> | undefined,
): boolean {
  if (!hasCompleteDayFileDigests(dates, expected) || !hasCompleteDayFileDigests(dates, actual)) {
    return false;
  }
  return dates.every((date) => expected[date] !== undefined && expected[date] === actual[date]);
}

function hasCompleteDayFileDigests(
  dates: string[],
  digests: Record<string, string> | undefined,
): digests is Record<string, string> {
  return Boolean(
    digests &&
      Object.keys(digests).length === dates.length &&
      dates.every((date) => typeof digests[date] === "string"),
  );
}

async function readFileText(directory: FileSystemDirectoryHandle, filename: string): Promise<string> {
  const handle = await directory.getFileHandle(filename);
  const file = await handle.getFile();
  return file.text();
}

async function readJson<T>(directory: FileSystemDirectoryHandle, filename: string): Promise<T> {
  return JSON.parse(await readFileText(directory, filename)) as T;
}

async function readBackupDayFiles(
  directory: FileSystemDirectoryHandle,
  dates: string[],
  expectedDigests?: Record<string, string>,
): Promise<Record<string, BackupDayFile> | undefined> {
  if (dates.length === 0) {
    return {};
  }
  const daysDirectory = await directory.getDirectoryHandle("days");
  const entries = await Promise.all(
    dates.map(async (date) => {
      const text = await readFileText(daysDirectory, `${date}.json`);
      if (expectedDigests && (await sha256(text)) !== expectedDigests[date]) {
        return undefined;
      }
      return [date, JSON.parse(text) as BackupDayFile] as const;
    }),
  );
  if (entries.some((entry) => entry === undefined)) {
    return undefined;
  }
  return Object.fromEntries(entries as Array<readonly [string, BackupDayFile]>);
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

async function readBackupDayFileMetadata(
  directory: FileSystemDirectoryHandle,
  dates: string[],
): Promise<Record<string, BackupDayFileMetadata> | undefined> {
  if (dates.length === 0) {
    return {};
  }
  try {
    const daysDirectory = await directory.getDirectoryHandle("days");
    const entries = await Promise.all(
      dates.map(async (date) => {
        const handle = await daysDirectory.getFileHandle(`${date}.json`);
        const file = await handle.getFile();
        return [date, { size: file.size, lastModified: file.lastModified }] as const;
      }),
    );
    return Object.fromEntries(entries);
  } catch (error) {
    if (error instanceof DOMException && error.name === "NotFoundError") {
      return undefined;
    }
    throw error;
  }
}

function backupDayFileMetadataMatches(
  dates: string[],
  remembered: Record<string, BackupDayFileMetadata> | undefined,
  current: Record<string, BackupDayFileMetadata> | undefined,
): boolean {
  if (!remembered || !current || Object.keys(remembered).length !== dates.length) {
    return false;
  }
  return dates.every((date) => {
    const rememberedFile = remembered[date];
    const currentFile = current[date];
    return (
      rememberedFile !== undefined &&
      currentFile !== undefined &&
      rememberedFile.size === currentFile.size &&
      rememberedFile.lastModified === currentFile.lastModified
    );
  });
}

async function readReadyBackupManifest(
  directory: FileSystemDirectoryHandle,
  state: BackupState,
): Promise<BackupManifest | undefined> {
  const manifest = await readBackupManifestIfExists(directory);
  if (
    !manifest ||
    state.lastError ||
    !state.lastSeenBackupVersion ||
    getBackupManifestVersion(manifest) !== state.lastSeenBackupVersion
  ) {
    return undefined;
  }

  if (
    !state.lastSeenBackupDayFileMetadata ||
    Object.keys(state.lastSeenBackupDayFileMetadata).length !== manifest.dates.length
  ) {
    return undefined;
  }
  const dayFileMetadata = await readBackupDayFileMetadata(directory, manifest.dates);
  if (!backupDayFileMetadataMatches(manifest.dates, state.lastSeenBackupDayFileMetadata, dayFileMetadata)) {
    return undefined;
  }
  if (
    manifest.dayFileDigests &&
    (state.lastSeenBackupDataSetId !== manifest.dataSetId ||
      !dayFileDigestsMatch(manifest.dates, manifest.dayFileDigests, state.lastSeenBackupDayFileDigests))
  ) {
    return undefined;
  }

  const [
    settings,
    sessionCount,
    reviewCount,
    staffRecallRunCount,
    vocalAudioMaterialCount,
    vocalAudioLibraryDigest,
    vocalAudioBackup,
    latestReview,
    latestStaffRecallRun,
  ] =
    await Promise.all([
      ensureSettings(),
      db.practiceSessions.count(),
      db.reviews.count(),
      db.staffRecallRuns.count(),
      db.vocalAudioMaterials.count(),
      getVocalAudioLibraryDigest(),
      inspectVocalAudioBackup(directory, state.lastSeenVocalAudioFileMetadata, !state.lastSeenVocalAudioFileMetadata),
      manifest.lastReviewId ? db.reviews.get(manifest.lastReviewId) : undefined,
      manifest.lastStaffRecallRunId ? db.staffRecallRuns.get(manifest.lastStaffRecallRunId) : undefined,
    ]);
  const hasBrowserRecords = sessionCount > 0 || reviewCount > 0 || staffRecallRunCount > 0 || vocalAudioMaterialCount > 0;
  if (
    backupDataConsistent(state, manifest, {
      dataSetId: settings.dataSetId,
      hasRecords: hasBrowserRecords,
      hasPracticeRecords: sessionCount > 0 || reviewCount > 0 || staffRecallRunCount > 0,
      hasVocalAudioMaterials: vocalAudioMaterialCount > 0,
      latestReviewPresent: !manifest.lastReviewId || Boolean(latestReview),
      latestStaffRecallRunPresent: !manifest.lastStaffRecallRunId || Boolean(latestStaffRecallRun),
      vocalAudioBackupDigest: vocalAudioBackup.digest,
      vocalAudioBackupFilesValid: vocalAudioBackup.filesValid,
      vocalAudioLibraryDigest,
    })
  ) {
    return manifest;
  }
  return undefined;
}

async function inspectBackupStatus(
  directory: FileSystemDirectoryHandle,
  state: BackupState,
): Promise<BackupStatusInspection> {
  const [data, manifest, vocalAudioMaterials, vocalAudioLibraryDigest, vocalAudioBackup] = await Promise.all([
    loadAllData(),
    readBackupManifestIfExists(directory),
    db.vocalAudioMaterials.toArray(),
    getVocalAudioLibraryDigest(),
    inspectVocalAudioBackup(directory, state.lastSeenVocalAudioFileMetadata, !state.lastSeenVocalAudioFileMetadata),
  ]);
  const browserModifiedAt = getBackupDataModifiedAt(data.settings, data.sessions, data.reviews, data.staffRecallRuns);
  const backupModifiedAt = getManifestDataModifiedAt(manifest);
  const browserSummary = summarizeData(data.reviews, data.staffRecallRuns, summarizeVocalAudio(vocalAudioMaterials));
  const browserFacts = getBackupBrowserFacts(
    data,
    manifest,
    vocalAudioLibraryDigest,
    vocalAudioBackup.digest,
    vocalAudioBackup.filesValid,
    vocalAudioMaterials.length > 0,
    state.lastSeenVocalAudioLibraryDigest !== undefined &&
      state.lastSeenVocalAudioLibraryDigest !== vocalAudioLibraryDigest,
  );
  const status = deriveBackupDataStatus({
    hasDirectoryHandle: true,
    hasBrowserData: browserFacts.hasRecords,
    hasBackupManifest: Boolean(manifest),
    dataConsistent: backupDataConsistent(state, manifest, browserFacts),
  });
  const backupSnapshot =
    manifest && status !== "browser-only" && status !== "diverged"
      ? await readBackupSnapshotFromManifest(directory, manifest)
      : undefined;
  const backupSummary = backupSnapshot
    ? summarizeData(backupSnapshot.reviews, backupSnapshot.staffRecallRuns, vocalAudioBackup.counts)
    : undefined;
  return {
    backupVocalAudioCounts: vocalAudioBackup.counts,
    data,
    browserSummary,
    backupSummary,
    backupModifiedAt,
    backupSnapshot,
    browserModifiedAt,
    manifest,
    status,
  };
}

function buildReadyBackupState(
  state: BackupState,
  directory: FileSystemDirectoryHandle,
  manifest: BackupManifest | null,
  dayFileMetadata?: Record<string, BackupDayFileMetadata>,
  vocalAudioFileMetadata?: Record<string, BackupDayFileMetadata>,
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
    conflictBrowserVocalAudioCounts: undefined,
    conflictBackupFirstDataAt: undefined,
    conflictBackupLastDataAt: undefined,
    conflictBackupRecordCount: undefined,
    conflictBackupStaffRecallRunCount: undefined,
    conflictBackupVocalAudioCounts: undefined,
    lastSeenBackupVersion: manifest ? getBackupManifestVersion(manifest) : undefined,
    lastSeenBackupDataSetId: manifest?.dataSetId,
    lastSeenBackupDayFileDigests: manifest?.dayFileDigests,
    lastSeenBackupDayFileMetadata: manifest ? dayFileMetadata : undefined,
    lastSeenVocalAudioLibraryDigest: manifest?.vocalAudioLibraryDigest,
    lastSeenVocalAudioFileMetadata: vocalAudioFileMetadata,
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
): Promise<BackupState> {
  const [dayFileMetadata, vocalAudioBackup] = await Promise.all([
    manifest ? readBackupDayFileMetadata(directory, manifest.dates) : undefined,
    inspectVocalAudioBackup(directory),
  ]);
  const readyState = buildReadyBackupState(state, directory, manifest, dayFileMetadata, vocalAudioBackup.fileMetadata);
  await db.backupStates.put(readyState);
  return readyState;
}

async function saveDivergedBackupState(
  state: BackupState,
  directory: FileSystemDirectoryHandle,
  inspection: BackupStatusInspection,
): Promise<void> {
  const backupSnapshot =
    inspection.backupSnapshot ??
    (inspection.manifest ? await readBackupSnapshotFromManifest(directory, inspection.manifest) : undefined);
  const backupSummary =
    inspection.backupSummary ??
    (backupSnapshot
      ? summarizeData(backupSnapshot.reviews, backupSnapshot.staffRecallRuns, inspection.backupVocalAudioCounts)
      : undefined);
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
    conflictBackupReviewCount: backupSummary?.reviewCount ?? 0,
    conflictBrowserFirstDataAt: inspection.browserSummary.firstDataAt,
    conflictBrowserLastDataAt: inspection.browserSummary.lastDataAt,
    conflictBrowserRecordCount: inspection.browserSummary.recordCount,
    conflictBrowserStaffRecallRunCount: inspection.browserSummary.staffRecallRunCount,
    conflictBrowserVocalAudioCounts: inspection.browserSummary.vocalAudioCounts,
    conflictBackupFirstDataAt: backupSummary?.firstDataAt,
    conflictBackupLastDataAt: backupSummary?.lastDataAt,
    conflictBackupRecordCount: backupSummary?.recordCount ?? 0,
    conflictBackupStaffRecallRunCount: backupSummary?.staffRecallRunCount ?? 0,
    conflictBackupVocalAudioCounts: backupSummary?.vocalAudioCounts ?? {
      materialCount: 0,
      recordingCount: 0,
      uploadCount: 0,
    },
    lastSeenBackupVersion: undefined,
    lastSeenBackupDataSetId: undefined,
    lastSeenBackupDayFileDigests: undefined,
    lastSeenBackupDayFileMetadata: undefined,
    lastSeenVocalAudioLibraryDigest: undefined,
    lastSeenVocalAudioFileMetadata: undefined,
    lastBackupAt: inspection.manifest?.lastBackupAt,
    lastBackupReviewId: inspection.manifest?.lastReviewId,
    lastError: backupText.messages.dataConflictBeforeBackup,
  });
}

async function writeBrowserSnapshotToDirectory(
  directory: FileSystemDirectoryHandle,
  data: BrowserData,
  backupAt = new Date().toISOString(),
  reuseDayFilesFrom?: BackupManifest,
): Promise<BackupSnapshot> {
  const snapshot = buildBackupSnapshot(data.settings, data.sessions, data.reviews, backupAt, data.staffRecallRuns);
  const manifest = await writeBackupSnapshot(directory, snapshot, { deferManifestWrite: true, reuseDayFilesFrom });
  const vocalAudioStatus = await syncVocalAudioLibrary(directory);
  if (vocalAudioStatus !== "backed-up") {
    throw new Error("音频素材备份失败");
  }
  const completeManifest = { ...manifest, vocalAudioLibraryDigest: await getVocalAudioLibraryDigest() };
  await writeJson(directory, "manifest.json", completeManifest);
  return { ...snapshot, manifest: completeManifest };
}

async function writeBrowserSnapshotFromReadyBackup(
  state: BackupState,
  directory: FileSystemDirectoryHandle,
): Promise<boolean> {
  const readyManifest = await readReadyBackupManifest(directory, state);
  if (!readyManifest) {
    return false;
  }
  const data = await loadAllData();
  const snapshot = await writeBrowserSnapshotToDirectory(directory, data, undefined, readyManifest);
  await saveReadyBackupState(state, directory, snapshot.manifest);
  return true;
}

function diffRecords<T extends { id: string }>(current: T[], incoming: T[]): RecordChanges<T> {
  const currentById = new Map(current.map((record) => [record.id, record]));
  const incomingIds = new Set<string>();
  const puts: T[] = [];
  for (const record of incoming) {
    incomingIds.add(record.id);
    const existing = currentById.get(record.id);
    if (!existing || JSON.stringify(existing) !== JSON.stringify(record)) {
      puts.push(record);
    }
  }
  return {
    deletes: [...currentById.keys()].filter((id) => !incomingIds.has(id)),
    puts,
  };
}

function collectDayRecords(days: Record<string, BackupDayFile>, dates: string[]): Omit<BrowserData, "settings"> {
  const dayFiles = dates.flatMap((date) => (days[date] ? [days[date]] : []));
  return {
    sessions: dayFiles.flatMap((day) => day.sessions),
    reviews: dayFiles.flatMap((day) => day.reviews),
    staffRecallRuns: dayFiles.flatMap((day) => day.staffRecallRuns ?? []),
  };
}

function getChangedBackupDates(
  previous: Record<string, string>,
  current: Record<string, string>,
): string[] {
  const dates = new Set([...Object.keys(previous), ...Object.keys(current)]);
  return [...dates].filter((date) => previous[date] !== current[date]).sort((a, b) => a.localeCompare(b));
}

async function tryImportDirectoryIncrementally(
  directory: FileSystemDirectoryHandle,
  state: BackupState,
  inspection: BackupStatusInspection,
): Promise<BackupImportedData | undefined> {
  const manifest = inspection.manifest;
  const previousDayFileDigests = state.lastSeenBackupDayFileDigests;
  const currentDayFileDigests = manifest?.dayFileDigests;
  if (
    !manifest ||
    !state.lastSeenBackupVersion ||
    !state.lastBackupAt ||
    getBackupManifestVersion(manifest) === state.lastSeenBackupVersion ||
    compareTimestamp(manifest.lastBackupAt, state.lastBackupAt) <= 0 ||
    state.lastSeenBackupDataSetId !== manifest.dataSetId ||
    inspection.data.settings.dataSetId !== manifest.dataSetId ||
    !previousDayFileDigests ||
    !hasCompleteDayFileDigests(manifest.dates, currentDayFileDigests)
  ) {
    return undefined;
  }

  const browserSnapshot = buildBackupSnapshot(
    inspection.data.settings,
    inspection.data.sessions,
    inspection.data.reviews,
    manifest.lastBackupAt,
    inspection.data.staffRecallRuns,
  );
  const browserDates = browserSnapshot.manifest.dates;
  if (!hasCompleteDayFileDigests(browserDates, previousDayFileDigests)) {
    return undefined;
  }
  const { dayFileDigests: browserDayFileDigests } = await serializeBackupDays(browserSnapshot.days);
  if (!dayFileDigestsMatch(browserDates, previousDayFileDigests, browserDayFileDigests)) {
    return undefined;
  }

  const changedDates = getChangedBackupDates(previousDayFileDigests, currentDayFileDigests);
  const changedBackupDates = changedDates.filter((date) => currentDayFileDigests[date] !== undefined);
  const [changedBackupDays, settings] = await Promise.all([
    readBackupDayFiles(directory, changedBackupDates, currentDayFileDigests),
    normalizeImportedSettings(manifest),
  ]);
  if (!changedBackupDays) {
    return undefined;
  }

  const currentRecords = collectDayRecords(browserSnapshot.days, changedDates);
  const incomingRecords = collectDayRecords(changedBackupDays, changedDates);
  const changes = {
    sessions: diffRecords(currentRecords.sessions, incomingRecords.sessions),
    reviews: diffRecords(currentRecords.reviews, incomingRecords.reviews),
    staffRecallRuns: diffRecords(currentRecords.staffRecallRuns, incomingRecords.staffRecallRuns),
  };
  const mutationCount = Object.values(changes).reduce(
    (total, change) => total + change.deletes.length + change.puts.length,
    0,
  );
  if (mutationCount > INCREMENTAL_IMPORT_MAX_MUTATIONS) {
    return undefined;
  }

  await applyBackupDataChanges(settings, changes);
  const mergedDays = { ...browserSnapshot.days };
  for (const date of changedDates) {
    delete mergedDays[date];
  }
  Object.assign(mergedDays, changedBackupDays);
  const importedData = buildBrowserDataFromDays(settings, manifest.dates, mergedDays);
  const backupState = await saveReadyBackupState(state, directory, manifest);
  return { ...importedData, backupState };
}

async function importDirectorySnapshot(
  directory: FileSystemDirectoryHandle,
  state: BackupState,
  existingSnapshot?: ImportedBackupSnapshot,
): Promise<BackupImportedData> {
  const snapshot = existingSnapshot ?? (await readBackupSnapshot(directory));
  const vocalAudioMaterials = await readVocalAudioLibrary(directory);
  await replaceAllData(
    snapshot.settings,
    snapshot.sessions,
    snapshot.reviews,
    snapshot.staffRecallRuns,
    vocalAudioMaterials,
  );
  const backupState = await saveReadyBackupState(state, directory, snapshot.manifest);
  return {
    settings: snapshot.settings,
    sessions: snapshot.sessions,
    reviews: snapshot.reviews,
    staffRecallRuns: snapshot.staffRecallRuns,
    backupState,
  };
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
    await importDirectorySnapshot(directory, state, inspection.backupSnapshot);
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
} = {}): Promise<BackupPreflightOutcome> {
  const state = await getBackupState();
  if (!state.directoryHandle) {
    return { result: "needs-directory", backupStateChanged: false };
  }
  if (explicitDataConflict(state)) {
    const backupStateChanged = conflictDetailsMissing(state)
      ? await refreshBackupConflictDetails({ requestPermission })
      : false;
    return { result: "data-conflict", backupStateChanged };
  }
  if (!(await hasReadWritePermission(state.directoryHandle, requestPermission))) {
    return { result: "skipped", backupStateChanged: false };
  }

  const readyManifest = await readReadyBackupManifest(state.directoryHandle, state);
  if (readyManifest) {
    return { result: "ready", backupStateChanged: false };
  }

  const inspection = await inspectBackupStatus(state.directoryHandle, state);
  const backupSnapshotMovesForward =
    !state.lastBackupAt || compareTimestamp(inspection.manifest?.lastBackupAt, state.lastBackupAt) > 0;
  if (inspection.status === "browser-only") {
    const snapshot = await writeBrowserSnapshotToDirectory(state.directoryHandle, inspection.data);
    await saveReadyBackupState(state, state.directoryHandle, snapshot.manifest);
    return { result: "synced-down", backupStateChanged: true };
  }
  if (inspection.status === "backup-only") {
    if (!backupSnapshotMovesForward) {
      await saveDivergedBackupState(state, state.directoryHandle, inspection);
      return { result: "data-conflict", backupStateChanged: true };
    }
    const importedData = await importDirectorySnapshot(state.directoryHandle, state, inspection.backupSnapshot);
    return { result: "synced-up", backupStateChanged: true, importedData };
  }
  if (inspection.status === "diverged") {
    const importedData = await tryImportDirectoryIncrementally(state.directoryHandle, state, inspection);
    if (importedData) {
      return { result: "synced-up", backupStateChanged: true, importedData };
    }
    if (backupSnapshotMovesForward && backupDataNewerThanBrowser(inspection)) {
      return {
        result: "synced-up",
        backupStateChanged: true,
        importedData: await importDirectorySnapshot(state.directoryHandle, state),
      };
    }
    await saveDivergedBackupState(state, state.directoryHandle, inspection);
    return { result: "data-conflict", backupStateChanged: true };
  }

  await saveReadyBackupState(state, state.directoryHandle, inspection.manifest);
  return { result: "ready", backupStateChanged: true };
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

    if (await writeBrowserSnapshotFromReadyBackup(state, state.directoryHandle)) {
      return;
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
    if (await writeBrowserSnapshotFromReadyBackup(state, state.directoryHandle)) {
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

export async function writeBackupSnapshot(
  directory: FileSystemDirectoryHandle,
  snapshot: BackupSnapshot,
  { deferManifestWrite = false, reuseDayFilesFrom }: WriteBackupSnapshotOptions = {},
): Promise<BackupManifest> {
  const daysDirectory = await directory.getDirectoryHandle("days", { create: true });
  const { dayFileDigests, serializedDays } = await serializeBackupDays(snapshot.days);
  const reusableDayFileDigests =
    reuseDayFilesFrom?.dataSetId === snapshot.manifest.dataSetId ? reuseDayFilesFrom.dayFileDigests : undefined;
  for (const { date, digest, json } of serializedDays) {
    if (
      reusableDayFileDigests &&
      reuseDayFilesFrom?.dates.includes(date) &&
      reusableDayFileDigests[date] === digest
    ) {
      continue;
    }
    await writeText(daysDirectory, `${date}.json`, json);
  }
  const manifest = { ...snapshot.manifest, dayFileDigests };
  if (!deferManifestWrite) {
    await writeJson(directory, "manifest.json", manifest);
  }
  return manifest;
}

async function normalizeImportedSettings(manifest: BackupManifest): Promise<AppSettings> {
  const existingSettings = await db.settings.get("default");
  const baseSettings = normalizeAppSettings(manifest.settings ?? existingSettings ?? makeDefaultSettings());
  return {
    ...baseSettings,
    schemaVersion: 2,
    dataSetId: manifest.dataSetId,
    createdAt: manifest.createdAt,
    firstReviewAt: manifest.firstReviewAt,
    enabledGroupIds: normalizeCurrentPracticeGroupIds(baseSettings.enabledGroupIds),
    includeInterStaffLedgerSpellings: baseSettings.includeInterStaffLedgerSpellings,
    queueStrategy: resolveQueueStrategy(baseSettings),
    drillNoteNames: resolveDrillNoteNames(baseSettings),
    focusedTraining: baseSettings.focusedTraining ?? resolveQueueStrategy(baseSettings) === "focused",
    answerKeyboardScale: normalizeAnswerKeyboardScale(baseSettings.answerKeyboardScale),
    pianoVolume: normalizePianoVolume(baseSettings.pianoVolume),
    promptDisplayMode: baseSettings.promptDisplayMode,
    promptNoteDuration: baseSettings.promptNoteDuration,
  };
}

function buildBrowserDataFromDays(
  settings: AppSettings,
  dates: string[],
  days: Record<string, BackupDayFile>,
): BrowserData {
  const dayFiles = dates.map((date) => days[date]);
  return {
    settings,
    sessions: dayFiles
      .flatMap((day) => day.sessions)
      .sort((left, right) => left.startedAt.localeCompare(right.startedAt) || left.id.localeCompare(right.id)),
    reviews: dayFiles
      .flatMap((day) => day.reviews)
      .sort((left, right) => left.startedAt.localeCompare(right.startedAt) || left.id.localeCompare(right.id)),
    staffRecallRuns: dayFiles
      .flatMap((day) => day.staffRecallRuns ?? [])
      .sort((left, right) => left.endedAt.localeCompare(right.endedAt) || left.id.localeCompare(right.id)),
  };
}

async function readBackupSnapshotFromManifest(
  directory: FileSystemDirectoryHandle,
  manifest: BackupManifest,
): Promise<ImportedBackupSnapshot> {
  if (manifest.dayFileDigests && !hasCompleteDayFileDigests(manifest.dates, manifest.dayFileDigests)) {
    throw new Error(backupText.errors.dayFileDigestMismatch);
  }
  const [days, settings] = await Promise.all([
    readBackupDayFiles(directory, manifest.dates, manifest.dayFileDigests),
    normalizeImportedSettings(manifest),
  ]);
  if (!days) {
    throw new Error(backupText.errors.dayFileDigestMismatch);
  }
  return { manifest, ...buildBrowserDataFromDays(settings, manifest.dates, days) };
}

export async function readBackupSnapshot(directory: FileSystemDirectoryHandle): Promise<ImportedBackupSnapshot> {
  const manifest = await readJson<BackupManifest>(directory, "manifest.json");
  return readBackupSnapshotFromManifest(directory, manifest);
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
  const snapshot = await readBackupSnapshotFromManifest(directory, manifest);
  await importDirectorySnapshot(directory, state, snapshot);
}
