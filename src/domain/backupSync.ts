export type BackupSyncBlockReason = "empty-browser" | "dataset-mismatch" | "unseen-backup" | "backup-updated";

export type BackupSyncState =
  | {
      kind: "unsupported";
      canWriteBackup: false;
      showReminder: false;
    }
  | {
      kind: "needs-directory";
      canWriteBackup: false;
      showReminder: boolean;
    }
  | {
      kind: "ready";
      canWriteBackup: true;
      showReminder: false;
    }
  | {
      kind: "sync-before-backup";
      canWriteBackup: false;
      showReminder: true;
      confirmBeforeSync: boolean;
      reason: BackupSyncBlockReason;
    };

export interface BackupSyncStateInput {
  supportsFileBackups: boolean;
  hasDirectoryHandle: boolean;
  reminderSuppressedToday: boolean;
  hasBrowserPracticeData: boolean;
  hasBackupManifest: boolean;
  backupMatchesBrowserDataSet: boolean;
  hasLastSeenBackupVersion: boolean;
  backupVersionMatchesLastSeen: boolean;
}

export function deriveBackupSyncState(input: BackupSyncStateInput): BackupSyncState {
  if (!input.supportsFileBackups) {
    return { kind: "unsupported", canWriteBackup: false, showReminder: false };
  }

  if (!input.hasDirectoryHandle) {
    return {
      kind: "needs-directory",
      canWriteBackup: false,
      showReminder: !input.reminderSuppressedToday,
    };
  }

  if (!input.hasBackupManifest) {
    return { kind: "ready", canWriteBackup: true, showReminder: false };
  }

  if (!input.hasBrowserPracticeData) {
    return {
      kind: "sync-before-backup",
      canWriteBackup: false,
      showReminder: true,
      confirmBeforeSync: false,
      reason: "empty-browser",
    };
  }

  if (!input.backupMatchesBrowserDataSet) {
    return {
      kind: "sync-before-backup",
      canWriteBackup: false,
      showReminder: true,
      confirmBeforeSync: true,
      reason: "dataset-mismatch",
    };
  }

  if (!input.hasLastSeenBackupVersion) {
    return {
      kind: "sync-before-backup",
      canWriteBackup: false,
      showReminder: true,
      confirmBeforeSync: true,
      reason: "unseen-backup",
    };
  }

  if (!input.backupVersionMatchesLastSeen) {
    return {
      kind: "sync-before-backup",
      canWriteBackup: false,
      showReminder: true,
      confirmBeforeSync: true,
      reason: "backup-updated",
    };
  }

  return { kind: "ready", canWriteBackup: true, showReminder: false };
}
