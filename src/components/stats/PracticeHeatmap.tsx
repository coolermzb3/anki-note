import { useEffect, useMemo, useRef, useState } from "react";

import type { DailyStat } from "../../domain/stats";
import { STATS_COLORS } from "./statsColors";
import { getStatsRangeCutoff, type StatsRange } from "./statsRange";

const HEATMAP_WEEK_COUNT = 53;
const WEEKDAY_LABELS = ["周一", "", "周三", "", "周五", "", "周日"];

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
  range: StatsRange,
  today = new Date(),
): number {
  const cutoff = getStatsRangeCutoff(range, today);
  const cutoffKey = cutoff ? formatDateKey(cutoff) : undefined;
  const positiveValues = dailyStats
    .filter((day) => cutoffKey === undefined || day.date >= cutoffKey)
    .map((day) => day.totalActiveMs)
    .filter((value) => value > 0);
  return positiveValues.length === 0
    ? 0
    : positiveValues.reduce((total, value) => total + value, 0) / positiveValues.length;
}

function HeatMap({ dailyStats }: { dailyStats: readonly DailyStat[] }): JSX.Element {
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

export function PracticeHeatmap({ dailyStats, range }: { dailyStats: DailyStat[]; range: StatsRange }): JSX.Element {
  const averageDailyActiveMs = useMemo(() => averageDailyPracticeMs(dailyStats, range), [dailyStats, range]);

  return (
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
  );
}
