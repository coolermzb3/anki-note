import { describe, expect, it } from "vitest";
import { deriveBackupDataStatus, type BackupDataStatusInput } from "./backupSync";

const baseInput: BackupDataStatusInput = {
  hasDirectoryHandle: true,
  hasBrowserData: true,
  hasBackupManifest: true,
  dataConsistent: true,
};

describe("deriveBackupDataStatus", () => {
  it.each([
    ["waiting for directory", { hasDirectoryHandle: false }, "needs-directory"],
    ["empty browser and empty selected directory", { hasBrowserData: false, hasBackupManifest: false }, "ready"],
    ["browser data with empty selected directory", { hasBackupManifest: false }, "browser-only"],
    ["empty browser with backup data", { hasBrowserData: false }, "backup-only"],
    ["consistent browser and backup data", {}, "ready"],
    ["diverged browser and backup data", { dataConsistent: false }, "diverged"],
  ])("%s", (_label, patch, expected) => {
    expect(deriveBackupDataStatus({ ...baseInput, ...patch })).toBe(expected);
  });
});
