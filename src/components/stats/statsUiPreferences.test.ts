import { describe, expect, it } from "vitest";
import {
  DEFAULT_STATS_UI_PREFERENCES,
  parseHiddenRecognitionSeries,
  parseStatsUiPreferences,
} from "./statsUiPreferences";

describe("recognition trend preferences", () => {
  it("defaults old preferences without legend state to showing every series", () => {
    expect(parseHiddenRecognitionSeries(undefined)).toEqual([]);
  });

  it("keeps only known hidden series in canonical order", () => {
    expect(parseHiddenRecognitionSeries(["errorRate", "unknown", "p10", "errorRate"])).toEqual([
      "p10",
      "errorRate",
    ]);
  });

  it("recovers corrupted preferences that hide every series", () => {
    expect(parseHiddenRecognitionSeries(["p10", "median", "p90", "errorRate"])).toEqual([]);
  });

  it("persists the new-range first-point reset with an off default for old preferences", () => {
    expect(parseStatsUiPreferences({}, DEFAULT_STATS_UI_PREFERENCES).recognitionTimeResetNewRangeAtFirstPoint)
      .toBe(false);
    expect(parseStatsUiPreferences(
      { recognitionTimeResetNewRangeAtFirstPoint: true },
      DEFAULT_STATS_UI_PREFERENCES,
    ).recognitionTimeResetNewRangeAtFirstPoint).toBe(true);
  });
});
