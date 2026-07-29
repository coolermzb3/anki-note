import { describe, expect, it } from "vitest";
import { makeRecognitionTimeChartOption } from "./RecognitionTrendCard";
import type { RecognitionTimeChartStat } from "./recognitionTrend";

function makeChartData(): RecognitionTimeChartStat[] {
  return [1, 2, 3, 4].map((value, index) => ({
    boundaryLabel: index === 2 ? "新范围已纳入" : undefined,
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
    transition: false,
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
    expect(dataZoom.slice(0, 2).map((zoom) => zoom.filterMode)).toEqual(["filter", "filter"]);
  });

  it("uses a complete series for the native data zoom preview across range breaks", () => {
    const option = makeRecognitionTimeChartOption(makeChartData(), "duration", "absolute", ["median", "p90"]);
    const previewSeries = (option.series as Array<{
      data: Array<number | null>;
      id?: string;
      lineStyle?: { opacity?: number };
      silent?: boolean;
      tooltip?: { show?: boolean };
    }>)[0];

    expect(previewSeries).toMatchObject({
      data: [1, 2, 3, 4],
      id: "recognition-data-zoom-preview",
      lineStyle: { opacity: 0 },
      silent: true,
      tooltip: { show: false },
    });
  });

  it("keeps the relative baseline across a visual range break", () => {
    const option = makeRecognitionTimeChartOption(makeChartData(), "duration", "relative");
    const medianSeries = (option.series as Array<{ data: Array<number | null>; name: string }>)
      .filter((series) => series.name === "中位");
    const yAxis = option.yAxis as Array<{ axisLabel: { formatter: string } }>;

    expect(medianSeries[0].data).toEqual([0, 100, null, null]);
    expect(medianSeries[1].data).toEqual([null, null, 200, 300]);
    expect(yAxis[0].axisLabel.formatter).toBe("{value}%");
  });

  it("uses the supplied old-cohort endpoint as the next formal baseline", () => {
    const data = makeChartData();
    const relativeBaseline = { median: 2, p10: 2, p90: 2 };
    data[2] = { ...data[2], relativeBaseline };
    const option = makeRecognitionTimeChartOption(data, "duration", "relative");
    const medianSeries = (option.series as Array<{ data: Array<number | null>; name: string }>)
      .filter((series) => series.name === "中位");

    expect(medianSeries[0].data).toEqual([0, 100, null, null]);
    expect(medianSeries[1].data).toEqual([null, null, 50, 100]);
  });

  it("can reset the next formal range at its own first point", () => {
    const data = makeChartData();
    data[2] = { ...data[2], relativeBaseline: { median: 2, p10: 2, p90: 2 } };
    const option = makeRecognitionTimeChartOption(data, "duration", "relative", ["median"], true);
    const medianSeries = (option.series as Array<{ data: Array<number | null>; name: string }>)
      .filter((series) => series.name === "中位");

    expect(medianSeries[0].data).toEqual([0, 100, null, null]);
    expect(medianSeries[1].data.slice(0, 3)).toEqual([null, null, 0]);
    expect(medianSeries[1].data[3]).toBeCloseTo(100 / 3);
  });

  it("rebases at the visible window start when the expansion boundary is outside it", () => {
    const data = makeChartData();
    data[2] = { ...data[2], relativeBaseline: { median: 2, p10: 2, p90: 2 } };
    const option = makeRecognitionTimeChartOption(data.slice(3), "duration", "relative");
    const medianSeries = (option.series as Array<{ data: Array<number | null>; name: string }>)
      .find((series) => series.name === "中位");

    expect(medianSeries?.data).toEqual([0]);
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

  it("uses one faded segment between range-start and range-ready boundaries", () => {
    const data: RecognitionTimeChartStat[] = makeChartData()
      .map((point) => ({ ...point, boundaryLabel: undefined }));
    data[1] = { ...data[1], boundaryLabel: "开始扩展 1→2", breakBefore: true, transition: true };
    data[2] = { ...data[2], breakBefore: false, transition: true };
    data[3] = { ...data[3], boundaryLabel: "新范围已纳入", breakBefore: true, transition: false };
    const option = makeRecognitionTimeChartOption(data);
    const medianSeries = (option.series as Array<{
      data: Array<number | null>;
      lineStyle?: { opacity?: number; type?: string };
      markLine?: { data: Array<{ label: { formatter: string }; xAxis: number }> };
      name: string;
    }>).filter((series) => series.name === "中位");

    expect(medianSeries.map((series) => series.data)).toEqual([
      [1, null, null, null],
      [null, 2, 3, null],
      [null, null, null, 4],
    ]);
    expect(medianSeries.map((series) => series.lineStyle?.type)).toEqual([undefined, undefined, undefined]);
    expect(medianSeries.map((series) => series.lineStyle?.opacity)).toEqual([1, 0.45, 1]);
    expect(medianSeries[0].markLine?.data).toEqual([
      { label: { formatter: "开始扩展 1→2" }, xAxis: 1 },
      { label: { formatter: "新范围已纳入" }, xAxis: 3 },
    ]);
  });

  it("starts a relative segment at its first point with metrics", () => {
    const data = makeChartData().map((point) => ({
      ...point,
      boundaryLabel: undefined,
      breakBefore: false,
    }));
    data[0] = { ...data[0], median: undefined, p10: undefined, p90: undefined };
    const option = makeRecognitionTimeChartOption(data, "duration", "relative");
    const medianSeries = (option.series as Array<{ data: Array<number | null>; name: string }>)
      .find((series) => series.name === "中位");

    expect(medianSeries?.data).toEqual([null, 0, 50, 100]);
  });

  it("calculates relative changes from the selected speed metric", () => {
    const data = makeChartData().slice(0, 2);
    data[0] = { ...data[0], median: 2, relativeBaseline: { median: 2 } };
    data[1] = { ...data[1], median: 1, relativeBaseline: { median: 2 } };
    const option = makeRecognitionTimeChartOption(data, "speed", "relative");
    const medianSeries = (option.series as Array<{ data: Array<number | null>; name: string }>)
      .find((series) => series.name === "中位");

    expect(medianSeries?.data).toEqual([0, 100]);
  });

  it("renders only selected custom-legend series and keeps range markers visible", () => {
    const option = makeRecognitionTimeChartOption(makeChartData(), "duration", "absolute", ["p10", "errorRate"]);
    const withoutErrorRate = makeRecognitionTimeChartOption(makeChartData(), "duration", "absolute", ["p10"]);
    const series = (option.series as Array<{ id?: string; markLine?: unknown; name: string }>)
      .filter((item) => item.id !== "recognition-data-zoom-preview");
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
