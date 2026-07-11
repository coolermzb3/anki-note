import { describe, expect, it } from "vitest";
import { buildBackupSnapshot, getBackupManifestVersion } from "./backupSnapshot";
import { makeReview } from "./testFactories";
import type { AppSettings, PracticeSessionRecord, StaffRecallRunRecord } from "./types";

const settings: AppSettings = {
  id: "default",
  schemaVersion: 2,
  staffNotationMode: "grand",
  dataSetId: "dataset-1",
  createdAt: "2026-07-04T00:00:00.000+08:00",
  firstReviewAt: "2026-07-04T10:00:00.000+08:00",
  enabledGroupIds: ["G3-F4"],
  defaultMode: "open-ended",
  promptDisplayMode: "single-note",
  promptNoteDuration: "whole",
  fixedCount: 20,
  fixedDurationSeconds: 180,
  autoPlayTarget: true,
  includeInterStaffLedgerSpellings: true,
  pianoVolume: 0.8,
  queueStrategy: "adaptive",
  drillNoteNames: ["C"],
  focusedTraining: false,
  inactivityThresholdSeconds: 30,
  correctDelayMs: 400,
};

const session: PracticeSessionRecord = {
  id: "session-1",
  schemaVersion: 1,
  mode: "open-ended",
  enabledGroupIds: ["G3-F4"],
  startedAt: "2026-07-04T10:00:00.000+08:00",
  endedAt: "2026-07-04T10:05:00.000+08:00",
  endReason: "manual-stop",
  completedCount: 1,
  interruptedCount: 0,
};

const staffRecallRun: StaffRecallRunRecord = {
  id: "recall-1",
  schemaVersion: 1,
  answerSetKey: "C4|D4|E4|F4|G3|A3|B3",
  targetNoteIds: ["C4", "D4", "E4", "F4", "G3", "A3", "B3"],
  columnOrder: ["F", "C", "G", "D", "A", "E", "B"],
  columnActiveMs: { C: 1000, D: 1000, E: 1000, F: 1000, G: 1000, A: 1000, B: 1000 },
  startedAt: "2026-07-05T11:00:00.000+08:00",
  endedAt: "2026-07-05T11:01:00.000+08:00",
};

describe("backup snapshot", () => {
  it("partitions backup files by local date and records manifest dates", () => {
    const snapshot = buildBackupSnapshot(
      settings,
      [session],
      [
        makeReview({ targetNoteId: "C4", startedAt: "2026-07-04T10:00:00.000+08:00", endedAt: "2026-07-04T10:00:02.000+08:00" }),
        makeReview({ targetNoteId: "D4", startedAt: "2026-07-05T10:00:00.000+08:00", endedAt: "2026-07-05T10:00:02.000+08:00" }),
      ],
      "2026-07-05T23:00:00.000+08:00",
    );

    expect(snapshot.manifest.dates).toEqual(["2026-07-04", "2026-07-05"]);
    expect(snapshot.manifest.dataModifiedAt).toBe("2026-07-05T10:00:02.000+08:00");
    expect(snapshot.manifest.snapshotId).toEqual(expect.any(String));
    expect(snapshot.manifest.settings).toEqual(settings);
    expect(snapshot.days["2026-07-04"].sessions).toHaveLength(1);
    expect(snapshot.days["2026-07-05"].reviews).toHaveLength(1);
  });

  it("includes staff-recall runs in dated backup data", () => {
    const snapshot = buildBackupSnapshot(settings, [], [], "2026-07-05T23:00:00.000+08:00", [staffRecallRun]);

    expect(snapshot.manifest.dates).toEqual(["2026-07-05"]);
    expect(snapshot.manifest.lastStaffRecallRunId).toBe("recall-1");
    expect(snapshot.manifest.dataModifiedAt).toBe(staffRecallRun.endedAt);
    expect(snapshot.days["2026-07-05"].staffRecallRuns).toEqual([staffRecallRun]);
  });

  it("keeps the legacy manifest version stable when no staff-recall field exists", () => {
    expect(
      getBackupManifestVersion({
        schemaVersion: 1,
        dataSetId: "dataset-1",
        createdAt: "2026-07-04T00:00:00.000+08:00",
        lastBackupAt: "2026-07-05T23:00:00.000+08:00",
        lastReviewId: "review-1",
        dates: ["2026-07-04", "2026-07-05"],
      }),
    ).toBe("legacy:dataset-1:2026-07-05T23:00:00.000+08:00:review-1:2026-07-04,2026-07-05");
  });
});
