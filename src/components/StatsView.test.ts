import { describe, expect, it } from "vitest";
import { makeRecognitionTimeChartOption, parseHiddenRecognitionSeries } from "./StatsView";

function makeChartData() {
  return [1, 2, 3, 4].map((value, index) => ({
    addedNoteLabels: index === 2 ? ["E4"] : [],
    breakBefore: index === 2,
    coveredNoteCount: index < 2 ? 1 : 2,
    errorRate: value,
    key: String(value),
    label: String(value),
    median: value,
    p10: value,
    p90: value,
    tooltipLabel: String(value),
    totalNoteCount: 2,
  }));
}

describe("recognition trend chart", () => {
  it("breaks the line without inserting an extra x-axis point", () => {
    const option = makeRecognitionTimeChartOption(makeChartData());
    const dataZoom = option.dataZoom as Array<{
      bottom?: number;
      filterMode?: string;
      left?: number;
      right?: number;
      top?: number;
    }>;
    const grid = option.grid as { bottom: number; left: number; right: number; top: number };
    const xAxis = option.xAxis as { data: string[] };
    const medianSeries = (option.series as Array<{
      data: Array<number | null>;
      markLine?: { data: Array<{ xAxis: number }>; label: { align: string; position: string } };
      name: string;
    }>).filter((series) => series.name === "中位");

    expect(xAxis.data).toEqual(["1", "2", "3", "4"]);
    expect(medianSeries.map((series) => series.data)).toEqual([
      [1, 2, null, null],
      [null, null, 3, 4],
    ]);
    expect(medianSeries[0].markLine).toMatchObject({
      data: [{ xAxis: 2 }],
      label: { align: "center", position: "end" },
    });
    expect(dataZoom[1]).toMatchObject({ left: grid.left - 2, right: grid.right });
    expect(dataZoom[3]).toMatchObject({ bottom: grid.bottom, top: grid.top - 3 });
    expect(dataZoom.slice(0, 2).map((zoom) => zoom.filterMode)).toEqual(["empty", "empty"]);
  });

  it("rebases relative changes at each inclusion boundary", () => {
    const option = makeRecognitionTimeChartOption(makeChartData(), "duration", "relative");
    const medianSeries = (option.series as Array<{ data: Array<number | null>; name: string }>)
      .filter((series) => series.name === "中位");
    const yAxis = option.yAxis as Array<{ axisLabel: { formatter: string } }>;

    expect(medianSeries[0].data).toEqual([0, 100, null, null]);
    expect(medianSeries[1].data.slice(0, 3)).toEqual([null, null, 0]);
    expect(medianSeries[1].data[3]).toBeCloseTo(100 / 3);
    expect(yAxis[0].axisLabel.formatter).toBe("{value}%");
  });

  it("preserves coverage labels when converting duration thresholds into speed", () => {
    const data = makeChartData();
    data[0] = { ...data[0], median: 2, p10: 1, p90: 4 };
    const option = makeRecognitionTimeChartOption(data, "speed");
    const series = option.series as Array<{ data: Array<number | null>; name: string }>;
    const firstValue = (name: string): number | null => series.find((item) => item.name === name)?.data[0] ?? null;

    expect(firstValue("P10")).toBe(1);
    expect(firstValue("中位")).toBe(0.5);
    expect(firstValue("P90")).toBe(0.25);
  });

  it("calculates relative changes from the selected speed metric", () => {
    const data = makeChartData().slice(0, 2);
    data[0] = { ...data[0], median: 2 };
    data[1] = { ...data[1], median: 1 };
    const option = makeRecognitionTimeChartOption(data, "speed", "relative");
    const medianSeries = (option.series as Array<{ data: Array<number | null>; name: string }>)
      .find((series) => series.name === "中位");

    expect(medianSeries?.data).toEqual([0, 100]);
  });

  it("renders only selected custom-legend series and keeps inclusion markers visible", () => {
    const option = makeRecognitionTimeChartOption(makeChartData(), "duration", "absolute", ["p10", "errorRate"]);
    const withoutErrorRate = makeRecognitionTimeChartOption(makeChartData(), "duration", "absolute", ["p10"]);
    const series = option.series as Array<{ markLine?: unknown; name: string }>;
    const yAxis = option.yAxis as Array<{ show?: boolean }>;
    const yAxisWithoutErrorRate = withoutErrorRate.yAxis as Array<{ show?: boolean }>;

    expect(option.legend).toEqual({ show: false });
    expect([...new Set(series.map((item) => item.name))]).toEqual(["P10", "错音率"]);
    expect(series.find((item) => item.name === "P10")?.markLine).toBeDefined();
    expect(yAxis[1].show).toBe(true);
    expect(yAxisWithoutErrorRate[1].show).toBe(false);
  });

  it("uses a padded truncated axis and reduced opacity for error rate", () => {
    const option = makeRecognitionTimeChartOption(makeChartData());
    const errorRateSeries = (option.series as Array<{
      lineStyle?: { opacity?: number };
      name: string;
    }>).find((series) => series.name === "错音率");
    const errorRateAxis = (option.yAxis as Array<{
      max: (extent: { max: number; min: number }) => number;
      min: (extent: { max: number; min: number }) => number;
      scale?: boolean;
    }>)[1];

    expect(errorRateSeries?.lineStyle?.opacity).toBe(0.5);
    expect(errorRateAxis.scale).toBe(true);
    expect(errorRateAxis.min({ min: 30, max: 40 })).toBe(28);
    expect(errorRateAxis.max({ min: 30, max: 40 })).toBe(42);
    expect(errorRateAxis.min({ min: 1, max: 2 })).toBe(0);
    expect(errorRateAxis.max({ min: 99, max: 100 })).toBe(100);
  });
});

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
