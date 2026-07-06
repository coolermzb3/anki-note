import { describe, expect, it } from "vitest";
import { getBackupConflictDataSummaries } from "./backupText";

describe("backup conflict summaries", () => {
  it("highlights backup data when it covers the browser range and count", () => {
    expect(
      getBackupConflictDataSummaries({
        conflictBackupFirstReviewAt: "2026-07-04T05:36:52.000+08:00",
        conflictBackupLastReviewAt: "2026-07-07T02:04:15.000+08:00",
        conflictBackupReviewCount: 2291,
        conflictBrowserFirstReviewAt: "2026-07-04T05:36:52.000+08:00",
        conflictBrowserLastReviewAt: "2026-07-06T22:09:46.000+08:00",
        conflictBrowserReviewCount: 2034,
      }).highlighted,
    ).toBe("backup");
  });

  it("highlights browser data when it covers the backup range and count", () => {
    expect(
      getBackupConflictDataSummaries({
        conflictBackupFirstReviewAt: "2026-07-06T18:26:02.000+08:00",
        conflictBackupLastReviewAt: "2026-07-06T18:37:02.000+08:00",
        conflictBackupReviewCount: 69,
        conflictBrowserFirstReviewAt: "2026-07-04T05:36:52.000+08:00",
        conflictBrowserLastReviewAt: "2026-07-07T02:04:15.000+08:00",
        conflictBrowserReviewCount: 2291,
      }).highlighted,
    ).toBe("browser");
  });

  it("does not highlight when the wider range has fewer reviews", () => {
    expect(
      getBackupConflictDataSummaries({
        conflictBackupFirstReviewAt: "2026-07-04T05:36:52.000+08:00",
        conflictBackupLastReviewAt: "2026-07-07T02:04:15.000+08:00",
        conflictBackupReviewCount: 100,
        conflictBrowserFirstReviewAt: "2026-07-04T05:36:52.000+08:00",
        conflictBrowserLastReviewAt: "2026-07-06T22:09:46.000+08:00",
        conflictBrowserReviewCount: 2034,
      }).highlighted,
    ).toBeNull();
  });

  it("does not highlight identical ranges and counts", () => {
    expect(
      getBackupConflictDataSummaries({
        conflictBackupFirstReviewAt: "2026-07-04T05:36:52.000+08:00",
        conflictBackupLastReviewAt: "2026-07-07T02:04:15.000+08:00",
        conflictBackupReviewCount: 2291,
        conflictBrowserFirstReviewAt: "2026-07-04T05:36:52.000+08:00",
        conflictBrowserLastReviewAt: "2026-07-07T02:04:15.000+08:00",
        conflictBrowserReviewCount: 2291,
      }).highlighted,
    ).toBeNull();
  });
});
