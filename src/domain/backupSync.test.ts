import { describe, expect, it } from "vitest";
import { deriveBackupSyncState, type BackupSyncStateInput } from "./backupSync";

const baseInput: BackupSyncStateInput = {
  supportsFileBackups: true,
  hasDirectoryHandle: true,
  reminderSuppressedToday: false,
  hasBrowserPracticeData: true,
  hasBackupManifest: true,
  backupMatchesBrowserDataSet: true,
  hasLastSeenBackupVersion: true,
  backupVersionMatchesLastSeen: true,
};

describe("deriveBackupSyncState", () => {
  it.each([
    [
      "unsupported browser",
      { supportsFileBackups: false },
      { kind: "unsupported", canWriteBackup: false, showReminder: false },
    ],
    [
      "missing backup directory",
      { hasDirectoryHandle: false },
      { kind: "needs-directory", canWriteBackup: false, showReminder: true },
    ],
    [
      "missing backup directory suppressed today",
      { hasDirectoryHandle: false, reminderSuppressedToday: true },
      { kind: "needs-directory", canWriteBackup: false, showReminder: false },
    ],
    [
      "empty backup directory",
      { hasBackupManifest: false, hasLastSeenBackupVersion: false, backupVersionMatchesLastSeen: false },
      { kind: "ready", canWriteBackup: true, showReminder: false },
    ],
    [
      "empty browser with existing backup",
      { hasBrowserPracticeData: false, hasLastSeenBackupVersion: false, backupVersionMatchesLastSeen: false },
      {
        kind: "sync-before-backup",
        canWriteBackup: false,
        showReminder: true,
        confirmBeforeSync: false,
        reason: "empty-browser",
      },
    ],
    [
      "different data set",
      { backupMatchesBrowserDataSet: false },
      {
        kind: "sync-before-backup",
        canWriteBackup: false,
        showReminder: true,
        confirmBeforeSync: true,
        reason: "dataset-mismatch",
      },
    ],
    [
      "same data set but never synced",
      { hasLastSeenBackupVersion: false },
      {
        kind: "sync-before-backup",
        canWriteBackup: false,
        showReminder: true,
        confirmBeforeSync: true,
        reason: "unseen-backup",
      },
    ],
    [
      "backup changed since last sync",
      { backupVersionMatchesLastSeen: false },
      {
        kind: "sync-before-backup",
        canWriteBackup: false,
        showReminder: true,
        confirmBeforeSync: true,
        reason: "backup-updated",
      },
    ],
    ["synced browser and backup", {}, { kind: "ready", canWriteBackup: true, showReminder: false }],
  ])("%s", (_label, patch, expected) => {
    expect(deriveBackupSyncState({ ...baseInput, ...patch })).toEqual(expected);
  });
});
