import * as echarts from "echarts";
import type { EChartsOption } from "echarts";
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
import { getNotesForGroups } from "../domain/notes";
import {
  buildDailyStats,
  buildNoteStats,
  buildPracticeSessionStats,
  filterLongTermReviews,
} from "../domain/stats";
import {
  buildLatestSessionProgressBenchmark,
  buildLatestSessionProgressSeries,
} from "../domain/sessionProgress";
import type { AppSettings, PracticeSessionRecord, ReviewRecord } from "../domain/types";
import { GlobalRangeControls } from "./GlobalRangeControls";
import {
  SessionProgressChart,
  SessionProgressControls,
  SessionProgressLegend,
} from "./SessionProgressChart";
import {
  DEFAULT_SESSION_PROGRESS_UI_PREFERENCES,
  parseSessionProgressUiPreferences,
  SESSION_PROGRESS_UI_PREFERENCES_KEY,
} from "./sessionProgressPreferences";
import { StatsRangeStaff, type StaffHeatNote } from "./StatsRangeStaff";
import { STATS_COLORS } from "./statsColors";
import { useLocalStorageState } from "./useLocalStorageState";

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
const STATS_CAROUSEL_CARD_IDS = ["recognition-time", "session-progress", "note-range"] as const;
const STATS_CAROUSEL_CARD_LABELS = ["识别时长", "答对进度", "音域分布"] as const;
const STATS_CAROUSEL_PAIR_LABELS = ["识别时长和答对进度", "答对进度和音域分布", "音域分布和识别时长"] as const;
const STATS_CAROUSEL_DRAG_THRESHOLD_PX = 48;
const STATS_CAROUSEL_REAL_OFFSET = 1;
const STATS_UI_PREFERENCES_KEY = "anki-note.statsUiPreferences";
type StatsCarouselCardId = (typeof STATS_CAROUSEL_CARD_IDS)[number];
interface StatsUiPreferences {
  carouselCardId: StatsCarouselCardId;
  range: RangeKey;
  recognitionTimeGrouping: RecognitionTimeGrouping;
}
type StatsCarouselTrackStyle = CSSProperties & {
  "--stats-carousel-single-translate": string;
  "--stats-carousel-translate": string;
};
interface RecognitionTimeChartStat {
  key: string;
  label: string;
  tooltipLabel: string;
  completedReviews: number;
  p10?: number;
  median?: number;
  p90?: number;
}

const EMPTY_SESSIONS: PracticeSessionRecord[] = [];
const HEATMAP_WEEK_COUNT = 53;
const RECOGNITION_CHART_COLORS = STATS_COLORS.recognitionChart;
const RECOGNITION_CHART_HANDLE_ICON =
  "path://M11,5 H17 A4,4 0 0 1 21,9 V23 A4,4 0 0 1 17,27 H11 A4,4 0 0 1 7,23 V9 A4,4 0 0 1 11,5 Z M14,-3 V5 M14,27 V35";
const WEEKDAY_LABELS = ["周一", "", "周三", "", "周五", "", "周日"];
const DEFAULT_STATS_UI_PREFERENCES: StatsUiPreferences = {
  carouselCardId: STATS_CAROUSEL_CARD_IDS[1],
  range: "30",
  recognitionTimeGrouping: "practice-session",
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

function filterByRange(reviews: ReviewRecord[], range: RangeKey): ReviewRecord[] {
  if (range === "all") {
    return reviews;
  }
  const days = Number(range);
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - days + 1);
  cutoff.setHours(0, 0, 0, 0);
  return reviews.filter((review) => new Date(review.endedAt) >= cutoff);
}

function HeatMap({ reviews }: { reviews: ReviewRecord[] }): JSX.Element {
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const daily = buildDailyStats(reviews);
  const byDate = new Map(daily.map((day) => [day.date, day]));
  const today = new Date();
  const todayStart = new Date(today);
  todayStart.setHours(0, 0, 0, 0);
  const firstWeekStart = startOfWeek(today);
  firstWeekStart.setDate(firstWeekStart.getDate() - (HEATMAP_WEEK_COUNT - 1) * 7);
  const weekStarts = Array.from({ length: HEATMAP_WEEK_COUNT }, (_, index) => {
    const date = new Date(firstWeekStart);
    date.setDate(firstWeekStart.getDate() + index * 7);
    return date;
  });
  const days = weekStarts.flatMap((weekStart) => {
    return Array.from({ length: 7 }, (_, dayOffset) => {
      const date = new Date(weekStart);
      date.setDate(weekStart.getDate() + dayOffset);
      const key = formatDateKey(date);
      return { date, key, stat: byDate.get(key) };
    }).filter((day) => day.date.getTime() <= todayStart.getTime());
  });

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
          <span key={`${index}-${label}`}>{label ? <span className="heatmap-weekday-label">{label}</span> : null}</span>
        ))}
      </div>
      <div className="heatmap-scroll" ref={scrollRef}>
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
              return (
                <div
                  aria-label={`${day.key}: ${day.stat?.completedReviews ?? 0} 次`}
                  className="heat-cell"
                  key={day.key}
                  style={{ backgroundColor: STATS_COLORS.heatmap[heatLevel] }}
                  title={`${day.key}: ${day.stat?.completedReviews ?? 0}`}
                />
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}

function LegendSwatch({ color }: { color: string }): JSX.Element {
  return <i className="legend-swatch" style={{ backgroundColor: color }} />;
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

function isStatsCarouselCardId(value: unknown): value is StatsCarouselCardId {
  return typeof value === "string" && STATS_CAROUSEL_CARD_IDS.includes(value as StatsCarouselCardId);
}

function parseStatsUiPreferences(value: unknown, fallback: StatsUiPreferences): StatsUiPreferences {
  if (!isRecord(value)) {
    return fallback;
  }

  return {
    carouselCardId: isStatsCarouselCardId(value.carouselCardId) ? value.carouselCardId : fallback.carouselCardId,
    range: isRangeKey(value.range) ? value.range : fallback.range,
    recognitionTimeGrouping: isRecognitionTimeGrouping(value.recognitionTimeGrouping)
      ? value.recognitionTimeGrouping
      : fallback.recognitionTimeGrouping,
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
        "canvas",
        "svg",
      ].join(", "),
    ),
  );
}

function makeRecognitionTimeChartOption(data: RecognitionTimeChartStat[]): EChartsOption {
  const showPointSymbols = data.length === 1;
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

  return {
    animation: false,
    color: [RECOGNITION_CHART_COLORS.p10, RECOGNITION_CHART_COLORS.median, RECOGNITION_CHART_COLORS.p90],
    dataZoom: [
      { end: 100, filterMode: "none", start: 0, type: "inside", xAxisIndex: 0 },
      {
        ...dataZoomSliderStyle,
        bottom: 16,
        end: 100,
        height: 34,
        start: 0,
        type: "slider",
        xAxisIndex: 0,
      },
      { filterMode: "none", type: "inside", yAxisIndex: 0 },
      {
        ...dataZoomSliderStyle,
        filterMode: "none",
        right: 12,
        type: "slider",
        width: 34,
        yAxisIndex: 0,
      },
    ],
    grid: {
      bottom: 82,
      left: 50,
      right: 66,
      top: 38,
    },
    legend: {
      icon: "rect",
      itemGap: 14,
      itemHeight: 3,
      itemWidth: 18,
      right: 16,
      textStyle: { color: RECOGNITION_CHART_COLORS.muted, fontSize: 13 },
      top: 4,
    },
    series: [
      {
        connectNulls: false,
        data: data.map((stat) => stat.p10 ?? null),
        name: "P10",
        showSymbol: showPointSymbols,
        smooth: true,
        symbolSize: 7,
        type: "line",
      },
      {
        connectNulls: false,
        data: data.map((stat) => stat.median ?? null),
        lineStyle: { width: 2.5 },
        name: "中位",
        showSymbol: showPointSymbols,
        smooth: true,
        symbolSize: 7,
        type: "line",
      },
      {
        connectNulls: false,
        data: data.map((stat) => stat.p90 ?? null),
        name: "P90",
        showSymbol: showPointSymbols,
        smooth: true,
        symbolSize: 7,
        type: "line",
      },
    ],
    tooltip: {
      axisPointer: { animation: false, type: "line" },
      enterable: false,
      extraCssText: "pointer-events: none;",
      formatter: (params) => {
        const items = Array.isArray(params) ? params : [params];
        const firstItem = items[0] as { dataIndex?: number } | undefined;
        const stat = firstItem?.dataIndex === undefined ? undefined : data[firstItem.dataIndex];
        const title = stat?.tooltipLabel ?? "";
        const completed = stat
          ? `<div style="color:${RECOGNITION_CHART_COLORS.muted}">完成 ${stat.completedReviews} 次</div>`
          : "";
        const rows = items
          .map((item) => {
            const point = item as { marker?: string; seriesName?: string; value?: number | string | null };
            if (point.value === null || point.value === undefined || point.value === "") {
              return "";
            }
            return `<div>${point.marker ?? ""}${point.seriesName ?? ""}: ${point.value}s</div>`;
          })
          .filter(Boolean)
          .join("");
        return `<div><strong>${title}</strong>${completed}${rows}</div>`;
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
    yAxis: {
      axisLabel: {
        color: RECOGNITION_CHART_COLORS.muted,
        fontSize: 11,
        formatter: "{value}s",
      },
      min: 0,
      splitLine: { lineStyle: { color: RECOGNITION_CHART_COLORS.grid, type: "dashed" } },
      type: "value",
    },
  };
}

function RecognitionTimeChart({ data }: { data: RecognitionTimeChartStat[] }): JSX.Element {
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
    chartRef.current?.setOption(makeRecognitionTimeChartOption(data), true);
  }, [data]);

  return <div aria-label="识别时长折线图" className="recognition-time-chart" ref={chartElementRef} role="img" />;
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
  const setSessionProgressMode = (nextMode: typeof sessionProgressMode): void => {
    setSessionProgressPreferences((current) => ({ ...current, mode: nextMode }));
  };
  const setSessionProgressHistoryLimit = (nextHistoryLimit: number): void => {
    setSessionProgressPreferences((current) => ({ ...current, historyLimit: nextHistoryLimit }));
  };

  const longTermReviews = useMemo(() => filterLongTermReviews(reviews), [reviews]);
  const activeNotes = useMemo(
    () => getNotesForGroups(settings.enabledGroupIds, settings.includeLedgerVariants),
    [settings.enabledGroupIds, settings.includeLedgerVariants],
  );
  const groupScopedReviews = useMemo(() => {
    const activeTargetNoteIds = new Set(activeNotes.map((note) => note.id));
    return longTermReviews.filter((review) => activeTargetNoteIds.has(review.targetNoteId));
  }, [activeNotes, longTermReviews]);
  const filteredReviews = useMemo(() => filterByRange(groupScopedReviews, range), [groupScopedReviews, range]);
  const recognitionTimeStats = useMemo(() => {
    const source =
      recognitionTimeGrouping === "day"
        ? buildDailyStats(filteredReviews).map((day) => ({
            key: day.date,
            label: formatShortDate(day.date),
            tooltipLabel: formatShortDate(day.date),
            completedReviews: day.completedReviews,
            p10Ms: day.p10Ms,
            medianMs: day.medianMs,
            p90Ms: day.p90Ms,
          }))
        : buildPracticeSessionStats(filteredReviews, sessions).map((session) => {
            const startedAt = formatShortDateTime(session.startedAt);
            return {
              key: session.sessionId,
              label: startedAt.label,
              tooltipLabel: startedAt.tooltipLabel,
              completedReviews: session.completedReviews,
              p10Ms: session.p10Ms,
              medianMs: session.medianMs,
              p90Ms: session.p90Ms,
            };
          });

    return source.map((stat) => ({
      ...stat,
      p10: stat.p10Ms === undefined ? undefined : Number((stat.p10Ms / 1000).toFixed(2)),
      median: stat.medianMs === undefined ? undefined : Number((stat.medianMs / 1000).toFixed(2)),
      p90: stat.p90Ms === undefined ? undefined : Number((stat.p90Ms / 1000).toFixed(2)),
    }));
  }, [filteredReviews, recognitionTimeGrouping, sessions]);
  const sessionProgressSeries = useMemo(
    () =>
      buildLatestSessionProgressSeries({
        settings,
        sessions,
        reviews,
        historyLimit: sessionProgressHistoryLimit,
        mode: sessionProgressMode,
      }),
    [reviews, sessions, sessionProgressHistoryLimit, sessionProgressMode, settings],
  );
  const sessionProgressBenchmark = useMemo(
    () => buildLatestSessionProgressBenchmark({ settings, sessions, reviews }),
    [reviews, sessions, settings],
  );
  const noteStats = useMemo(() => {
    if (activeNotes.length === 0) {
      return [];
    }
    const activeTargetNoteIds = new Set(activeNotes.map((note) => note.id));
    return buildNoteStats(filteredReviews, settings.enabledGroupIds).filter((stat) =>
      activeTargetNoteIds.has(stat.targetNoteId),
    );
  }, [activeNotes, filteredReviews, settings.enabledGroupIds]);
  const rangeStaffNotes = useMemo(() => {
    const statsByNoteId = new Map(noteStats.map((stat) => [stat.targetNoteId, stat]));
    return activeNotes.map((note) => ({ note, stat: statsByNoteId.get(note.id) }));
  }, [activeNotes, noteStats]);
  const errorStaffNotes = useMemo<StaffHeatNote[]>(
    () => rangeStaffNotes.map(({ note, stat }) => ({ note, value: stat?.errorCount ?? 0 })),
    [rangeStaffNotes],
  );
  const timeStaffNotes = useMemo<StaffHeatNote[]>(
    () => rangeStaffNotes.map(({ note, stat }) => ({ note, value: stat?.medianMs })),
    [rangeStaffNotes],
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
            <h2>识别时长</h2>
            <div className="chart-panel-actions">
              <div className="segmented" aria-label="识别时长分组">
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
                  按练习会话
                </button>
              </div>
            </div>
          </div>
          <div className="chart-box">
            {recognitionTimeStats.length === 0 ? (
              <div className="empty-state">暂无记录</div>
            ) : (
              <RecognitionTimeChart data={recognitionTimeStats} />
            )}
          </div>
        </div>
      );
    }

    if (cardId === "session-progress") {
      return (
        <div className="panel chart-panel stats-carousel-card">
          <div className="panel-heading">
            <h2>答对进度</h2>
            <div className="chart-panel-actions">
              <SessionProgressControls
                benchmark={sessionProgressBenchmark}
                historyLimit={sessionProgressHistoryLimit}
                mode={sessionProgressMode}
                onHistoryLimitChange={setSessionProgressHistoryLimit}
                onModeChange={setSessionProgressMode}
              />
            </div>
          </div>
          <div className="chart-box">
            {sessionProgressSeries.length === 0 ? (
              <div className="empty-state">暂无记录</div>
            ) : (
              <>
                <SessionProgressChart height={330} series={sessionProgressSeries} />
                <SessionProgressLegend series={sessionProgressSeries} />
              </>
            )}
          </div>
        </div>
      );
    }

    return (
      <div className="panel note-heat-panel stats-carousel-card">
        <div className="panel-heading">
          <h2>音域分布</h2>
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
                  较快
                </span>
                <span>
                  <LegendSwatch color={STATS_COLORS.range.tone.blue[2]} />
                  中等
                </span>
                <span>
                  <LegendSwatch color={STATS_COLORS.range.tone.blue[3]} />
                  较慢
                </span>
              </div>
            </div>
            <StatsRangeStaff label="识别速度音域分布" notes={timeStaffNotes} tone="blue" />
          </div>
          <div className="note-heat-row">
            <div className="note-heat-row-heading">
              <h3>错误次数</h3>
              <div className="range-legend">
                <span>
                  <LegendSwatch color={STATS_COLORS.range.neutral} />
                  0
                </span>
                <span>
                  <LegendSwatch color={STATS_COLORS.range.tone.red[1]} />
                  较低
                </span>
                <span>
                  <LegendSwatch color={STATS_COLORS.range.tone.red[2]} />
                  中等
                </span>
                <span>
                  <LegendSwatch color={STATS_COLORS.range.tone.red[3]} />
                  较高
                </span>
              </div>
            </div>
            <StatsRangeStaff label="错误次数音域分布" notes={errorStaffNotes} tone="red" />
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
        </div>
        <HeatMap reviews={groupScopedReviews} />
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
