import { describe, expect, it } from "vitest";
import type { SessionProgressGroup } from "./sessionProgress";
import {
  createSessionProgressSelection,
  getSelectedSessionProgressGroups,
  getSessionProgressComparisonDimension,
  resolveSessionProgressSelection,
} from "./sessionProgressSelection";
import type { EffectiveQueueAlgorithm, PracticeSessionRecordV1, PromptDisplayMode } from "./types";

function group(
  id: string,
  promptDisplayMode: PromptDisplayMode,
  effectiveQueueAlgorithm: EffectiveQueueAlgorithm,
  startedAt: string,
): SessionProgressGroup {
  const latestSession: PracticeSessionRecordV1 = {
    completedCount: 5,
    enabledGroupIds: ["G3-F4"],
    id,
    interruptedCount: 0,
    mode: "fixed-count",
    schemaVersion: 1,
    startedAt,
  };
  const key = {
    effectiveQueueAlgorithm,
    promptDisplayMode,
    promptNoteDuration: "quarter" as const,
    targetNoteSetKey: "target-set",
  };
  return {
    key,
    keyString: [key.targetNoteSetKey, promptDisplayMode, effectiveQueueAlgorithm, key.promptNoteDuration].join("\u001f"),
    latestSession,
    sessionCount: 1,
    sessionIds: [latestSession.id],
  };
}

describe("session progress selection", () => {
  it("reconciles other dimensions to the nearest valid single group", () => {
    const single = group("single", "single-note", "adaptive-v1", "2026-07-01T10:00:00.000Z");
    const staff = group("staff", "staff-page", "melody-v2", "2026-07-02T10:00:00.000Z");
    const result = resolveSessionProgressSelection({
      current: createSessionProgressSelection(single),
      dimension: "promptDisplayMode",
      groups: [single, staff],
      preferredValue: "staff-page",
      values: ["staff-page"],
    });

    expect(result.rejected).toBe(false);
    expect(result.selection.promptDisplayModes).toEqual(["staff-page"]);
    expect(result.selection.effectiveQueueAlgorithms).toEqual(["melody-v2"]);
    expect(result.selection.chartBenchmarkGroupKey).toBe(staff.keyString);
  });

  it("builds a valid one-dimensional slice and preserves the benchmark group", () => {
    const single = group("single", "single-note", "adaptive-v1", "2026-07-02T10:00:00.000Z");
    const staff = group("staff", "staff-page", "adaptive-v1", "2026-07-01T10:00:00.000Z");
    const result = resolveSessionProgressSelection({
      current: createSessionProgressSelection(single),
      dimension: "promptDisplayMode",
      groups: [single, staff],
      preferredValue: "staff-page",
      values: ["single-note", "staff-page"],
    });

    expect(result.rejected).toBe(false);
    expect(getSessionProgressComparisonDimension(result.selection)).toBe("promptDisplayMode");
    expect(getSelectedSessionProgressGroups([single, staff], result.selection)).toHaveLength(2);
    expect(result.selection.chartBenchmarkGroupKey).toBe(single.keyString);
  });

  it("rejects a multi-selection without a common fixed-condition slice", () => {
    const single = group("single", "single-note", "adaptive-v1", "2026-07-02T10:00:00.000Z");
    const staff = group("staff", "staff-page", "melody-v2", "2026-07-01T10:00:00.000Z");
    const current = createSessionProgressSelection(single);
    const result = resolveSessionProgressSelection({
      current,
      dimension: "promptDisplayMode",
      groups: [single, staff],
      preferredValue: "staff-page",
      values: ["single-note", "staff-page"],
    });

    expect(result.rejected).toBe(true);
    expect(result.selection).toBe(current);
  });

  it("moves the comparison axis and collapses the old axis to the benchmark value", () => {
    const singleAdaptive = group("single-adaptive", "single-note", "adaptive-v1", "2026-07-03T10:00:00.000Z");
    const staffAdaptive = group("staff-adaptive", "staff-page", "adaptive-v1", "2026-07-02T10:00:00.000Z");
    const singleFocused = group("single-focused", "single-note", "focused-v1", "2026-07-01T10:00:00.000Z");
    const displaySlice = resolveSessionProgressSelection({
      current: createSessionProgressSelection(singleAdaptive),
      dimension: "promptDisplayMode",
      groups: [singleAdaptive, staffAdaptive, singleFocused],
      preferredValue: "staff-page",
      values: ["single-note", "staff-page"],
    }).selection;
    const result = resolveSessionProgressSelection({
      current: displaySlice,
      dimension: "effectiveQueueAlgorithm",
      groups: [singleAdaptive, staffAdaptive, singleFocused],
      preferredValue: "focused-v1",
      values: ["adaptive-v1", "focused-v1"],
    });

    expect(result.rejected).toBe(false);
    expect(result.selection.promptDisplayModes).toEqual(["single-note"]);
    expect(result.selection.effectiveQueueAlgorithms).toEqual(["adaptive-v1", "focused-v1"]);
  });
});
