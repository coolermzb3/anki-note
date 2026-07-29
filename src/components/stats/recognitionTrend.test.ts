import { describe, expect, it } from "vitest";

import { getNotesForGroups } from "../../domain/notes";
import { groupRecognitionTrendByDay, type RecognitionTrendPoint } from "../../domain/stats";
import { buildTargetNoteSetKey } from "../../domain/targetNoteSet";
import type { PracticeGroupId, PracticeSessionRecordV2, TargetNoteId } from "../../domain/types";
import {
  applyRecognitionRangeTransitions,
  findRecognitionRangeTransitions,
  type RecognitionRangeTransition,
} from "./recognitionTrend";

const ORIGINAL_GROUPS: PracticeGroupId[] = ["G3-F4"];
const EXPANDED_GROUPS: PracticeGroupId[] = ["G3-F4", "G4-F5"];
const originalNotes = getNotesForGroups(ORIGINAL_GROUPS, false, "grand");
const expandedNotes = getNotesForGroups(EXPANDED_GROUPS, false, "grand");
const originalIds = originalNotes.map((note) => note.id);
const expandedIds = expandedNotes.map((note) => note.id);
const addedIds = expandedIds.filter((noteId) => !originalIds.includes(noteId));

function makeSession(id: string, startedAt: string, enabledGroupIds: PracticeGroupId[]): PracticeSessionRecordV2 {
  const targetNoteIds = getNotesForGroups(enabledGroupIds, false, "grand").map((note) => note.id);
  return {
    completedCount: 20,
    drillNoteNames: [],
    effectiveQueueAlgorithm: "adaptive-v2",
    enabledGroupIds,
    fixedCount: 20,
    id,
    includeInterStaffLedgerSpellings: false,
    interruptedCount: 0,
    mode: "fixed-count",
    promptDisplayMode: "staff-page",
    queueStrategy: "adaptive",
    schemaVersion: 2,
    staffNotationMode: "grand",
    startedAt,
    targetNoteSetKey: buildTargetNoteSetKey(targetNoteIds),
  };
}

function makePoint(
  key: string,
  boundaryAt: string,
  coveredNoteIds: TargetNoteId[],
  medianMs: number,
): RecognitionTrendPoint {
  return {
    boundaryAt,
    coveredNoteCount: coveredNoteIds.length,
    coveredNoteIds,
    errorRate: 0.1,
    key,
    medianMs,
    p10Ms: medianMs / 2,
    p90Ms: medianMs * 2,
    totalNoteCount: expandedIds.length,
  };
}

describe("recognition range transitions", () => {
  const sessions = [
    makeSession("original-1", "2026-07-01T10:00:00.000+08:00", ORIGINAL_GROUPS),
    makeSession("expanded-1", "2026-07-02T10:00:00.000+08:00", EXPANDED_GROUPS),
    makeSession("original-2", "2026-07-03T10:00:00.000+08:00", ORIGINAL_GROUPS),
    makeSession("expanded-2", "2026-07-04T10:00:00.000+08:00", EXPANDED_GROUPS),
  ];
  const trend = [
    makePoint("before", "2026-07-03T10:05:00.000+08:00", originalIds, 1000),
    makePoint("start", "2026-07-04T10:05:00.000+08:00", [...originalIds, addedIds[0]], 2000),
    makePoint("middle", "2026-07-04T11:05:00.000+08:00", [...originalIds, ...addedIds.slice(0, 3)], 2500),
    makePoint("complete", "2026-07-05T10:05:00.000+08:00", expandedIds, 3000),
  ];

  it("starts from the latest reactivation while retaining cumulative coverage", () => {
    const transitions = findRecognitionRangeTransitions(sessions, expandedNotes, trend)
      .filter((transition) => transition.kind === "expansion");

    expect(transitions).toEqual([{
      baselineNoteIds: originalIds,
      completedAt: trend[3].boundaryAt,
      fromNoteCount: originalIds.length,
      kind: "expansion",
      startedAt: trend[1].boundaryAt,
      toNoteCount: expandedIds.length,
    }]);
  });

  it("retains an unfinished expansion across an unrelated temporary range", () => {
    const unrelatedGroups: PracticeGroupId[] = ["G2-F3"];
    const matureBeforeReactivation = [...originalIds, addedIds[0]];
    const rangeSessions = [
      makeSession("original", "2026-07-01T10:00:00.000+08:00", ORIGINAL_GROUPS),
      makeSession("first-attempt", "2026-07-02T10:00:00.000+08:00", EXPANDED_GROUPS),
      makeSession("unrelated", "2026-07-03T10:00:00.000+08:00", unrelatedGroups),
      makeSession("reactivated", "2026-07-04T10:00:00.000+08:00", EXPANDED_GROUPS),
    ];
    const rangeTrend = [
      makePoint("original", "2026-07-01T10:05:00.000+08:00", originalIds, 1000),
      makePoint("first-attempt", "2026-07-02T10:05:00.000+08:00", [...originalIds, addedIds[0]], 1100),
      makePoint("unrelated", "2026-07-03T10:05:00.000+08:00", [...originalIds, addedIds[0]], 1200),
      makePoint("reactivated", "2026-07-04T10:05:00.000+08:00", [...originalIds, ...addedIds.slice(0, 3)], 1300),
      makePoint("ready", "2026-07-05T10:05:00.000+08:00", expandedIds, 1400),
    ];

    expect(findRecognitionRangeTransitions(rangeSessions, expandedNotes, rangeTrend)
      .filter((transition) => transition.kind === "expansion")).toEqual([{
      baselineNoteIds: matureBeforeReactivation,
      completedAt: rangeTrend[4].boundaryAt,
      fromNoteCount: matureBeforeReactivation.length,
      kind: "expansion",
      startedAt: rangeTrend[3].boundaryAt,
      toNoteCount: expandedIds.length,
    }]);
  });

  it("hides an expansion when the current range has been disabled", () => {
    expect(findRecognitionRangeTransitions(sessions, originalNotes, trend)
      .filter((transition) => transition.kind === "expansion")).toEqual([]);
    expect(findRecognitionRangeTransitions([
      ...sessions,
      makeSession("original-3", "2026-07-06T10:00:00.000+08:00", ORIGINAL_GROUPS),
    ], originalNotes, trend).filter((transition) => transition.kind === "expansion")).toEqual([]);
  });

  it("keeps transition metrics on the established cohort until the full range is ready", () => {
    const transition = findRecognitionRangeTransitions(sessions, expandedNotes, trend)
      .find((candidate) => candidate.kind === "expansion")!;
    const baselineTrend = [
      makePoint("before", trend[0].boundaryAt, originalIds, 1000),
      makePoint("start", trend[1].boundaryAt, originalIds, 1100),
      makePoint("middle", trend[2].boundaryAt, originalIds, 1200),
      makePoint("complete", trend[3].boundaryAt, originalIds, 1300),
    ];
    const result = applyRecognitionRangeTransitions(
      trend,
      [{ transition, trend: baselineTrend }],
      "practice-session",
    );

    expect(result.map((point) => point.medianMs)).toEqual([1000, 1100, 1200, 3000]);
    expect(result.map((point) => point.relativeBaseline?.medianMs)).toEqual([undefined, undefined, undefined, 1000]);
    expect(result.map((point) => point.transition)).toEqual([false, true, true, false]);
    expect(result.map((point) => point.breakBefore)).toEqual([false, true, false, true]);
    expect(result.map((point) => point.boundaryLabel)).toEqual([
      undefined,
      `开始扩展 ${originalIds.length}→${expandedIds.length}`,
      undefined,
      "新范围已纳入",
    ]);
  });

  it("anchors the completed range to the last formal point before the transition", () => {
    const rangeTrend = [
      makePoint("formal-start", "2026-07-01T10:05:00.000+08:00", originalIds, 1000),
      makePoint("formal-end", "2026-07-02T10:05:00.000+08:00", originalIds, 800),
      makePoint("transition", "2026-07-03T10:05:00.000+08:00", [...originalIds, addedIds[0]], 900),
      makePoint("complete", "2026-07-04T10:05:00.000+08:00", expandedIds, 1200),
    ];
    const transition: RecognitionRangeTransition = {
      baselineNoteIds: originalIds,
      completedAt: rangeTrend[3].boundaryAt,
      fromNoteCount: originalIds.length,
      kind: "expansion",
      startedAt: rangeTrend[2].boundaryAt,
      toNoteCount: expandedIds.length,
    };
    const baselineTrend = rangeTrend.map((point, index) => ({
      ...point,
      coveredNoteCount: originalIds.length,
      coveredNoteIds: originalIds,
      medianMs: [1000, 800, 850, 900][index],
    }));

    const result = applyRecognitionRangeTransitions(
      rangeTrend,
      [{ transition, trend: baselineTrend }],
      "practice-session",
    );

    expect(result.map((point) => point.medianMs)).toEqual([1000, 800, 850, 1200]);
    expect(result.map((point) => point.relativeBaseline?.medianMs)).toEqual([undefined, undefined, undefined, 800]);
  });

  it("does not start a new transition when restoring an already mature range", () => {
    const rangeSessions = [
      makeSession("original", "2026-07-01T10:00:00.000+08:00", ORIGINAL_GROUPS),
      makeSession("expanded", "2026-07-02T10:00:00.000+08:00", EXPANDED_GROUPS),
      makeSession("contracted", "2026-07-04T10:00:00.000+08:00", ORIGINAL_GROUPS),
      makeSession("restored", "2026-07-05T10:00:00.000+08:00", EXPANDED_GROUPS),
    ];
    const rangeTrend = [
      makePoint("original", "2026-07-01T10:05:00.000+08:00", originalIds, 1000),
      makePoint("expanded", "2026-07-02T10:05:00.000+08:00", [...originalIds, addedIds[0]], 1100),
      makePoint("ready", "2026-07-03T10:05:00.000+08:00", expandedIds, 1200),
      makePoint("contracted", "2026-07-04T10:05:00.000+08:00", expandedIds, 1300),
      makePoint("restored", "2026-07-05T10:05:00.000+08:00", expandedIds, 1400),
    ];

    const transitions = findRecognitionRangeTransitions(rangeSessions, expandedNotes, rangeTrend)
      .filter((transition) => transition.kind === "expansion");

    expect(transitions).toHaveLength(1);
    expect(transitions[0]).toMatchObject({
      completedAt: rangeTrend[2].boundaryAt,
      startedAt: rangeTrend[1].boundaryAt,
    });
  });

  it("does not add a boundary when a range matured while a larger range was active", () => {
    const fullGroups: PracticeGroupId[] = ["G2-F3", ...EXPANDED_GROUPS];
    const rangeSessions = [
      makeSession("original", "2026-07-01T10:00:00.000+08:00", ORIGINAL_GROUPS),
      makeSession("expanded-attempt", "2026-07-02T10:00:00.000+08:00", EXPANDED_GROUPS),
      makeSession("full", "2026-07-03T10:00:00.000+08:00", fullGroups),
      makeSession("restored", "2026-07-04T10:00:00.000+08:00", EXPANDED_GROUPS),
    ];
    const rangeTrend = [
      makePoint("original", "2026-07-01T10:05:00.000+08:00", originalIds, 1000),
      makePoint("expanded-attempt", "2026-07-02T10:05:00.000+08:00", [...originalIds, addedIds[0]], 1100),
      makePoint("matured-in-full", "2026-07-03T10:05:00.000+08:00", expandedIds, 1200),
      makePoint("restored", "2026-07-04T10:05:00.000+08:00", expandedIds, 1300),
    ];

    const expansions = findRecognitionRangeTransitions(rangeSessions, expandedNotes, rangeTrend)
      .filter((transition) => transition.kind === "expansion");

    expect(expansions).toEqual([]);
  });

  it("does not treat restoring the initially mature range as an expansion", () => {
    const rangeSessions = [
      makeSession("expanded", "2026-07-01T10:00:00.000+08:00", EXPANDED_GROUPS),
      makeSession("contracted", "2026-07-02T10:00:00.000+08:00", ORIGINAL_GROUPS),
      makeSession("restored", "2026-07-03T10:00:00.000+08:00", EXPANDED_GROUPS),
    ];
    const rangeTrend = [
      makePoint("expanded", "2026-07-01T10:05:00.000+08:00", expandedIds, 1000),
      makePoint("contracted", "2026-07-02T10:05:00.000+08:00", expandedIds, 1100),
      makePoint("restored", "2026-07-03T10:05:00.000+08:00", expandedIds, 1200),
    ];

    const transitions = findRecognitionRangeTransitions(rangeSessions, expandedNotes, rangeTrend);

    expect(transitions.filter((transition) => transition.kind === "expansion")).toEqual([]);
    expect(transitions.filter((transition) => transition.kind === "cold-start")).toHaveLength(1);
  });

  it("shows cold start as a faded 0-to-range phase until every note is ready", () => {
    const rangeSessions = [
      makeSession("initial", "2026-07-01T10:00:00.000+08:00", ORIGINAL_GROUPS),
    ];
    const rangeTrend = [
      { ...makePoint("empty", "2026-07-01T10:05:00.000+08:00", [], 0), medianMs: undefined,
        p10Ms: undefined, p90Ms: undefined },
      makePoint("partial", "2026-07-01T11:05:00.000+08:00", originalIds.slice(0, 2), 1100),
      makePoint("ready", "2026-07-02T10:05:00.000+08:00", originalIds, 1200),
    ];

    const transitions = findRecognitionRangeTransitions(rangeSessions, originalNotes, rangeTrend);
    expect(transitions).toEqual([{
      baselineNoteIds: [],
      completedAt: rangeTrend[2].boundaryAt,
      fromNoteCount: 0,
      kind: "cold-start",
      startedAt: rangeTrend[0].boundaryAt,
      toNoteCount: originalIds.length,
    }]);

    const result = applyRecognitionRangeTransitions(
      rangeTrend,
      [{ transition: transitions[0], trend: [] }],
      "practice-session",
    );
    expect(result.map((point) => point.transitionKind)).toEqual(["cold-start", "cold-start", undefined]);
    expect(result.map((point) => point.boundaryLabel)).toEqual([
      `开始积累 0→${originalIds.length}`,
      undefined,
      "初始范围已纳入",
    ]);
    expect(result.map((point) => point.medianMs)).toEqual([undefined, 1100, 1200]);
    expect(result.map((point) => point.relativeBaseline?.medianMs)).toEqual([undefined, undefined, undefined]);
  });

  it("uses the actual mature cohort when early range changes mature extra notes", () => {
    const matureBeforeExpansion = [...originalIds, ...addedIds.slice(0, 3)];
    const rangeSessions = [
      makeSession("initial-1", "2026-07-01T09:00:00.000+08:00", ORIGINAL_GROUPS),
      makeSession("initial-2", "2026-07-01T10:00:00.000+08:00", ORIGINAL_GROUPS),
      makeSession("expanded", "2026-07-02T10:00:00.000+08:00", EXPANDED_GROUPS),
    ];
    const rangeTrend = [
      makePoint("partial", "2026-07-01T09:05:00.000+08:00", originalIds.slice(0, 2), 1000),
      makePoint("initial-ready", "2026-07-01T10:05:00.000+08:00", matureBeforeExpansion, 1100),
      makePoint("expanded-start", "2026-07-02T10:05:00.000+08:00", matureBeforeExpansion, 1200),
      makePoint("expanded-ready", "2026-07-03T10:05:00.000+08:00", expandedIds, 1300),
    ];

    const transitions = findRecognitionRangeTransitions(rangeSessions, expandedNotes, rangeTrend);

    expect(transitions.map((transition) => ({
      baselineNoteIds: transition.baselineNoteIds,
      fromNoteCount: transition.fromNoteCount,
      toNoteCount: transition.toNoteCount,
    }))).toEqual([
      {
        baselineNoteIds: [],
        fromNoteCount: 0,
        toNoteCount: matureBeforeExpansion.length,
      },
      {
        baselineNoteIds: matureBeforeExpansion,
        fromNoteCount: matureBeforeExpansion.length,
        toNoteCount: expandedIds.length,
      },
    ]);
  });

  it("collapses a same-day start and completion into one daily boundary", () => {
    const sameDayTransition: RecognitionRangeTransition = {
      baselineNoteIds: originalIds,
      completedAt: trend[2].boundaryAt,
      fromNoteCount: originalIds.length,
      kind: "expansion",
      startedAt: trend[1].boundaryAt,
      toNoteCount: expandedIds.length,
    };
    const daily = groupRecognitionTrendByDay(trend.slice(0, 3));
    const result = applyRecognitionRangeTransitions(
      daily,
      [{ transition: sameDayTransition, trend: [] }],
      "day",
    );

    expect(result).toHaveLength(2);
    expect(result[1]).toMatchObject({
      boundaryLabel: "新范围已纳入",
      breakBefore: true,
      relativeBaseline: { medianMs: 1000 },
      transition: false,
    });
  });

  it("retains each completed expansion that belongs to the current range", () => {
    const fullGroups: PracticeGroupId[] = ["G2-F3", ...EXPANDED_GROUPS];
    const fullNotes = getNotesForGroups(fullGroups, false, "grand");
    const fullIds = fullNotes.map((note) => note.id);
    const fullAddedIds = fullIds.filter((noteId) => !expandedIds.includes(noteId));
    const rangeSessions = [
      makeSession("one", "2026-07-01T10:00:00.000+08:00", ORIGINAL_GROUPS),
      makeSession("two-start", "2026-07-02T10:00:00.000+08:00", EXPANDED_GROUPS),
      makeSession("two-ready", "2026-07-03T10:00:00.000+08:00", EXPANDED_GROUPS),
      makeSession("three-start", "2026-07-04T10:00:00.000+08:00", fullGroups),
    ];
    const rangeTrend = [
      makePoint("one", "2026-07-01T10:05:00.000+08:00", originalIds, 1000),
      makePoint("two-start", "2026-07-02T10:05:00.000+08:00", [...originalIds, addedIds[0]], 1200),
      makePoint("two-ready", "2026-07-03T10:05:00.000+08:00", expandedIds, 1300),
      makePoint("three-start", "2026-07-04T10:05:00.000+08:00", [...expandedIds, fullAddedIds[0]], 1400),
    ];

    const transitions = findRecognitionRangeTransitions(rangeSessions, fullNotes, rangeTrend);

    expect(transitions).toHaveLength(3);
    expect(transitions.map((transition) => [transition.fromNoteCount, transition.toNoteCount])).toEqual([
      [0, originalIds.length],
      [originalIds.length, expandedIds.length],
      [expandedIds.length, fullIds.length],
    ]);
    expect(transitions[0].completedAt).toBe(rangeTrend[0].boundaryAt);
    expect(transitions[1].completedAt).toBe(rangeTrend[2].boundaryAt);
    expect(transitions[2].completedAt).toBeUndefined();

    const result = applyRecognitionRangeTransitions(
      rangeTrend,
      [
        {
          transition: transitions[1],
          trend: rangeTrend.map((point, index) => ({ ...point, medianMs: 900 + index * 10 })),
        },
        {
          transition: transitions[2],
          trend: rangeTrend.map((point, index) => ({ ...point, medianMs: 1100 + index * 10 })),
        },
      ],
      "practice-session",
    );

    expect(result.map((point) => point.transition)).toEqual([false, true, false, true]);
    expect(result.map((point) => point.boundaryLabel)).toEqual([
      undefined,
      `开始扩展 ${originalIds.length}→${expandedIds.length}`,
      "新范围已纳入",
      `开始扩展 ${expandedIds.length}→${fullIds.length}`,
    ]);
    expect(result.map((point) => point.medianMs)).toEqual([1000, 910, 1300, 1130]);
    expect(result.map((point) => point.relativeBaseline?.medianMs)).toEqual([undefined, undefined, 1000, undefined]);
  });
});
