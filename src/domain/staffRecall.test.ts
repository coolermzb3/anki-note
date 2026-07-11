import { describe, expect, it } from "vitest";
import { getNotesForGroups } from "./notes";
import {
  buildNoteNameColumns,
  buildStaffRecallAnswerSetKey,
  buildStaffRecallTargetNoteIds,
  columnDefinitionsForNoteNames,
  comparableStaffRecallRuns,
  formatStaffRecallDeltaMs,
  formatStaffRecallPerNoteDeltaMs,
  formatStaffRecallPerNoteMs,
  getStaffRecallTargetNoteSetKey,
  totalStaffRecallActiveMs,
} from "./staffRecall";
import type { NoteName, StaffRecallRunRecordV1 } from "./types";

const noteNames: NoteName[] = ["C", "D", "E", "F", "G", "A", "B"];
const columnActiveMs: Record<NoteName, number> = {
  C: 1000,
  D: 1100,
  E: 1200,
  F: 1300,
  G: 1400,
  A: 1500,
  B: 1600,
};

function makeRun(overrides: Partial<StaffRecallRunRecordV1> = {}): StaffRecallRunRecordV1 {
  const notes = getNotesForGroups(["G3-F4"], true);
  const targetNoteIds = buildStaffRecallTargetNoteIds(notes);
  return {
    id: "recall-1",
    schemaVersion: 1,
    answerSetKey: buildStaffRecallAnswerSetKey(targetNoteIds),
    targetNoteIds,
    columnOrder: noteNames,
    columnActiveMs,
    startedAt: "2026-07-10T10:00:00.000+08:00",
    endedAt: "2026-07-10T10:01:00.000+08:00",
    ...overrides,
  };
}

describe("staff recall", () => {
  it("uses the same note-name columns as the study map", () => {
    const withoutLedger = buildNoteNameColumns(
      getNotesForGroups(["G3-F4"], false),
      columnDefinitionsForNoteNames(noteNames),
    );
    const withLedger = buildNoteNameColumns(
      getNotesForGroups(["G3-F4"], true),
      columnDefinitionsForNoteNames(noteNames),
    );

    expect(withoutLedger.every((column) => column.notes.length === 1)).toBe(true);
    expect(withLedger.every((column) => column.notes.length === 2)).toBe(true);
  });

  it("compares runs by exact answer-set key and derives total active time", () => {
    const run = makeRun();
    const laterComparable = makeRun({ id: "recall-2", endedAt: "2026-07-11T10:01:00.000+08:00" });
    const otherRange = makeRun({ id: "recall-other", answerSetKey: "other" });

    expect(
      comparableStaffRecallRuns(
        [laterComparable, otherRange, run],
        getStaffRecallTargetNoteSetKey(run),
      ).map((item) => item.id),
    ).toEqual([
      "recall-1",
      "recall-2",
    ]);
    expect(totalStaffRecallActiveMs(run)).toBe(9100);
    expect(formatStaffRecallDeltaMs(-640)).toEqual({ direction: "faster", text: "(−0.6s)" });
    expect(formatStaffRecallDeltaMs(20)).toBeUndefined();
    expect(formatStaffRecallPerNoteMs(10150, 14)).toBe("725ms");
    expect(formatStaffRecallPerNoteDeltaMs(-420, 14)).toEqual({ direction: "faster", text: "(−30ms)" });
    expect(formatStaffRecallPerNoteDeltaMs(6, 14)).toBeUndefined();
  });
});
