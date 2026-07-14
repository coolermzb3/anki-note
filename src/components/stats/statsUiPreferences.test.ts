import { describe, expect, it } from "vitest";
import { parseHiddenRecognitionSeries } from "./statsUiPreferences";

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
});
