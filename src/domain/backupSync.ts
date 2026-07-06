export type BackupDataStatus = "needs-directory" | "ready" | "browser-only" | "backup-only" | "diverged";

export interface BackupDataStatusInput {
  hasDirectoryHandle: boolean;
  hasBrowserData: boolean;
  hasBackupManifest: boolean;
  dataConsistent: boolean;
}

export function deriveBackupDataStatus(input: BackupDataStatusInput): BackupDataStatus {
  if (!input.hasDirectoryHandle) {
    return "needs-directory";
  }

  if (!input.hasBackupManifest) {
    return input.hasBrowserData ? "browser-only" : "ready";
  }

  if (!input.hasBrowserData) {
    return "backup-only";
  }

  return input.dataConsistent ? "ready" : "diverged";
}
