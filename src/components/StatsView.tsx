import { BarChart3 } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { getCurrentTargetNoteIdsForGroups, PRACTICE_GROUPS } from "../domain/notes";
import {
  buildDailyStats,
  buildNoteStats,
  buildPracticeSessionStats,
  filterLongTermReviews,
} from "../domain/stats";
import type { NoteName, PracticeGroupId, PracticeSessionRecord, ReviewRecord, Staff, TargetNote } from "../domain/types";
import { StatsRangeStaff, type StaffHeatNote } from "./StatsRangeStaff";

interface StatsViewProps {
  reviews: ReviewRecord[];
  sessions?: PracticeSessionRecord[];
}

type RangeKey = "1" | "7" | "30" | "all";
type RecognitionTimeGrouping = "day" | "practice-session";

const EMPTY_SESSIONS: PracticeSessionRecord[] = [];
const ALL_STATS_GROUP_IDS: PracticeGroupId[] = PRACTICE_GROUPS.map((group) => group.id);
const HEATMAP_WEEK_COUNT = 53;
const RECOGNITION_CHART_ANIMATION_MS = 180;
const WEEKDAY_LABELS = ["周一", "", "周三", "", "周五", "", "周日"];
const NOTE_ORDER: Record<NoteName, number> = {
  C: 0,
  D: 1,
  E: 2,
  F: 3,
  G: 4,
  A: 5,
  B: 6,
};
const STAFF_ORDER: Record<Staff, number> = {
  bass: 0,
  treble: 1,
};

function compareRangeStaffNotes(a: TargetNote, b: TargetNote): number {
  return (
    STAFF_ORDER[a.staff] - STAFF_ORDER[b.staff] ||
    a.octave - b.octave ||
    NOTE_ORDER[a.noteName] - NOTE_ORDER[b.noteName]
  );
}

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

function RecognitionTimeTick({
  x = 0,
  y = 0,
  payload,
}: {
  x?: number;
  y?: number;
  payload?: { value: string };
}): JSX.Element {
  const lines = String(payload?.value ?? "").split("\n");
  return (
    <g transform={`translate(${x},${y})`}>
      <text fill="#7a6f61" fontSize={11} textAnchor="middle">
        {lines.map((line, index) => (
          <tspan dy={index === 0 ? 12 : 13} key={`${line}-${index}`} x={0}>
            {line}
          </tspan>
        ))}
      </text>
    </g>
  );
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
            {days.map((day) => (
              <div
                aria-label={`${day.key}: ${day.stat?.completedReviews ?? 0} 次`}
                className={`heat-cell heat-${day.stat?.heatLevel ?? 0}`}
                key={day.key}
                title={`${day.key}: ${day.stat?.completedReviews ?? 0}`}
              />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

export function StatsView({ reviews, sessions = EMPTY_SESSIONS }: StatsViewProps): JSX.Element {
  const [range, setRange] = useState<RangeKey>("30");
  const [selectedGroupIds, setSelectedGroupIds] = useState<PracticeGroupId[]>(ALL_STATS_GROUP_IDS);
  const [recognitionTimeGrouping, setRecognitionTimeGrouping] = useState<RecognitionTimeGrouping>("practice-session");

  const longTermReviews = useMemo(() => filterLongTermReviews(reviews), [reviews]);
  const filteredReviews = useMemo(() => {
    const activeTargetNoteIds = getCurrentTargetNoteIdsForGroups(selectedGroupIds);
    return filterByRange(longTermReviews, range).filter((review) => activeTargetNoteIds.has(review.targetNoteId));
  }, [longTermReviews, range, selectedGroupIds]);
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
  const noteStats = useMemo(() => {
    if (selectedGroupIds.length === 0) {
      return [];
    }
    return buildNoteStats(filteredReviews, selectedGroupIds);
  }, [filteredReviews, selectedGroupIds]);
  const rangeStaffNotes = useMemo(() => {
    const activeGroups = new Set(selectedGroupIds);
    const statsByNoteId = new Map(noteStats.map((stat) => [stat.targetNoteId, stat]));
    return PRACTICE_GROUPS.flatMap((group) => group.notes)
      .filter((note) => activeGroups.has(note.groupId))
      .sort(compareRangeStaffNotes)
      .map((note) => ({ note, stat: statsByNoteId.get(note.id) }));
  }, [noteStats, selectedGroupIds]);
  const errorStaffNotes = useMemo<StaffHeatNote[]>(
    () => rangeStaffNotes.map(({ note, stat }) => ({ note, value: stat?.errorCount ?? 0 })),
    [rangeStaffNotes],
  );
  const timeStaffNotes = useMemo<StaffHeatNote[]>(
    () => rangeStaffNotes.map(({ note, stat }) => ({ note, value: stat?.medianMs })),
    [rangeStaffNotes],
  );

  function toggleGroup(groupId: PracticeGroupId, checked: boolean): void {
    setSelectedGroupIds((current) => {
      const next = checked ? [...current, groupId] : current.filter((id) => id !== groupId);
      const selected = new Set(next);
      return ALL_STATS_GROUP_IDS.filter((id) => selected.has(id));
    });
  }

  return (
    <section className="stats-shell">
      <div className="stats-header">
        <div>
          <h1>统计</h1>
        </div>
        <BarChart3 size={24} />
      </div>

      <div className="panel heatmap-panel stats-heatmap-panel">
        <div className="panel-heading">
          <h2>练习量</h2>
        </div>
        <HeatMap reviews={longTermReviews} />
      </div>

      <div className="stats-main-grid">
        <div className="stats-left-column">
          <div className="stats-filter-row">
            <div className="group-filter stats-group-filter" aria-label="统计分组筛选">
              {PRACTICE_GROUPS.map((group) => {
                const checked = selectedGroupIds.includes(group.id);
                return (
                  <label className={checked ? "choice choice-active" : "choice"} key={group.id}>
                    <input
                      checked={checked}
                      type="checkbox"
                      onChange={(event) => toggleGroup(group.id, event.target.checked)}
                    />
                    <span>{group.label}</span>
                  </label>
                );
              })}
            </div>
          </div>

          <div className="panel chart-panel">
            <div className="panel-heading">
              <h2>识别时长</h2>
              <div className="chart-panel-actions">
                <div className="toolbar stats-range-filter">
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
                <ResponsiveContainer height={280} width="100%">
                  <LineChart data={recognitionTimeStats} margin={{ bottom: 18, left: 2, right: 8, top: 8 }}>
                    <CartesianGrid stroke="#e5dccf" strokeDasharray="3 3" />
                    <XAxis dataKey="label" height={44} interval="preserveStartEnd" minTickGap={16} tick={<RecognitionTimeTick />} />
                    <YAxis tick={{ fill: "#7a6f61", fontSize: 11 }} unit="s" />
                    <Tooltip
                      formatter={(value, name) => [`${value}s`, name]}
                      labelFormatter={(_, payload) => payload?.[0]?.payload?.tooltipLabel ?? ""}
                    />
                    <Line
                      animationDuration={RECOGNITION_CHART_ANIMATION_MS}
                      dataKey="p10"
                      dot={false}
                      name="P10"
                      stroke="#2f7d74"
                      strokeWidth={2}
                      type="monotone"
                    />
                    <Line
                      animationDuration={RECOGNITION_CHART_ANIMATION_MS}
                      dataKey="median"
                      dot={false}
                      name="中位"
                      stroke="#2b2520"
                      strokeWidth={2.5}
                      type="monotone"
                    />
                    <Line
                      animationDuration={RECOGNITION_CHART_ANIMATION_MS}
                      dataKey="p90"
                      dot={false}
                      name="P90"
                      stroke="#c84c3d"
                      strokeWidth={2}
                      type="monotone"
                    />
                  </LineChart>
                </ResponsiveContainer>
              )}
            </div>
          </div>
        </div>

        <aside className="stats-right-column">
          <div className="panel note-heat-panel">
            <div className="panel-heading">
              <h2>音域分布</h2>
            </div>
            <div className="note-heat-stack">
              <div className="note-heat-row">
                <div className="note-heat-row-heading">
                  <h3>错误次数</h3>
                  <div className="range-legend">
                    <span>
                      <i className="legend-swatch legend-neutral" />
                      0
                    </span>
                    <span>
                      <i className="legend-swatch legend-red-light" />
                      较低
                    </span>
                    <span>
                      <i className="legend-swatch legend-red-dark" />
                      较高
                    </span>
                  </div>
                </div>
                <StatsRangeStaff label="错误次数音域分布" notes={errorStaffNotes} tone="red" />
              </div>
              <div className="note-heat-row">
                <div className="note-heat-row-heading">
                  <h3>识别时长</h3>
                  <div className="range-legend">
                    <span>
                      <i className="legend-swatch legend-neutral" />
                      无记录
                    </span>
                    <span>
                      <i className="legend-swatch legend-blue-light" />
                      较短
                    </span>
                    <span>
                      <i className="legend-swatch legend-blue-dark" />
                      较长
                    </span>
                  </div>
                </div>
                <StatsRangeStaff label="识别时长音域分布" notes={timeStaffNotes} tone="blue" />
              </div>
            </div>
          </div>
        </aside>
      </div>
    </section>
  );
}
