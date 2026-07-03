import { describe, expect, it } from "vitest";
import { buildBackupSnapshot } from "./backupSnapshot";
import { makeReview } from "./testFactories";
import type { AppSettings, PracticeSessionRecord } from "./types";

const settings: AppSettings = {
  id: "default",
  schemaVersion: 1,
  dataSetId: "dataset-1",
  createdAt: "2026-07-04T00:00:00.000+08:00",
  firstReviewAt: "2026-07-04T10:00:00.000+08:00",
  enabledGroupIds: ["C4-B4"],
  defaultMode: "open-ended",
  fixedCount: 20,
  fixedDurationSeconds: 180,
  autoPlayTarget: true,
  inactivityThresholdSeconds: 30,
  correctDelayMs: 400,
};

const session: PracticeSessionRecord = {
  id: "session-1",
  schemaVersion: 1,
  mode: "open-ended",
  enabledGroupIds: ["C4-B4"],
  startedAt: "2026-07-04T10:00:00.000+08:00",
  endedAt: "2026-07-04T10:05:00.000+08:00",
  endReason: "manual-stop",
  completedCount: 1,
  interruptedCount: 0,
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
    expect(snapshot.days["2026-07-04"].sessions).toHaveLength(1);
    expect(snapshot.days["2026-07-05"].reviews).toHaveLength(1);
  });
});
