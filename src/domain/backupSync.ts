export type BackupDataStatus = "needs-directory" | "ready" | "browser-only" | "backup-only" | "diverged";
export type BackupDomainDecision = "conflict" | "same" | "unknown" | "use-backup" | "use-browser";

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

export function decideBackupDomainSync({
  backupDigest,
  browserDigest,
  lastSeenDigest,
}: {
  backupDigest?: string;
  browserDigest: string;
  lastSeenDigest?: string;
}): BackupDomainDecision {
  if (!backupDigest) {
    return "unknown";
  }
  if (browserDigest === backupDigest) {
    return "same";
  }
  if (!lastSeenDigest) {
    return "unknown";
  }
  if (browserDigest === lastSeenDigest) {
    return "use-backup";
  }
  if (backupDigest === lastSeenDigest) {
    return "use-browser";
  }
  return "conflict";
}

export function shouldRunBackupEntryPreflight(view: "practice" | "vocal" | null, practiceRunning: boolean): boolean {
  return view === "vocal" || (view === "practice" && !practiceRunning);
}
