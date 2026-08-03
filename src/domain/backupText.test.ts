import { describe, expect, it } from "vitest";
import { getBackupConflictDataSummaries } from "./backupText";

describe("backup conflict summaries", () => {
  it("summarizes learning and vocal-audio data for both sources", () => {
    const summaries = getBackupConflictDataSummaries({
      conflictBackupFirstDataAt: "2026-07-04T05:36:52.000+08:00",
      conflictBackupLastDataAt: "2026-07-07T02:04:15.000+08:00",
      conflictBackupRecordCount: 12,
      conflictBackupVocalAudioCounts: { materialCount: 2, recordingCount: 1, uploadCount: 1 },
      conflictBrowserFirstDataAt: "2026-07-05T05:36:52.000+08:00",
      conflictBrowserLastDataAt: "2026-07-06T02:04:15.000+08:00",
      conflictBrowserRecordCount: 5,
      conflictBrowserVocalAudioCounts: { materialCount: 3, recordingCount: 2, uploadCount: 1 },
    });

    expect(summaries.backup).toMatchObject({
      recordCount: 12,
      vocalAudioCounts: { materialCount: 2, recordingCount: 1, uploadCount: 1 },
    });
    expect(summaries.browser).toMatchObject({
      recordCount: 5,
      vocalAudioCounts: { materialCount: 3, recordingCount: 2, uploadCount: 1 },
    });
  });

  it("falls back to legacy review summary fields", () => {
    const summaries = getBackupConflictDataSummaries({
      conflictBackupFirstReviewAt: "2026-07-04T05:36:52.000+08:00",
      conflictBackupLastReviewAt: "2026-07-07T02:04:15.000+08:00",
      conflictBackupReviewCount: 12,
      conflictBackupVocalAudioCounts: { materialCount: 0, recordingCount: 0, uploadCount: 0 },
      conflictBrowserFirstReviewAt: "2026-07-05T05:36:52.000+08:00",
      conflictBrowserLastReviewAt: "2026-07-06T02:04:15.000+08:00",
      conflictBrowserReviewCount: 5,
      conflictBrowserVocalAudioCounts: { materialCount: 0, recordingCount: 0, uploadCount: 0 },
    });

    expect(summaries.backup.recordCount).toBe(12);
    expect(summaries.browser.recordCount).toBe(5);
  });
});
