import { describe, expect, it } from "vitest";
import { getBackupConflictDataSummaries } from "./backupText";

describe("backup conflict summaries", () => {
  it("highlights backup data when it covers the browser range and count", () => {
    expect(
      getBackupConflictDataSummaries({
        conflictBackupFirstReviewAt: "2026-07-04T05:36:52.000+08:00",
        conflictBackupLastReviewAt: "2026-07-07T02:04:15.000+08:00",
        conflictBackupReviewCount: 2291,
        conflictBackupStaffRecallRunCount: 0,
        conflictBrowserFirstReviewAt: "2026-07-04T05:36:52.000+08:00",
        conflictBrowserLastReviewAt: "2026-07-06T22:09:46.000+08:00",
        conflictBrowserReviewCount: 2034,
        conflictBrowserStaffRecallRunCount: 0,
      }).highlighted,
    ).toBe("backup");
  });

  it("highlights browser data when it covers the backup range and count", () => {
    expect(
      getBackupConflictDataSummaries({
        conflictBackupFirstReviewAt: "2026-07-06T18:26:02.000+08:00",
        conflictBackupLastReviewAt: "2026-07-06T18:37:02.000+08:00",
        conflictBackupReviewCount: 69,
        conflictBackupStaffRecallRunCount: 0,
        conflictBrowserFirstReviewAt: "2026-07-04T05:36:52.000+08:00",
        conflictBrowserLastReviewAt: "2026-07-07T02:04:15.000+08:00",
        conflictBrowserReviewCount: 2291,
        conflictBrowserStaffRecallRunCount: 0,
      }).highlighted,
    ).toBe("browser");
  });

  it("does not highlight when the wider range has fewer reviews", () => {
    expect(
      getBackupConflictDataSummaries({
        conflictBackupFirstReviewAt: "2026-07-04T05:36:52.000+08:00",
        conflictBackupLastReviewAt: "2026-07-07T02:04:15.000+08:00",
        conflictBackupReviewCount: 100,
        conflictBackupStaffRecallRunCount: 0,
        conflictBrowserFirstReviewAt: "2026-07-04T05:36:52.000+08:00",
        conflictBrowserLastReviewAt: "2026-07-06T22:09:46.000+08:00",
        conflictBrowserReviewCount: 2034,
        conflictBrowserStaffRecallRunCount: 0,
      }).highlighted,
    ).toBeNull();
  });

  it("does not highlight identical ranges and counts", () => {
    expect(
      getBackupConflictDataSummaries({
        conflictBackupFirstReviewAt: "2026-07-04T05:36:52.000+08:00",
        conflictBackupLastReviewAt: "2026-07-07T02:04:15.000+08:00",
        conflictBackupReviewCount: 2291,
        conflictBackupStaffRecallRunCount: 0,
        conflictBrowserFirstReviewAt: "2026-07-04T05:36:52.000+08:00",
        conflictBrowserLastReviewAt: "2026-07-07T02:04:15.000+08:00",
        conflictBrowserReviewCount: 2291,
        conflictBrowserStaffRecallRunCount: 0,
      }).highlighted,
    ).toBeNull();
  });

  it("does not treat different record categories as covering each other", () => {
    expect(
      getBackupConflictDataSummaries({
        conflictBackupFirstDataAt: "2026-07-04T05:36:52.000+08:00",
        conflictBackupLastDataAt: "2026-07-07T02:04:15.000+08:00",
        conflictBackupRecordCount: 10,
        conflictBackupReviewCount: 0,
        conflictBackupStaffRecallRunCount: 10,
        conflictBrowserFirstDataAt: "2026-07-05T05:36:52.000+08:00",
        conflictBrowserLastDataAt: "2026-07-06T02:04:15.000+08:00",
        conflictBrowserRecordCount: 5,
        conflictBrowserReviewCount: 5,
        conflictBrowserStaffRecallRunCount: 0,
      }).highlighted,
    ).toBeNull();
  });
});
