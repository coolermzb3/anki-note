import { describe, expect, it } from "vitest";
import {
  decideBackupDomainSync,
  deriveBackupDataStatus,
  shouldRunBackupEntryPreflight,
  type BackupDataStatusInput,
} from "./backupSync";

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

describe("shouldRunBackupEntryPreflight", () => {
  it.each([
    ["idle practice", "practice", false, true],
    ["running practice", "practice", true, false],
    ["vocal workspace", "vocal", false, true],
    ["non-activity page", null, false, false],
  ] as const)("checks %s", (_label, view, practiceRunning, expected) => {
    expect(shouldRunBackupEntryPreflight(view, practiceRunning)).toBe(expected);
  });
});

describe("decideBackupDomainSync", () => {
  it.each([
    ["matching sides", "base", "base", "base", "same"],
    ["browser-only change", "base", "browser-next", "base", "use-browser"],
    ["backup-only change", "base", "base", "backup-next", "use-backup"],
    ["matching concurrent change", "base", "next", "next", "same"],
    ["different concurrent changes", "base", "browser-next", "backup-next", "conflict"],
    ["missing baseline", undefined, "browser", "backup", "unknown"],
    ["missing backup digest", "base", "browser", undefined, "unknown"],
  ] as const)("handles %s", (_label, lastSeenDigest, browserDigest, backupDigest, expected) => {
    expect(decideBackupDomainSync({ backupDigest, browserDigest, lastSeenDigest })).toBe(expected);
  });
});
