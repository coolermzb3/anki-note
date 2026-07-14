import { describe, expect, it } from "vitest";
import { makeRecognitionTimeChartOption } from "./StatsView";

describe("recognition trend chart", () => {
  it("breaks the line without inserting an extra x-axis point", () => {
    const data = [1, 2, 3, 4].map((value, index) => ({
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

    const option = makeRecognitionTimeChartOption(data);
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
  });
});
