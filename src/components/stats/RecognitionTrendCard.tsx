import * as echarts from "echarts";
import type { EChartsOption, LineSeriesOption } from "echarts";
import { useEffect, useRef } from "react";

import {
  RECOGNITION_SERIES_KEYS,
  type RecognitionSeriesKey,
  type RecognitionTimeChartStat,
  type RecognitionTimeGrouping,
  type RecognitionTimeMetric,
  type RecognitionTimeValueMode,
} from "./recognitionTrend";
import { STATS_COLORS } from "./statsColors";

const RECOGNITION_CHART_COLORS = STATS_COLORS.recognitionChart;
const RECOGNITION_ERROR_RATE_OPACITY = 0.5;
const RECOGNITION_SERIES_OPTIONS: Array<{
  color: string;
  key: RecognitionSeriesKey;
  label: string;
  opacity?: number;
  width?: number;
  yAxisIndex?: number;
}> = [
  { color: RECOGNITION_CHART_COLORS.p10, key: "p10", label: "P10" },
  { color: RECOGNITION_CHART_COLORS.median, key: "median", label: "中位", width: 2.5 },
  { color: RECOGNITION_CHART_COLORS.p90, key: "p90", label: "P90" },
  {
    color: RECOGNITION_CHART_COLORS.errorRate,
    key: "errorRate",
    label: "错音率",
    opacity: RECOGNITION_ERROR_RATE_OPACITY,
    yAxisIndex: 1,
  },
];
const DEFAULT_RECOGNITION_VISIBLE_SERIES = RECOGNITION_SERIES_KEYS;
const RECOGNITION_CHART_HANDLE_ICON =
  "path://M11,5 H17 A4,4 0 0 1 21,9 V23 A4,4 0 0 1 17,27 H11 A4,4 0 0 1 7,23 V9 A4,4 0 0 1 11,5 Z M14,-3 V5 M14,27 V35";

function makeRecognitionLineSeries({
  color,
  data,
  markLine,
  metric,
  name,
  opacity = 1,
  width = 2,
  yAxisIndex = 0,
}: {
  color: string;
  data: RecognitionTimeChartStat[];
  markLine?: LineSeriesOption["markLine"];
  metric: RecognitionSeriesKey;
  name: string;
  opacity?: number;
  width?: number;
  yAxisIndex?: number;
}): LineSeriesOption[] {
  const segments: Array<Array<number | null>> = [Array(data.length).fill(null)];
  for (const [index, stat] of data.entries()) {
    if (index > 0 && stat.breakBefore) {
      segments.push(Array(data.length).fill(null));
    }
    segments[segments.length - 1][index] = stat[metric] ?? null;
  }

  return segments
    .filter((segment) => segment.some((value) => value !== null))
    .map((segment, index) => ({
      connectNulls: false,
      data: segment,
      itemStyle: { color, opacity },
      lineStyle: { color, opacity, width },
      markLine: index === 0 ? markLine : undefined,
      name,
      showSymbol: segment.filter((value) => value !== null).length === 1,
      smooth: true,
      symbolSize: 7,
      type: "line",
      yAxisIndex,
    }));
}

function relativeChange(value: number | undefined, baseline: number | undefined): number | undefined {
  return value === undefined || baseline === undefined || baseline === 0
    ? undefined
    : ((value - baseline) / baseline) * 100;
}

function errorRateAxisPadding(min: number, max: number): number {
  return Math.max((max - min) * 0.1, 2);
}

function errorRateAxisMin({ min, max }: { min: number; max: number }): number {
  return Number.isFinite(min) && Number.isFinite(max)
    ? Math.max(0, Math.floor(min - errorRateAxisPadding(min, max)))
    : 0;
}

function errorRateAxisMax({ min, max }: { min: number; max: number }): number {
  return Number.isFinite(min) && Number.isFinite(max)
    ? Math.min(100, Math.ceil(max + errorRateAxisPadding(min, max)))
    : 100;
}

function reciprocal(value: number | undefined): number | undefined {
  return value === undefined || value === 0 ? undefined : 1 / value;
}

function makeRecognitionSpeedData(data: RecognitionTimeChartStat[]): RecognitionTimeChartStat[] {
  return data.map((stat) => ({
    ...stat,
    median: reciprocal(stat.median),
    p10: reciprocal(stat.p10),
    p90: reciprocal(stat.p90),
  }));
}

function makeRelativeRecognitionTimeData(data: RecognitionTimeChartStat[]): RecognitionTimeChartStat[] {
  let baseline: RecognitionTimeChartStat | undefined;
  return data.map((stat) => {
    if (!baseline || stat.breakBefore) {
      baseline = stat;
    }
    return {
      ...stat,
      median: relativeChange(stat.median, baseline.median),
      p10: relativeChange(stat.p10, baseline.p10),
      p90: relativeChange(stat.p90, baseline.p90),
    };
  });
}

export function makeRecognitionTimeChartOption(
  data: RecognitionTimeChartStat[],
  metric: RecognitionTimeMetric = "duration",
  valueMode: RecognitionTimeValueMode = "absolute",
  visibleSeries: readonly RecognitionSeriesKey[] = DEFAULT_RECOGNITION_VISIBLE_SERIES,
): EChartsOption {
  const metricData = metric === "speed" ? makeRecognitionSpeedData(data) : data;
  const displayedData = valueMode === "relative" ? makeRelativeRecognitionTimeData(metricData) : metricData;
  const visibleSeriesSet = new Set(visibleSeries);
  const markLineSeriesKey = (["median", "p10", "p90", "errorRate"] as const)
    .find((seriesKey) => visibleSeriesSet.has(seriesKey));
  const inclusionMarkers = data.flatMap((stat, dataIndex) => stat.addedNoteLabels.length > 0
    ? [{ dataIndex, label: `新纳入 ${stat.addedNoteLabels.length} 个音` }]
    : []);
  const inclusionMarkLine: LineSeriesOption["markLine"] = inclusionMarkers.length > 0
    ? {
        data: inclusionMarkers.map((marker) => ({
          label: { formatter: marker.label },
          xAxis: marker.dataIndex,
        })),
        label: {
          align: "center",
          backgroundColor: RECOGNITION_CHART_COLORS.panel,
          borderRadius: 4,
          color: RECOGNITION_CHART_COLORS.muted,
          distance: 6,
          fontSize: 12,
          padding: [2, 4],
          position: "end",
        },
        lineStyle: {
          color: RECOGNITION_CHART_COLORS.muted,
          opacity: 0.7,
          type: "dashed",
          width: 1,
        },
        silent: true,
        symbol: "none",
      }
    : undefined;
  const dataZoomSliderStyle = {
    backgroundColor: RECOGNITION_CHART_COLORS.sliderBackground,
    borderColor: RECOGNITION_CHART_COLORS.sliderBorder,
    brushSelect: false,
    dataBackground: {
      areaStyle: { color: RECOGNITION_CHART_COLORS.rangePreview },
      lineStyle: { color: RECOGNITION_CHART_COLORS.rangePreviewLine },
    },
    fillerColor: RECOGNITION_CHART_COLORS.rangeFill,
    handleIcon: RECOGNITION_CHART_HANDLE_ICON,
    handleSize: 32,
    handleStyle: {
      borderColor: RECOGNITION_CHART_COLORS.p10,
      borderWidth: 1.5,
      color: RECOGNITION_CHART_COLORS.panel,
    },
    moveHandleSize: 18,
    moveHandleStyle: {
      color: RECOGNITION_CHART_COLORS.rangeMoveHandle,
    },
    selectedDataBackground: {
      areaStyle: { color: RECOGNITION_CHART_COLORS.selectedRangePreview },
      lineStyle: { color: RECOGNITION_CHART_COLORS.p10 },
    },
    showDetail: false,
    textStyle: { color: RECOGNITION_CHART_COLORS.muted },
  };
  const chartGrid = {
    bottom: 82,
    left: 50,
    right: 72,
    top: 46,
  };

  return {
    animation: false,
    color: [
      RECOGNITION_CHART_COLORS.p10,
      RECOGNITION_CHART_COLORS.median,
      RECOGNITION_CHART_COLORS.p90,
      RECOGNITION_CHART_COLORS.errorRate,
    ],
    dataZoom: [
      { end: 100, filterMode: "filter", start: 0, type: "inside", xAxisIndex: 0 },
      {
        ...dataZoomSliderStyle,
        bottom: 16,
        end: 100,
        filterMode: "filter",
        height: 34,
        left: chartGrid.left - 2,
        right: chartGrid.right,
        start: 0,
        type: "slider",
        xAxisIndex: 0,
      },
      { filterMode: "none", type: "inside", yAxisIndex: [0, 1] },
      {
        ...dataZoomSliderStyle,
        bottom: chartGrid.bottom,
        filterMode: "none",
        right: 0,
        top: chartGrid.top - 3,
        type: "slider",
        width: 34,
        yAxisIndex: [0, 1],
      },
    ],
    grid: chartGrid,
    legend: { show: false },
    series: RECOGNITION_SERIES_OPTIONS.flatMap((option) => visibleSeriesSet.has(option.key)
      ? makeRecognitionLineSeries({
          color: option.color,
          data: displayedData,
          markLine: markLineSeriesKey === option.key ? inclusionMarkLine : undefined,
          metric: option.key,
          name: option.label,
          opacity: option.opacity,
          width: option.width,
          yAxisIndex: option.yAxisIndex,
        })
      : []),
    tooltip: {
      axisPointer: { animation: false, type: "line" },
      enterable: false,
      extraCssText: "pointer-events: none;",
      formatter: (params) => {
        const items = Array.isArray(params) ? params : [params];
        const firstItem = items[0] as { dataIndex?: number } | undefined;
        const dataIndex = firstItem?.dataIndex;
        const stat = dataIndex === undefined ? undefined : data[dataIndex];
        const metricStat = dataIndex === undefined ? undefined : metricData[dataIndex];
        const title = stat?.tooltipLabel ?? "";
        const coverage = stat?.tooltipLabel
          ? `<div style="color:${RECOGNITION_CHART_COLORS.muted}">已纳入 ${stat.coveredNoteCount}/${stat.totalNoteCount} 个音</div>`
          : "";
        const inclusion = stat?.addedNoteLabels.length
          ? `<div style="color:${RECOGNITION_CHART_COLORS.muted}">新纳入：${stat.addedNoteLabels.join("、")}</div>`
          : "";
        const rows = items
          .map((item) => {
            const point = item as { marker?: string; seriesName?: string; value?: number | string | null };
            if (point.value === null || point.value === undefined || point.value === "") {
              return "";
            }
            const value = Number(point.value);
            const isErrorRate = point.seriesName === "错音率";
            let formattedValue: number | string | null | undefined = point.value;
            if (Number.isFinite(value)) {
              if (isErrorRate) {
                formattedValue = `${value.toFixed(1)}%`;
              } else {
                const metricValue = point.seriesName === "P10"
                  ? metricStat?.p10
                  : point.seriesName === "中位"
                    ? metricStat?.median
                    : metricStat?.p90;
                const absoluteValue = metricValue === undefined
                  ? ""
                  : metric === "speed"
                    ? `${metricValue.toFixed(2)} 音/秒`
                    : `${metricValue.toFixed(2)}s`;
                formattedValue = valueMode === "relative"
                  ? `${value > 0 ? "+" : ""}${value.toFixed(1)}%${absoluteValue ? ` (${absoluteValue})` : ""}`
                  : absoluteValue;
              }
            }
            return `<div>${point.marker ?? ""}${point.seriesName ?? ""}: ${formattedValue}</div>`;
          })
          .filter(Boolean)
          .join("");
        return title ? `<div><strong>${title}</strong>${coverage}${inclusion}${rows}</div>` : "";
      },
      transitionDuration: 0,
      trigger: "axis",
    },
    xAxis: {
      axisLabel: {
        color: RECOGNITION_CHART_COLORS.muted,
        fontSize: 11,
        hideOverlap: true,
      },
      boundaryGap: false,
      data: data.map((stat) => stat.label),
      splitLine: { lineStyle: { color: RECOGNITION_CHART_COLORS.grid, type: "dashed" }, show: true },
      type: "category",
    },
    yAxis: [
      {
        axisLabel: {
          color: RECOGNITION_CHART_COLORS.muted,
          fontSize: 11,
          formatter: valueMode === "relative" ? "{value}%" : metric === "speed" ? "{value}" : "{value}s",
        },
        name: valueMode === "absolute" && metric === "speed" ? "音/秒" : undefined,
        nameTextStyle: { color: RECOGNITION_CHART_COLORS.muted, fontSize: 11 },
        scale: true,
        splitLine: { lineStyle: { color: RECOGNITION_CHART_COLORS.grid, type: "dashed" } },
        type: "value",
      },
      {
        axisLabel: {
          color: RECOGNITION_CHART_COLORS.muted,
          fontSize: 11,
          formatter: "{value}%",
        },
        max: errorRateAxisMax,
        min: errorRateAxisMin,
        scale: true,
        show: visibleSeriesSet.has("errorRate"),
        splitLine: { show: false },
        type: "value",
      },
    ],
  };
}

function RecognitionTrendChart({
  data,
  metric,
  onSelectAllSeries,
  onSelectOnlySeries,
  onToggleSeries,
  valueMode,
  visibleSeries,
}: {
  data: RecognitionTimeChartStat[];
  metric: RecognitionTimeMetric;
  onSelectAllSeries: () => void;
  onSelectOnlySeries: (seriesKey: RecognitionSeriesKey) => void;
  onToggleSeries: (seriesKey: RecognitionSeriesKey) => void;
  valueMode: RecognitionTimeValueMode;
  visibleSeries: readonly RecognitionSeriesKey[];
}): JSX.Element {
  const chartElementRef = useRef<HTMLDivElement | null>(null);
  const chartRef = useRef<echarts.EChartsType | null>(null);

  useEffect(() => {
    const element = chartElementRef.current;
    if (!element) {
      return undefined;
    }

    const chart = echarts.init(element, null, { renderer: "canvas" });
    chartRef.current = chart;
    let resizeFrame = 0;
    const scheduleResize = (): void => {
      window.cancelAnimationFrame(resizeFrame);
      resizeFrame = window.requestAnimationFrame(() => chart.resize());
    };
    const resizeObserver = new ResizeObserver(scheduleResize);
    const resizeTarget = element.parentElement ?? element;
    resizeObserver.observe(resizeTarget);
    if (resizeTarget !== element) {
      resizeObserver.observe(element);
    }
    scheduleResize();

    return () => {
      window.cancelAnimationFrame(resizeFrame);
      resizeObserver.disconnect();
      chart.dispose();
      chartRef.current = null;
    };
  }, []);

  useEffect(() => {
    chartRef.current?.setOption(makeRecognitionTimeChartOption(data, metric, valueMode, visibleSeries), true);
  }, [data, metric, valueMode, visibleSeries]);

  return (
    <div className="recognition-time-chart-shell">
      <div aria-label="识别趋势图例" className="recognition-trend-legend" role="group">
        {RECOGNITION_SERIES_OPTIONS.map((option) => {
          const selected = visibleSeries.includes(option.key);
          return (
            <div className="recognition-trend-legend-option" key={option.key}>
              <label aria-label={`${selected ? "隐藏" : "显示"}${option.label}`}>
                <input
                  checked={selected}
                  onChange={() => onToggleSeries(option.key)}
                  type="checkbox"
                />
              </label>
              <button
                aria-label={`仅显示${option.label}`}
                aria-pressed={visibleSeries.length === 1 && selected}
                className="recognition-trend-legend-single"
                onClick={() => onSelectOnlySeries(option.key)}
                type="button"
              >
                <i
                  aria-hidden="true"
                  style={{ backgroundColor: option.color, opacity: option.opacity ?? 1 }}
                />
                {option.label}
              </button>
            </div>
          );
        })}
        <button
          className="recognition-trend-legend-all"
          disabled={visibleSeries.length === RECOGNITION_SERIES_OPTIONS.length}
          onClick={onSelectAllSeries}
          type="button"
        >
          全选
        </button>
      </div>
      <div aria-label="识别趋势折线图" className="recognition-time-chart" ref={chartElementRef} role="img" />
    </div>
  );
}

export function RecognitionTrendCard({
  coverage,
  data,
  grouping,
  metric,
  onGroupingChange,
  onMetricChange,
  onSelectAllSeries,
  onSelectOnlySeries,
  onToggleSeries,
  onValueModeChange,
  valueMode,
  visibleSeries,
}: {
  coverage: { coveredNoteCount: number; totalNoteCount: number };
  data: RecognitionTimeChartStat[];
  grouping: RecognitionTimeGrouping;
  metric: RecognitionTimeMetric;
  onGroupingChange: (grouping: RecognitionTimeGrouping) => void;
  onMetricChange: (metric: RecognitionTimeMetric) => void;
  onSelectAllSeries: () => void;
  onSelectOnlySeries: (seriesKey: RecognitionSeriesKey) => void;
  onToggleSeries: (seriesKey: RecognitionSeriesKey) => void;
  onValueModeChange: (valueMode: RecognitionTimeValueMode) => void;
  valueMode: RecognitionTimeValueMode;
  visibleSeries: readonly RecognitionSeriesKey[];
}): JSX.Element {
  return (
    <div className="panel chart-panel stats-carousel-card">
      <div className="panel-heading">
        <h2>识别趋势</h2>
        <div className="chart-panel-actions recognition-trend-actions">
          <div className="segmented" aria-label="识别趋势指标">
            <button className={metric === "speed" ? "active" : ""} onClick={() => onMetricChange("speed")}>
              速度
            </button>
            <button className={metric === "duration" ? "active" : ""} onClick={() => onMetricChange("duration")}>
              耗时
            </button>
          </div>
          <div className="segmented" aria-label="识别趋势数值模式">
            <button className={valueMode === "absolute" ? "active" : ""} onClick={() => onValueModeChange("absolute")}>
              绝对
            </button>
            <button className={valueMode === "relative" ? "active" : ""} onClick={() => onValueModeChange("relative")}>
              相对
            </button>
          </div>
          <div className="segmented" aria-label="识别趋势分组">
            <button className={grouping === "day" ? "active" : ""} onClick={() => onGroupingChange("day")}>
              按天
            </button>
            <button
              className={grouping === "practice-session" ? "active" : ""}
              onClick={() => onGroupingChange("practice-session")}
            >
              按会话
            </button>
          </div>
        </div>
      </div>
      <div className="chart-box">
        {coverage.coveredNoteCount === 0 ? (
          <div className="empty-state">
            数据正在积累：0/{coverage.totalNoteCount} 个音已完成至少 20 次有效练习。再练习几次，回来看看整体进步吧。
          </div>
        ) : data.length === 0 ? (
          <div className="empty-state">所选时间范围内暂无趋势点</div>
        ) : (
          <>
            <RecognitionTrendChart
              data={data}
              metric={metric}
              onSelectAllSeries={onSelectAllSeries}
              onSelectOnlySeries={onSelectOnlySeries}
              onToggleSeries={onToggleSeries}
              valueMode={valueMode}
              visibleSeries={visibleSeries}
            />
            <small className="note-range-filter-note">
              {valueMode === "relative"
                ? `每段首点为 0%，${metric === "speed" ? "正值" : "负值"}表示更快；`
                : ""}
              已纳入 {coverage.coveredNoteCount}/{coverage.totalNoteCount} 个音
              {coverage.coveredNoteCount < coverage.totalNoteCount ? "，其余数据积累中" : ""}
            </small>
          </>
        )}
      </div>
    </div>
  );
}
