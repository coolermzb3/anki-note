import * as echarts from "echarts";
import type { EChartsOption, LineSeriesOption } from "echarts";
import { ChevronLeft, ChevronRight } from "lucide-react";
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
  type TransitionEvent as ReactTransitionEvent,
} from "react";
import { formatTargetNoteLabel, getNotesForGroups } from "../domain/notes";
import {
  buildDailyStats,
  buildNoteStats,
  buildRecognitionTrend,
  filterLongTermReviews,
  groupRecognitionTrendByDay,
  positiveTertileThresholds,
  type DailyStat,
} from "../domain/stats";
import type {
  AppSettings,
  PracticeSessionRecord,
  ReviewRecord,
} from "../domain/types";
import { GlobalRangeControls } from "./GlobalRangeControls";
import { SessionProgressCard } from "./SessionProgressCard";
import {
  DEFAULT_SESSION_PROGRESS_UI_PREFERENCES,
  parseSessionProgressUiPreferences,
  SESSION_PROGRESS_UI_PREFERENCES_KEY,
} from "./sessionProgressPreferences";
import { StatsRangeStaff, type StaffHeatNote } from "./StatsRangeStaff";
import { STATS_COLORS } from "./statsColors";
import { useLocalStorageState } from "./useLocalStorageState";
import { useSessionProgressComparison } from "./useSessionProgressComparison";

interface StatsViewProps {
  settings: AppSettings;
  reviews: ReviewRecord[];
  sessions?: PracticeSessionRecord[];
  onSettingsSaved: (settings: AppSettings) => void | Promise<void>;
}

const RANGE_KEYS = ["1", "7", "30", "all"] as const;
type RangeKey = (typeof RANGE_KEYS)[number];
const RECOGNITION_TIME_GROUPINGS = ["day", "practice-session"] as const;
type RecognitionTimeGrouping = (typeof RECOGNITION_TIME_GROUPINGS)[number];
const RECOGNITION_TIME_METRICS = ["duration", "speed"] as const;
type RecognitionTimeMetric = (typeof RECOGNITION_TIME_METRICS)[number];
const RECOGNITION_TIME_VALUE_MODES = ["absolute", "relative"] as const;
type RecognitionTimeValueMode = (typeof RECOGNITION_TIME_VALUE_MODES)[number];
const RECOGNITION_SERIES_KEYS = ["p10", "median", "p90", "errorRate"] as const;
type RecognitionSeriesKey = (typeof RECOGNITION_SERIES_KEYS)[number];
const STATS_CAROUSEL_CARD_IDS = ["recognition-time", "session-progress", "note-range"] as const;
const STATS_CAROUSEL_CARD_LABELS = ["识别趋势", "答对进度", "音域分布"] as const;
const STATS_CAROUSEL_PAIR_LABELS = ["识别趋势和答对进度", "答对进度和音域分布", "音域分布和识别趋势"] as const;
const STATS_CAROUSEL_DRAG_THRESHOLD_PX = 48;
const STATS_CAROUSEL_REAL_OFFSET = 1;
const STATS_UI_PREFERENCES_KEY = "anki-note.statsUiPreferences";
type StatsCarouselCardId = (typeof STATS_CAROUSEL_CARD_IDS)[number];
interface StatsUiPreferences {
  carouselCardId: StatsCarouselCardId;
  hiddenRecognitionSeries: RecognitionSeriesKey[];
  range: RangeKey;
  recognitionTimeGrouping: RecognitionTimeGrouping;
  recognitionTimeMetric: RecognitionTimeMetric;
  recognitionTimeValueMode: RecognitionTimeValueMode;
}
type StatsCarouselTrackStyle = CSSProperties & {
  "--stats-carousel-single-translate": string;
  "--stats-carousel-translate": string;
};
interface RecognitionTimeChartStat {
  addedNoteLabels: string[];
  breakBefore: boolean;
  coveredNoteCount: number;
  errorRate?: number;
  key: string;
  label: string;
  tooltipLabel: string;
  totalNoteCount: number;
  p10?: number;
  median?: number;
  p90?: number;
}

const EMPTY_SESSIONS: PracticeSessionRecord[] = [];
const HEATMAP_WEEK_COUNT = 53;
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
const WEEKDAY_LABELS = ["周一", "", "周三", "", "周五", "", "周日"];
const DEFAULT_STATS_UI_PREFERENCES: StatsUiPreferences = {
  carouselCardId: STATS_CAROUSEL_CARD_IDS[1],
  hiddenRecognitionSeries: [],
  range: "30",
  recognitionTimeGrouping: "practice-session",
  recognitionTimeMetric: "duration",
  recognitionTimeValueMode: "absolute",
};

function formatShortDateTime(iso: string): { label: string; tooltipLabel: string } {
  const date = new Date(iso);
  const shortDate = `${String(date.getFullYear()).slice(2)}/${date.getMonth() + 1}/${date.getDate()}`;
  const time = `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
  return {
    label: `${shortDate}\n${time}`,
    tooltipLabel: `${shortDate} ${time}`,
  };
}

function formatShortDate(dateKey: string): string {
  const date = new Date(`${dateKey}T00:00:00`);
  return `${String(date.getFullYear()).slice(2)}/${date.getMonth() + 1}/${date.getDate()}`;
}

function formatDateKey(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function formatMonthLabel(date: Date): string {
  return `${date.getMonth() + 1}月`;
}

function startOfWeek(date: Date): Date {
  const start = new Date(date);
  start.setHours(0, 0, 0, 0);
  start.setDate(start.getDate() - ((start.getDay() + 6) % 7));
  return start;
}

function monthLabelForWeek(weekStart: Date, index: number): string {
  for (let dayOffset = 0; dayOffset < 7; dayOffset += 1) {
    const date = new Date(weekStart);
    date.setDate(weekStart.getDate() + dayOffset);
    if (date.getDate() === 1) {
      return formatMonthLabel(date);
    }
  }

  return index === 0 ? formatMonthLabel(weekStart) : "";
}

function rangeCutoff(range: RangeKey, today = new Date()): Date | undefined {
  if (range === "all") {
    return undefined;
  }
  const cutoff = new Date(today);
  cutoff.setDate(cutoff.getDate() - Number(range) + 1);
  cutoff.setHours(0, 0, 0, 0);
  return cutoff;
}

function filterByRange(reviews: ReviewRecord[], range: RangeKey): ReviewRecord[] {
  const cutoff = rangeCutoff(range);
  return cutoff ? reviews.filter((review) => new Date(review.endedAt) >= cutoff) : reviews;
}

function formatPracticeDuration(ms: number): string {
  const totalSeconds = Math.max(0, Math.round(ms / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  return [
    hours > 0 ? `${hours} 小时` : "",
    minutes > 0 ? `${minutes} 分钟` : "",
    seconds > 0 || totalSeconds === 0 ? `${seconds} 秒` : "",
  ].filter(Boolean).join(" ");
}

export function averageDailyPracticeMs(
  dailyStats: readonly DailyStat[],
  range: RangeKey,
  today = new Date(),
): number {
  const cutoff = rangeCutoff(range, today);
  const cutoffKey = cutoff ? formatDateKey(cutoff) : undefined;
  const positiveValues = dailyStats
    .filter((day) => cutoffKey === undefined || day.date >= cutoffKey)
    .map((day) => day.totalActiveMs)
    .filter((value) => value > 0);
  return positiveValues.length === 0
    ? 0
    : positiveValues.reduce((total, value) => total + value, 0) / positiveValues.length;
}

function HeatMap({ dailyStats }: { dailyStats: DailyStat[] }): JSX.Element {
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const [tooltip, setTooltip] = useState<{ label: string; left: number; top: number } | undefined>();
  const todayKey = formatDateKey(new Date());
  const { days, weekStarts } = useMemo(() => {
    const byDate = new Map(dailyStats.map((day) => [day.date, day]));
    const todayStart = new Date(`${todayKey}T00:00:00`);
    const firstWeekStart = startOfWeek(todayStart);
    firstWeekStart.setDate(firstWeekStart.getDate() - (HEATMAP_WEEK_COUNT - 1) * 7);
    const nextWeekStarts = Array.from({ length: HEATMAP_WEEK_COUNT }, (_, index) => {
      const date = new Date(firstWeekStart);
      date.setDate(firstWeekStart.getDate() + index * 7);
      return date;
    });
    const nextDays = nextWeekStarts.flatMap((weekStart) => {
      return Array.from({ length: 7 }, (_, dayOffset) => {
        const date = new Date(weekStart);
        date.setDate(weekStart.getDate() + dayOffset);
        const key = formatDateKey(date);
        return { date, key, stat: byDate.get(key) };
      }).filter((day) => day.date.getTime() <= todayStart.getTime());
    });
    return { days: nextDays, weekStarts: nextWeekStarts };
  }, [dailyStats, todayKey]);

  useEffect(() => {
    const scroll = scrollRef.current;
    if (!scroll) {
      return;
    }

    const scrollToLatest = (): void => {
      scroll.scrollLeft = scroll.scrollWidth - scroll.clientWidth;
    };
    scrollToLatest();
    const observer = new ResizeObserver(scrollToLatest);
    observer.observe(scroll);
    return () => observer.disconnect();
  }, [days.length]);

  return (
    <div className="heatmap-shell" aria-label="练习热力图">
      <div className="heatmap-weekdays" aria-hidden="true">
        {WEEKDAY_LABELS.map((label, index) => (
          <span key={`${index}-${label}`}>
            {label ? <span className="heatmap-weekday-label">{label}</span> : null}
          </span>
        ))}
      </div>
      <div className="heatmap-scroll" ref={scrollRef} onScroll={() => setTooltip(undefined)}>
        <div className="heatmap-track">
          <div className="heatmap-months" aria-hidden="true">
            {weekStarts.map((weekStart, index) => (
              <span className="heatmap-month" key={formatDateKey(weekStart)}>
                {monthLabelForWeek(weekStart, index)}
              </span>
            ))}
          </div>
          <div className="heatmap">
            {days.map((day) => {
              const heatLevel = day.stat?.heatLevel ?? 0;
              const practiceDuration = formatPracticeDuration(day.stat?.totalActiveMs ?? 0);
              return (
                <div
                  aria-label={`${day.key}: ${practiceDuration}`}
                  className="heat-cell"
                  key={day.key}
                  onPointerEnter={(event) => {
                    const tooltipWidth = 150;
                    setTooltip({
                      label: `${day.key} · ${practiceDuration}`,
                      left: Math.max(8, Math.min(event.clientX + 10, window.innerWidth - tooltipWidth - 8)),
                      top: Math.max(8, event.clientY - 36),
                    });
                  }}
                  onPointerLeave={() => setTooltip(undefined)}
                  style={{ backgroundColor: STATS_COLORS.heatmap[heatLevel] }}
                />
              );
            })}
          </div>
        </div>
      </div>
      {tooltip ? (
        <div className="heatmap-tooltip" role="tooltip" style={{ left: tooltip.left, top: tooltip.top }}>
          {tooltip.label}
        </div>
      ) : null}
    </div>
  );
}

function LegendSwatch({ color }: { color: string }): JSX.Element {
  return <i className="legend-swatch" style={{ backgroundColor: color }} />;
}

function positiveStaffHeatValues(notes: StaffHeatNote[]): number[] {
  return notes
    .map((note) => note.value)
    .filter((value): value is number => value !== undefined && value > 0);
}

function formatRangeSeconds(ms: number): string {
  return `${(ms / 1000).toFixed(1)}s`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isFormControlTarget(target: EventTarget | null): boolean {
  return (
    target instanceof HTMLElement &&
    Boolean(target.closest("button, input, select, textarea, [contenteditable='true']"))
  );
}

function isRangeKey(value: unknown): value is RangeKey {
  return typeof value === "string" && RANGE_KEYS.includes(value as RangeKey);
}

function isRecognitionTimeGrouping(value: unknown): value is RecognitionTimeGrouping {
  return typeof value === "string" && RECOGNITION_TIME_GROUPINGS.includes(value as RecognitionTimeGrouping);
}

function isRecognitionTimeMetric(value: unknown): value is RecognitionTimeMetric {
  return typeof value === "string" && RECOGNITION_TIME_METRICS.includes(value as RecognitionTimeMetric);
}

function isRecognitionTimeValueMode(value: unknown): value is RecognitionTimeValueMode {
  return typeof value === "string" && RECOGNITION_TIME_VALUE_MODES.includes(value as RecognitionTimeValueMode);
}

export function parseHiddenRecognitionSeries(
  value: unknown,
  fallback: RecognitionSeriesKey[] = [],
): RecognitionSeriesKey[] {
  if (!Array.isArray(value)) {
    return fallback;
  }

  const hiddenSeries = RECOGNITION_SERIES_KEYS.filter((seriesKey) => value.some((item) => item === seriesKey));
  return hiddenSeries.length === RECOGNITION_SERIES_KEYS.length ? fallback : hiddenSeries;
}

function isStatsCarouselCardId(value: unknown): value is StatsCarouselCardId {
  return typeof value === "string" && STATS_CAROUSEL_CARD_IDS.includes(value as StatsCarouselCardId);
}

function parseStatsUiPreferences(value: unknown, fallback: StatsUiPreferences): StatsUiPreferences {
  if (!isRecord(value)) {
    return fallback;
  }

  return {
    carouselCardId: isStatsCarouselCardId(value.carouselCardId) ? value.carouselCardId : fallback.carouselCardId,
    hiddenRecognitionSeries: parseHiddenRecognitionSeries(
      value.hiddenRecognitionSeries,
      fallback.hiddenRecognitionSeries,
    ),
    range: isRangeKey(value.range) ? value.range : fallback.range,
    recognitionTimeGrouping: isRecognitionTimeGrouping(value.recognitionTimeGrouping)
      ? value.recognitionTimeGrouping
      : fallback.recognitionTimeGrouping,
    recognitionTimeMetric: isRecognitionTimeMetric(value.recognitionTimeMetric)
      ? value.recognitionTimeMetric
      : fallback.recognitionTimeMetric,
    recognitionTimeValueMode: isRecognitionTimeValueMode(value.recognitionTimeValueMode)
      ? value.recognitionTimeValueMode
      : fallback.recognitionTimeValueMode,
  };
}

function normalizeStatsCarouselIndex(index: number): number {
  return ((index % STATS_CAROUSEL_CARD_IDS.length) + STATS_CAROUSEL_CARD_IDS.length) % STATS_CAROUSEL_CARD_IDS.length;
}

function getStatsCarouselTrackPosition(index: number): number {
  return index + STATS_CAROUSEL_REAL_OFFSET;
}

function getStatsCarouselDotTargetPosition(currentIndex: number, targetIndex: number): number {
  const directDelta = targetIndex - currentIndex;
  const cardCount = STATS_CAROUSEL_CARD_IDS.length;
  if (directDelta > cardCount / 2) {
    return getStatsCarouselTrackPosition(targetIndex - cardCount);
  }
  if (directDelta < -cardCount / 2) {
    return getStatsCarouselTrackPosition(targetIndex + cardCount);
  }
  return getStatsCarouselTrackPosition(targetIndex);
}

function isStatsCarouselDragBlockedTarget(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) {
    return true;
  }
  return Boolean(
    target.closest(
      [
        "button",
        "input",
        "select",
        "textarea",
        "a",
        "[contenteditable='true']",
        "[role='button']",
        ".chart-panel-actions",
        ".chart-box",
        ".note-heat-stack",
        ".session-progress-condition-bar",
        "canvas",
        "svg",
      ].join(", "),
    ),
  );
}

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

function RecognitionTimeChart({
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

export function StatsView({
  settings,
  reviews,
  sessions = EMPTY_SESSIONS,
  onSettingsSaved,
}: StatsViewProps): JSX.Element {
  const statsCarouselDragRef = useRef<{
    dragging: boolean;
    pointerId: number;
    startX: number;
    startY: number;
  } | null>(null);
  const statsCarouselMovingRef = useRef(false);
  const [statsUiPreferences, setStatsUiPreferences] = useLocalStorageState(
    STATS_UI_PREFERENCES_KEY,
    DEFAULT_STATS_UI_PREFERENCES,
    { parse: parseStatsUiPreferences },
  );
  const [sessionProgressPreferences, setSessionProgressPreferences] = useLocalStorageState(
    SESSION_PROGRESS_UI_PREFERENCES_KEY,
    DEFAULT_SESSION_PROGRESS_UI_PREFERENCES,
    { parse: parseSessionProgressUiPreferences },
  );
  const [singleCardCarousel, setSingleCardCarousel] = useState(false);
  const statsCarouselIndex = STATS_CAROUSEL_CARD_IDS.indexOf(statsUiPreferences.carouselCardId);
  const [statsCarouselPosition, setStatsCarouselPosition] = useState(() =>
    getStatsCarouselTrackPosition(statsCarouselIndex),
  );
  const [statsCarouselTransitionEnabled, setStatsCarouselTransitionEnabled] = useState(true);
  const range = statsUiPreferences.range;
  const recognitionTimeGrouping = statsUiPreferences.recognitionTimeGrouping;
  const recognitionTimeMetric = statsUiPreferences.recognitionTimeMetric;
  const recognitionTimeValueMode = statsUiPreferences.recognitionTimeValueMode;
  const recognitionVisibleSeries = useMemo(
    () => RECOGNITION_SERIES_KEYS.filter(
      (seriesKey) => !statsUiPreferences.hiddenRecognitionSeries.includes(seriesKey),
    ),
    [statsUiPreferences.hiddenRecognitionSeries],
  );
  const sessionProgressMode = sessionProgressPreferences.mode;
  const sessionProgressHistoryLimit = sessionProgressPreferences.historyLimit;
  const commitStatsCarouselIndex = (nextIndex: number): void => {
    const normalizedIndex = normalizeStatsCarouselIndex(nextIndex);
    setStatsUiPreferences((current) => {
      return {
        ...current,
        carouselCardId: STATS_CAROUSEL_CARD_IDS[normalizedIndex],
      };
    });
  };
  const startStatsCarouselMove = (targetPosition: number, targetIndex: number): void => {
    if (statsCarouselMovingRef.current) {
      return;
    }

    const normalizedIndex = normalizeStatsCarouselIndex(targetIndex);
    if (targetPosition === statsCarouselPosition) {
      commitStatsCarouselIndex(normalizedIndex);
      return;
    }

    statsCarouselMovingRef.current = true;
    setStatsCarouselTransitionEnabled(true);
    setStatsCarouselPosition(targetPosition);
    commitStatsCarouselIndex(normalizedIndex);
  };
  const moveStatsCarousel = (direction: -1 | 1): void => {
    startStatsCarouselMove(
      getStatsCarouselTrackPosition(statsCarouselIndex) + direction,
      statsCarouselIndex + direction,
    );
  };
  const jumpStatsCarousel = (targetIndex: number): void => {
    const normalizedIndex = normalizeStatsCarouselIndex(targetIndex);
    startStatsCarouselMove(getStatsCarouselDotTargetPosition(statsCarouselIndex, normalizedIndex), normalizedIndex);
  };
  const setRange = (nextRange: RangeKey): void => {
    setStatsUiPreferences((current) => ({ ...current, range: nextRange }));
  };
  const setRecognitionTimeGrouping = (nextGrouping: RecognitionTimeGrouping): void => {
    setStatsUiPreferences((current) => ({ ...current, recognitionTimeGrouping: nextGrouping }));
  };
  const setRecognitionTimeMetric = (nextMetric: RecognitionTimeMetric): void => {
    setStatsUiPreferences((current) => ({ ...current, recognitionTimeMetric: nextMetric }));
  };
  const setRecognitionTimeValueMode = (nextValueMode: RecognitionTimeValueMode): void => {
    setStatsUiPreferences((current) => ({ ...current, recognitionTimeValueMode: nextValueMode }));
  };
  const selectAllRecognitionSeries = (): void => {
    setStatsUiPreferences((current) => ({ ...current, hiddenRecognitionSeries: [] }));
  };
  const selectOnlyRecognitionSeries = (seriesKey: RecognitionSeriesKey): void => {
    setStatsUiPreferences((current) => ({
      ...current,
      hiddenRecognitionSeries: RECOGNITION_SERIES_KEYS.filter((candidate) => candidate !== seriesKey),
    }));
  };
  const toggleRecognitionSeries = (seriesKey: RecognitionSeriesKey): void => {
    setStatsUiPreferences((current) => {
      if (current.hiddenRecognitionSeries.includes(seriesKey)) {
        return {
          ...current,
          hiddenRecognitionSeries: current.hiddenRecognitionSeries.filter((candidate) => candidate !== seriesKey),
        };
      }
      if (current.hiddenRecognitionSeries.length === RECOGNITION_SERIES_KEYS.length - 1) {
        return current;
      }
      return {
        ...current,
        hiddenRecognitionSeries: [...current.hiddenRecognitionSeries, seriesKey],
      };
    });
  };
  const setSessionProgressMode = (nextMode: typeof sessionProgressMode): void => {
    setSessionProgressPreferences((current) => ({ ...current, mode: nextMode }));
  };
  const setSessionProgressHistoryLimit = (nextHistoryLimit: number): void => {
    setSessionProgressPreferences((current) => ({ ...current, historyLimit: nextHistoryLimit }));
  };

  const longTermReviews = useMemo(() => filterLongTermReviews(reviews), [reviews]);
  const staffNotationMode = settings.staffNotationMode;
  const activeNotes = useMemo(
    () => getNotesForGroups(settings.enabledGroupIds, settings.includeInterStaffLedgerSpellings, staffNotationMode),
    [settings.enabledGroupIds, settings.includeInterStaffLedgerSpellings, staffNotationMode],
  );
  const activeTargetNoteIds = useMemo(() => new Set(activeNotes.map((note) => note.id)), [activeNotes]);
  const groupScopedReviews = useMemo(() => {
    return longTermReviews.filter((review) => activeTargetNoteIds.has(review.targetNoteId));
  }, [activeTargetNoteIds, longTermReviews]);
  const filteredReviews = useMemo(() => filterByRange(groupScopedReviews, range), [groupScopedReviews, range]);
  const dailyStats = useMemo(() => buildDailyStats(groupScopedReviews), [groupScopedReviews]);
  const averageDailyActiveMs = useMemo(() => averageDailyPracticeMs(dailyStats, range), [dailyStats, range]);
  const recognitionTrendBySession = useMemo(
    () => buildRecognitionTrend(
      longTermReviews,
      sessions,
      activeNotes.map((note) => note.id),
      "practice-session",
    ),
    [activeNotes, longTermReviews, sessions],
  );
  const recognitionTrend = useMemo(
    () => recognitionTimeGrouping === "day"
      ? groupRecognitionTrendByDay(recognitionTrendBySession)
      : recognitionTrendBySession,
    [recognitionTimeGrouping, recognitionTrendBySession],
  );
  const recognitionTimeStats = useMemo(() => {
    const cutoff = rangeCutoff(range);
    const visible = cutoff
      ? recognitionTrend.filter((point) => new Date(point.boundaryAt) >= cutoff)
      : recognitionTrend;
    return visible.map((stat, index) => {
      const formatted = recognitionTimeGrouping === "day"
        ? { label: formatShortDate(stat.key), tooltipLabel: formatShortDate(stat.key) }
        : formatShortDateTime(stat.boundaryAt);
      const previousCoveredNoteIds = new Set(visible[index - 1]?.coveredNoteIds ?? []);
      const addedNoteLabels = index === 0
        ? []
        : activeNotes
            .filter((note) => stat.coveredNoteIds.includes(note.id) && !previousCoveredNoteIds.has(note.id))
            .map((note) => formatTargetNoteLabel(note, activeTargetNoteIds));
      return {
        ...formatted,
        addedNoteLabels,
        breakBefore: addedNoteLabels.length > 0,
        coveredNoteCount: stat.coveredNoteCount,
        errorRate: stat.errorRate === undefined ? undefined : stat.errorRate * 100,
        key: stat.key,
        median: stat.medianMs === undefined ? undefined : stat.medianMs / 1000,
        p10: stat.p10Ms === undefined ? undefined : stat.p10Ms / 1000,
        p90: stat.p90Ms === undefined ? undefined : stat.p90Ms / 1000,
        totalNoteCount: stat.totalNoteCount,
      };
    });
  }, [activeNotes, activeTargetNoteIds, range, recognitionTimeGrouping, recognitionTrend]);
  const recognitionCoverage = recognitionTrend[recognitionTrend.length - 1] ?? {
    coveredNoteCount: 0,
    totalNoteCount: activeNotes.length,
  };
  const sessionProgressComparison = useSessionProgressComparison({
    activeNotes,
    historyLimit: sessionProgressHistoryLimit,
    mode: sessionProgressMode,
    reviews,
    sessions,
  });
  const {
    selection: sessionProgressSelection,
    selectedSessionIds: sessionProgressSessionIds,
  } = sessionProgressComparison;
  const noteRangeReviews = useMemo(() => {
    if (!sessionProgressSelection) {
      return filteredReviews;
    }
    return filterByRange(
      longTermReviews.filter((review) => sessionProgressSessionIds.has(review.sessionId)),
      range,
    );
  }, [filteredReviews, longTermReviews, range, sessionProgressSelection, sessionProgressSessionIds]);
  const noteStats = useMemo(() => {
    if (activeNotes.length === 0) {
      return [];
    }
    const activeTargetNoteIds = new Set(activeNotes.map((note) => note.id));
    return buildNoteStats(noteRangeReviews).filter((stat) =>
      activeTargetNoteIds.has(stat.targetNoteId),
    );
  }, [activeNotes, noteRangeReviews]);
  const rangeStaffNotes = useMemo(() => {
    const statsByNoteId = new Map(noteStats.map((stat) => [stat.targetNoteId, stat]));
    return activeNotes.map((note) => ({ note, stat: statsByNoteId.get(note.id) }));
  }, [activeNotes, noteStats]);
  const errorStaffNotes = useMemo<StaffHeatNote[]>(
    () =>
      rangeStaffNotes.map(({ note, stat }) => ({
        confusions: stat?.commonConfusions ?? [],
        note,
        value: stat?.errorCount ?? 0,
      })),
    [rangeStaffNotes],
  );
  const timeStaffNotes = useMemo<StaffHeatNote[]>(
    () =>
      rangeStaffNotes.map(({ note, stat }) => ({
        durations: {
          medianMs: stat?.medianMs,
          p10Ms: stat?.p10Ms,
          p90Ms: stat?.p90Ms,
        },
        note,
        value: stat?.p90Ms,
      })),
    [rangeStaffNotes],
  );
  const timeTertileThresholds = useMemo(
    () => positiveTertileThresholds(positiveStaffHeatValues(timeStaffNotes)),
    [timeStaffNotes],
  );
  const errorTertileThresholds = useMemo(
    () => positiveTertileThresholds(positiveStaffHeatValues(errorStaffNotes)),
    [errorStaffNotes],
  );

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent): void => {
      const modified = event.altKey || event.ctrlKey || event.metaKey;
      if (event.defaultPrevented || modified || isFormControlTarget(event.target)) {
        return;
      }
      if (event.key === "ArrowLeft") {
        moveStatsCarousel(-1);
        event.preventDefault();
      }
      if (event.key === "ArrowRight") {
        moveStatsCarousel(1);
        event.preventDefault();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [statsCarouselIndex, statsCarouselPosition]);

  useEffect(() => {
    const media = window.matchMedia("(max-width: 820px)");
    const updateSingleCardCarousel = (): void => setSingleCardCarousel(media.matches);
    updateSingleCardCarousel();
    media.addEventListener("change", updateSingleCardCarousel);
    return () => media.removeEventListener("change", updateSingleCardCarousel);
  }, []);

  const statsCarouselTrackCardIds: StatsCarouselCardId[] = [
    STATS_CAROUSEL_CARD_IDS[STATS_CAROUSEL_CARD_IDS.length - 1],
    ...STATS_CAROUSEL_CARD_IDS,
    STATS_CAROUSEL_CARD_IDS[0],
    STATS_CAROUSEL_CARD_IDS[1],
  ];
  const visibleStatsCarouselIndexes = singleCardCarousel
    ? new Set([statsCarouselPosition])
    : new Set([statsCarouselPosition, statsCarouselPosition + 1]);
  const statsCarouselTrackStyle = {
    "--stats-carousel-single-translate": `calc(-${statsCarouselPosition * 100}% - ${statsCarouselPosition * 18}px)`,
    "--stats-carousel-translate": `calc(-${statsCarouselPosition * 50}% - ${statsCarouselPosition * 9}px)`,
  } as StatsCarouselTrackStyle;
  const finishStatsCarouselTransition = (event: ReactTransitionEvent<HTMLDivElement>): void => {
    if (event.target !== event.currentTarget || event.propertyName !== "transform") {
      return;
    }
    const lastRealPosition = getStatsCarouselTrackPosition(STATS_CAROUSEL_CARD_IDS.length - 1);
    const firstClonePosition = 0;
    const lastClonePosition = STATS_CAROUSEL_CARD_IDS.length + STATS_CAROUSEL_REAL_OFFSET;
    const snapPosition =
      statsCarouselPosition === firstClonePosition
        ? lastRealPosition
        : statsCarouselPosition === lastClonePosition
          ? getStatsCarouselTrackPosition(0)
          : undefined;
    statsCarouselMovingRef.current = false;
    if (snapPosition === undefined) {
      return;
    }
    setStatsCarouselTransitionEnabled(false);
    setStatsCarouselPosition(snapPosition);
    window.requestAnimationFrame(() => {
      window.requestAnimationFrame(() => setStatsCarouselTransitionEnabled(true));
    });
  };
  const beginStatsCarouselDrag = (event: ReactPointerEvent<HTMLDivElement>): void => {
    if (event.button !== 0 || !event.isPrimary || isStatsCarouselDragBlockedTarget(event.target)) {
      return;
    }
    statsCarouselDragRef.current = {
      dragging: false,
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
    event.preventDefault();
  };
  const updateStatsCarouselDrag = (event: ReactPointerEvent<HTMLDivElement>): void => {
    const drag = statsCarouselDragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) {
      return;
    }
    const deltaX = event.clientX - drag.startX;
    const deltaY = event.clientY - drag.startY;
    if (Math.max(Math.abs(deltaX), Math.abs(deltaY)) > 8) {
      drag.dragging = true;
    }
  };
  const endStatsCarouselDrag = (event: ReactPointerEvent<HTMLDivElement>): void => {
    const drag = statsCarouselDragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) {
      return;
    }
    statsCarouselDragRef.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }

    const deltaX = event.clientX - drag.startX;
    const deltaY = event.clientY - drag.startY;
    const horizontalDrag =
      drag.dragging &&
      Math.abs(deltaX) >= STATS_CAROUSEL_DRAG_THRESHOLD_PX &&
      Math.abs(deltaX) > Math.abs(deltaY) * 1.2;
    if (!horizontalDrag) {
      return;
    }

    moveStatsCarousel(deltaX < 0 ? 1 : -1);
    event.preventDefault();
  };
  const cancelStatsCarouselDrag = (event: ReactPointerEvent<HTMLDivElement>): void => {
    const drag = statsCarouselDragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) {
      return;
    }
    statsCarouselDragRef.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  };
  const renderStatsCard = (cardId: StatsCarouselCardId): JSX.Element => {
    if (cardId === "recognition-time") {
      return (
        <div className="panel chart-panel stats-carousel-card">
          <div className="panel-heading">
            <h2>识别趋势</h2>
            <div className="chart-panel-actions recognition-trend-actions">
              <div className="segmented" aria-label="识别趋势指标">
                <button
                  className={recognitionTimeMetric === "speed" ? "active" : ""}
                  onClick={() => setRecognitionTimeMetric("speed")}
                >
                  速度
                </button>
                <button
                  className={recognitionTimeMetric === "duration" ? "active" : ""}
                  onClick={() => setRecognitionTimeMetric("duration")}
                >
                  耗时
                </button>
              </div>
              <div className="segmented" aria-label="识别趋势数值模式">
                <button
                  className={recognitionTimeValueMode === "absolute" ? "active" : ""}
                  onClick={() => setRecognitionTimeValueMode("absolute")}
                >
                  绝对
                </button>
                <button
                  className={recognitionTimeValueMode === "relative" ? "active" : ""}
                  onClick={() => setRecognitionTimeValueMode("relative")}
                >
                  相对
                </button>
              </div>
              <div className="segmented" aria-label="识别趋势分组">
                <button
                  className={recognitionTimeGrouping === "day" ? "active" : ""}
                  onClick={() => setRecognitionTimeGrouping("day")}
                >
                  按天
                </button>
                <button
                  className={recognitionTimeGrouping === "practice-session" ? "active" : ""}
                  onClick={() => setRecognitionTimeGrouping("practice-session")}
                >
                  按会话
                </button>
              </div>
            </div>
          </div>
          <div className="chart-box">
            {recognitionCoverage.coveredNoteCount === 0 ? (
              <div className="empty-state">
                数据正在积累：0/{recognitionCoverage.totalNoteCount} 个音已完成至少 20 次有效练习。再练习几次，回来看看整体进步吧。
              </div>
            ) : recognitionTimeStats.length === 0 ? (
              <div className="empty-state">所选时间范围内暂无趋势点</div>
            ) : (
              <>
                <RecognitionTimeChart
                  data={recognitionTimeStats}
                  metric={recognitionTimeMetric}
                  onSelectAllSeries={selectAllRecognitionSeries}
                  onSelectOnlySeries={selectOnlyRecognitionSeries}
                  onToggleSeries={toggleRecognitionSeries}
                  valueMode={recognitionTimeValueMode}
                  visibleSeries={recognitionVisibleSeries}
                />
                <small className="note-range-filter-note">
                  {recognitionTimeValueMode === "relative"
                    ? `每段首点为 0%，${recognitionTimeMetric === "speed" ? "正值" : "负值"}表示更快；`
                    : ""}
                  已纳入 {recognitionCoverage.coveredNoteCount}/{recognitionCoverage.totalNoteCount} 个音
                  {recognitionCoverage.coveredNoteCount < recognitionCoverage.totalNoteCount ? "，其余数据积累中" : ""}
                </small>
              </>
            )}
          </div>
        </div>
      );
    }

    if (cardId === "session-progress") {
      return (
        <SessionProgressCard
          historyLimit={sessionProgressHistoryLimit}
          mode={sessionProgressMode}
          model={sessionProgressComparison}
          onHistoryLimitChange={setSessionProgressHistoryLimit}
          onModeChange={setSessionProgressMode}
        />
      );
    }

    return (
      <div className="panel note-heat-panel stats-carousel-card">
        <div className="panel-heading">
          <h2>音域分布</h2>
          <small className="note-range-filter-note">
            {sessionProgressSelection
              ? "沿用答对进度的会话条件"
              : "暂无对应有效会话，已按目标音集合汇总"}
          </small>
        </div>
        <div className="note-heat-stack">
          <div className="note-heat-row">
            <div className="note-heat-row-heading">
              <h3>识别速度</h3>
              <div className="range-legend">
                <span>
                  <LegendSwatch color={STATS_COLORS.range.neutral} />
                  无记录
                </span>
                <span>
                  <LegendSwatch color={STATS_COLORS.range.tone.blue[1]} />
                  较快{timeTertileThresholds ? ` (≤${formatRangeSeconds(timeTertileThresholds.low)})` : ""}
                </span>
                <span>
                  <LegendSwatch color={STATS_COLORS.range.tone.blue[2]} />
                  中等
                </span>
                <span>
                  <LegendSwatch color={STATS_COLORS.range.tone.blue[3]} />
                  较慢{timeTertileThresholds ? ` (>${formatRangeSeconds(timeTertileThresholds.high)})` : ""}
                </span>
              </div>
            </div>
            <StatsRangeStaff
              label="识别速度音域分布"
              notes={timeStaffNotes}
              staffNotationMode={staffNotationMode}
              tone="blue"
            />
          </div>
          <div className="note-heat-row">
            <div className="note-heat-row-heading">
              <h3>错音次数</h3>
              <div className="range-legend">
                <span>
                  <LegendSwatch color={STATS_COLORS.range.neutral} />
                  0
                </span>
                <span>
                  <LegendSwatch color={STATS_COLORS.range.tone.red[1]} />
                  较低{errorTertileThresholds ? ` (≤${Math.floor(errorTertileThresholds.low)}次)` : ""}
                </span>
                <span>
                  <LegendSwatch color={STATS_COLORS.range.tone.red[2]} />
                  中等
                </span>
                <span>
                  <LegendSwatch color={STATS_COLORS.range.tone.red[3]} />
                  较高{errorTertileThresholds ? ` (≥${Math.floor(errorTertileThresholds.high) + 1}次)` : ""}
                </span>
              </div>
            </div>
            <StatsRangeStaff
              label="错音次数音域分布"
              notes={errorStaffNotes}
              staffNotationMode={staffNotationMode}
              tone="red"
            />
          </div>
        </div>
      </div>
    );
  };

  return (
    <section className="stats-shell">
      <GlobalRangeControls settings={settings} onSettingsSaved={onSettingsSaved} />
      <div className="stats-header">
        <div>
          <h1>统计</h1>
        </div>
        <div className="toolbar stats-range-filter stats-header-range-filter">
          <div className="segmented" aria-label="统计天数筛选">
            <button className={range === "1" ? "active" : ""} onClick={() => setRange("1")}>
              1 天
            </button>
            <button className={range === "7" ? "active" : ""} onClick={() => setRange("7")}>
              7 天
            </button>
            <button className={range === "30" ? "active" : ""} onClick={() => setRange("30")}>
              30 天
            </button>
            <button className={range === "all" ? "active" : ""} onClick={() => setRange("all")}>
              全部
            </button>
          </div>
        </div>
      </div>

      <div className="panel heatmap-panel stats-heatmap-panel">
        <div className="panel-heading">
          <h2>练习量</h2>
          <p className="heatmap-daily-average">
            <span>日平均练习时长</span>
            <strong>{formatPracticeDuration(averageDailyActiveMs)}</strong>
          </p>
        </div>
        <HeatMap dailyStats={dailyStats} />
      </div>

      <div
        className={singleCardCarousel ? "stats-card-carousel stats-card-carousel-single" : "stats-card-carousel"}
      >
        <div
          className="stats-card-carousel-viewport"
          onPointerCancel={cancelStatsCarouselDrag}
          onPointerDown={beginStatsCarouselDrag}
          onPointerMove={updateStatsCarouselDrag}
          onPointerUp={endStatsCarouselDrag}
        >
          <div
            className={
              statsCarouselTransitionEnabled
                ? "stats-card-carousel-track"
                : "stats-card-carousel-track stats-card-carousel-track-instant"
            }
            style={statsCarouselTrackStyle}
            onTransitionEnd={finishStatsCarouselTransition}
          >
            {statsCarouselTrackCardIds.map((cardId, index) => {
              const visible = visibleStatsCarouselIndexes.has(index);
              return (
                <div
                  aria-hidden={!visible}
                  className="stats-card-carousel-slide"
                  inert={visible ? undefined : true}
                  key={`${cardId}-${index}`}
                >
                  {renderStatsCard(cardId)}
                </div>
              );
            })}
          </div>
        </div>
        <div className="chart-carousel-nav stats-card-carousel-nav" aria-label="统计卡片切换" role="group">
          <button
            aria-label="查看上一组统计卡片"
            className="chart-carousel-arrow"
            onClick={() => moveStatsCarousel(-1)}
            type="button"
          >
            <ChevronLeft size={20} />
          </button>
          <div className="chart-carousel-dots" aria-label="统计卡片位置">
            {STATS_CAROUSEL_CARD_IDS.map((cardId, index) => (
              <button
                aria-label={`查看${
                  singleCardCarousel ? STATS_CAROUSEL_CARD_LABELS[index] : STATS_CAROUSEL_PAIR_LABELS[index]
                }`}
                className={statsCarouselIndex === index ? "active" : ""}
                key={cardId}
                onClick={() => jumpStatsCarousel(index)}
                type="button"
              />
            ))}
          </div>
          <button
            aria-label="查看下一组统计卡片"
            className="chart-carousel-arrow"
            onClick={() => moveStatsCarousel(1)}
            type="button"
          >
            <ChevronRight size={20} />
          </button>
        </div>
      </div>
    </section>
  );
}
