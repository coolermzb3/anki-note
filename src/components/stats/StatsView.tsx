import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
  type TransitionEvent as ReactTransitionEvent,
} from "react";
import { formatTargetNoteLabel, getNotesForGroups } from "../../domain/notes";
import {
  buildDailyStats,
  buildNoteStats,
  buildRecognitionTrend,
  filterLongTermReviews,
  groupRecognitionTrendByDay,
  positiveTertileThresholds,
} from "../../domain/stats";
import type {
  AppSettings,
  PracticeSessionRecord,
  ReviewRecord,
} from "../../domain/types";
import { GlobalRangeControls } from "../GlobalRangeControls";
import {
  DEFAULT_SESSION_PROGRESS_UI_PREFERENCES,
  parseSessionProgressUiPreferences,
  SESSION_PROGRESS_UI_PREFERENCES_KEY,
} from "../sessionProgressPreferences";
import { useLocalStorageState } from "../useLocalStorageState";
import { PracticeHeatmap } from "./PracticeHeatmap";
import { RecognitionTrendCard } from "./RecognitionTrendCard";
import {
  RECOGNITION_SERIES_KEYS,
  type RecognitionSeriesKey,
  type RecognitionTimeChartStat,
  type RecognitionTimeGrouping,
  type RecognitionTimeMetric,
  type RecognitionTimeValueMode,
} from "./recognitionTrend";
import { SessionProgressCard } from "./SessionProgressCard";
import { StatsRangeStaff, type StaffHeatNote } from "./StatsRangeStaff";
import { STATS_COLORS } from "./statsColors";
import { getStatsRangeCutoff, type StatsRange } from "./statsRange";
import {
  DEFAULT_STATS_UI_PREFERENCES,
  parseStatsUiPreferences,
  STATS_CAROUSEL_CARD_IDS,
  STATS_UI_PREFERENCES_KEY,
  type StatsCarouselCardId,
} from "./statsUiPreferences";
import { useSessionProgressComparison } from "./useSessionProgressComparison";

interface StatsViewProps {
  settings: AppSettings;
  reviews: ReviewRecord[];
  sessions?: PracticeSessionRecord[];
  onSettingsSaved: (settings: AppSettings) => void | Promise<void>;
}

const STATS_CAROUSEL_CARD_LABELS = ["识别趋势", "答对进度", "音域分布"] as const;
const STATS_CAROUSEL_PAIR_LABELS = ["识别趋势和答对进度", "答对进度和音域分布", "音域分布和识别趋势"] as const;
const STATS_CAROUSEL_DRAG_THRESHOLD_PX = 48;
const STATS_CAROUSEL_REAL_OFFSET = 1;
type StatsCarouselTrackStyle = CSSProperties & {
  "--stats-carousel-single-translate": string;
  "--stats-carousel-translate": string;
};

const EMPTY_SESSIONS: PracticeSessionRecord[] = [];

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

function filterByRange(reviews: ReviewRecord[], range: StatsRange): ReviewRecord[] {
  const cutoff = getStatsRangeCutoff(range);
  return cutoff ? reviews.filter((review) => new Date(review.endedAt) >= cutoff) : reviews;
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

function isFormControlTarget(target: EventTarget | null): boolean {
  return (
    target instanceof HTMLElement &&
    Boolean(target.closest("button, input, select, textarea, [contenteditable='true']"))
  );
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
  const setRange = (nextRange: StatsRange): void => {
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
  const recognitionTimeStats = useMemo<RecognitionTimeChartStat[]>(() => {
    const cutoff = getStatsRangeCutoff(range);
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
        <RecognitionTrendCard
          coverage={recognitionCoverage}
          data={recognitionTimeStats}
          grouping={recognitionTimeGrouping}
          metric={recognitionTimeMetric}
          onGroupingChange={setRecognitionTimeGrouping}
          onMetricChange={setRecognitionTimeMetric}
          onSelectAllSeries={selectAllRecognitionSeries}
          onSelectOnlySeries={selectOnlyRecognitionSeries}
          onToggleSeries={toggleRecognitionSeries}
          onValueModeChange={setRecognitionTimeValueMode}
          valueMode={recognitionTimeValueMode}
          visibleSeries={recognitionVisibleSeries}
        />
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

      <PracticeHeatmap dailyStats={dailyStats} range={range} />

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
            aria-keyshortcuts="ArrowLeft"
            className="chart-carousel-arrow"
            onClick={() => moveStatsCarousel(-1)}
            type="button"
          >
            <kbd aria-hidden="true">←</kbd>
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
            aria-keyshortcuts="ArrowRight"
            className="chart-carousel-arrow"
            onClick={() => moveStatsCarousel(1)}
            type="button"
          >
            <kbd aria-hidden="true">→</kbd>
          </button>
        </div>
      </div>
    </section>
  );
}
