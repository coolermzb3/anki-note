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

  it("accepts arbitrary positive day ranges and migrates legacy preset strings", () => {
    expect(parseStatsUiPreferences(
      { customRangeDays: 45, range: 45 },
      DEFAULT_STATS_UI_PREFERENCES,
    )).toMatchObject({ customRangeDays: 45, range: 45 });
    expect(parseStatsUiPreferences(
      { range: "7" },
      DEFAULT_STATS_UI_PREFERENCES,
    ).range).toBe(7);
    expect(parseStatsUiPreferences(
      { customRangeDays: 0, range: -1 },
      DEFAULT_STATS_UI_PREFERENCES,
    )).toMatchObject({ customRangeDays: 14, range: 30 });
  });

  it("persists all relative-baseline modes with the previous range end as default", () => {
    expect(parseStatsUiPreferences({}, DEFAULT_STATS_UI_PREFERENCES).recognitionTimeRelativeBaselineMode)
      .toBe("previous-range-end");
    for (const mode of ["previous-range-start", "previous-range-end", "new-range-start"]) {
      expect(parseStatsUiPreferences(
        { recognitionTimeRelativeBaselineMode: mode },
        DEFAULT_STATS_UI_PREFERENCES,
      ).recognitionTimeRelativeBaselineMode).toBe(mode);
    }
  });

  it("migrates the former new-range first-point boolean", () => {
    expect(parseStatsUiPreferences(
      { recognitionTimeResetNewRangeAtFirstPoint: false },
      DEFAULT_STATS_UI_PREFERENCES,
    ).recognitionTimeRelativeBaselineMode).toBe("previous-range-end");
    expect(parseStatsUiPreferences(
      { recognitionTimeResetNewRangeAtFirstPoint: true },
      DEFAULT_STATS_UI_PREFERENCES,
    ).recognitionTimeRelativeBaselineMode).toBe("new-range-start");
  });
});
