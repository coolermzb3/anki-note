import * as echarts from "echarts";
import type { EChartsOption } from "echarts";
import { useEffect, useLayoutEffect, useMemo, useRef, type ReactNode } from "react";

import type {
  SessionProgressBenchmark,
  SessionProgressMode,
  SessionProgressSeries,
} from "../domain/sessionProgress";
import {
  DEFAULT_HISTORY_LIMIT,
  HistoryLimitControl,
  normalizeHistoryLimit,
} from "./HistoryLimitControl";

export const DEFAULT_SESSION_PROGRESS_HISTORY_LIMIT = DEFAULT_HISTORY_LIMIT;

const DEFAULT_SESSION_PROGRESS_HEIGHT = 260;

interface SessionProgressControlsProps {
  benchmark?: SessionProgressBenchmark;
  currentLabel?: string;
  historyLeadingLabel?: string;
  historyLimit: number;
  historyTrailingLabel?: string;
  mode: SessionProgressMode;
  onHistoryLimitChange: (historyLimit: number) => void;
  onModeChange: (mode: SessionProgressMode) => void;
}

interface SessionProgressChartProps {
  chartWindowMs?: number;
  groups?: SessionProgressChartGroup[];
  height?: number;
  overlay?: ReactNode;
  series: SessionProgressSeries[];
}

export interface SessionProgressChartGroup {
  color: string;
  id: string;
  label: string;
  series: SessionProgressSeries[];
}

export interface SessionProgressGroupLegendItem {
  bestLabel: string;
  color: string;
  id: string;
  isChartBenchmark: boolean;
  label: string;
  recentLabel: string;
  recordMetricLabel: string;
}

export function normalizeSessionProgressHistoryLimit(value: string): number {
  return normalizeHistoryLimit(value);
}

function formatElapsedMs(ms: number): string {
  const totalSeconds = Math.max(0, Math.round(ms / 1000));
  if (totalSeconds < 60) {
    return `${totalSeconds}s`;
  }
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

function formatBenchmarkValue(benchmark: SessionProgressBenchmark, value: number | undefined): string {
  if (value === undefined) {
    return "-";
  }
  return benchmark.metric === "completed-count" ? `${value}题` : `${(value / 1000).toFixed(1)}s`;
}

export function SessionProgressControls({
  benchmark,
  currentLabel = "本次",
  historyLeadingLabel,
  historyLimit,
  historyTrailingLabel,
  mode,
  onHistoryLimitChange,
  onModeChange,
}: SessionProgressControlsProps): JSX.Element {
  return (
    <div className="session-progress-controls">
      {benchmark ? (
        <div className="session-progress-benchmark">
          <span>
            {currentLabel} <strong>{formatBenchmarkValue(benchmark, benchmark.currentValue)}</strong>
          </span>
          <span>
            最佳{" "}
            <strong className={benchmark.isNewBest ? "new-best" : undefined}>
              {formatBenchmarkValue(benchmark, benchmark.bestValue)}
            </strong>
          </span>
          {benchmark.isNewBest ? <small className="new-record-label">新纪录！</small> : null}
        </div>
      ) : null}
      <div className="segmented" aria-label="答对进度口径">
        <button className={mode === "actual-order" ? "active" : ""} onClick={() => onModeChange("actual-order")}>
          真实顺序
        </button>
        <button className={mode === "duration-cumsum" ? "active" : ""} onClick={() => onModeChange("duration-cumsum")}>
          排序累加
        </button>
      </div>
      <HistoryLimitControl
        ariaLabel="答对进度曲线数量"
        historyLimit={historyLimit}
        leadingLabel={historyLeadingLabel}
        onHistoryLimitChange={onHistoryLimitChange}
        trailingLabel={historyTrailingLabel}
      />
    </div>
  );
}

export function SessionProgressChart({
  chartWindowMs,
  groups,
  height = DEFAULT_SESSION_PROGRESS_HEIGHT,
  overlay,
  series,
}: SessionProgressChartProps): JSX.Element {
  const chartElementRef = useRef<HTMLDivElement | null>(null);
  const chartInstanceRef = useRef<echarts.ECharts | null>(null);
  const chartGroups = useMemo<SessionProgressChartGroup[]>(
    () => groups ?? [{ color: "#256f67", id: "single", label: "答对进度", series }],
    [groups, series],
  );
  const allSeries = chartGroups.flatMap((group) => group.series);
  const allPoints = allSeries.flatMap((line) => line.points);
  const dataMaxElapsedMs = Math.max(...allPoints.map((point) => point.elapsedMs), 0);
  const currentDurationMs = allSeries.find((line) => line.isCurrent)?.durationMs;
  const xMax = Math.max(chartWindowMs ?? currentDurationMs ?? dataMaxElapsedMs, 1000);
  const prefersReducedMotion =
    typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const option = useMemo<EChartsOption>(
    () => ({
      animation: !prefersReducedMotion,
      animationDuration: 240,
      animationDurationUpdate: 180,
      animationEasing: "cubicOut",
      animationEasingUpdate: "cubicOut",
      aria: { enabled: true, label: { description: "答对题数随局内时间变化的曲线图" } },
      grid: { bottom: 42, left: 54, right: 18, top: 18 },
      legend: { show: false },
      series: chartGroups.flatMap((group) =>
        group.series.map((line) => ({
          data: line.points.map((point) => [point.elapsedMs, point.completedReviews]),
          emphasis: { lineStyle: { opacity: 1, width: 3 } },
          lineStyle: {
            color: group.color,
            opacity: line.isCurrent ? 1 : 0.2,
            width: line.isCurrent ? 2.6 : 1.6,
          },
          name: `${group.label} · ${new Date(line.startedAt).toLocaleString()}`,
          showSymbol: false,
          silent: false,
          type: "line",
        })),
      ),
      tooltip: {
        trigger: "item",
        valueFormatter: (value) => (typeof value === "number" ? String(value) : String(value ?? "")),
      },
      xAxis: {
        axisLabel: { color: "#766b5f", formatter: (value: number) => formatElapsedMs(value) },
        axisLine: { lineStyle: { color: "#bcae9a" } },
        max: xMax,
        min: 0,
        name: "局内时间",
        nameLocation: "middle",
        nameTextStyle: { color: "#766b5f", padding: 28 },
        splitLine: { lineStyle: { color: "#e5dccf" }, show: true },
        type: "value",
      },
      yAxis: {
        axisLabel: { color: "#766b5f" },
        axisLine: { lineStyle: { color: "#bcae9a" }, show: true },
        min: 0,
        minInterval: 1,
        name: "答对题数",
        nameLocation: "middle",
        nameTextStyle: { color: "#766b5f", padding: 36 },
        splitLine: { lineStyle: { color: "#e5dccf" } },
        type: "value",
      },
    }),
    [chartGroups, prefersReducedMotion, xMax],
  );

  useLayoutEffect(() => {
    const element = chartElementRef.current;
    if (!element) {
      return undefined;
    }
    const chart = echarts.init(element, undefined, { renderer: "canvas" });
    chartInstanceRef.current = chart;
    const resizeObserver = new ResizeObserver(() => chart.resize());
    resizeObserver.observe(element);
    return () => {
      resizeObserver.disconnect();
      chart.dispose();
      chartInstanceRef.current = null;
    };
  }, []);

  useEffect(() => {
    chartInstanceRef.current?.setOption(option, true);
  }, [option]);

  return (
    <div className="session-progress-chart-wrap">
      {overlay ? <div className="session-progress-chart-overlay">{overlay}</div> : null}
      <div aria-label="答对进度图" className="session-progress-chart" ref={chartElementRef} role="img" style={{ height }} />
    </div>
  );
}

export function SessionProgressGroupLegend({
  groups,
  onChartBenchmarkChange,
}: {
  groups: SessionProgressGroupLegendItem[];
  onChartBenchmarkChange: (groupId: string) => void;
}): JSX.Element {
  return (
    <div aria-label="时长基准" className="session-progress-group-legend" role="radiogroup">
      {groups.map((group) => (
        <button
          aria-checked={group.isChartBenchmark}
          aria-label={`将${group.label}设为时长基准`}
          className="session-progress-group-row"
          key={group.id}
          onClick={() => onChartBenchmarkChange(group.id)}
          role="radio"
          type="button"
        >
          <span aria-hidden="true" className="session-progress-group-radio" />
          <i aria-hidden="true" style={{ background: group.color }} />
          <span className="session-progress-group-name">{group.label}</span>
          <em
            aria-hidden={group.isChartBenchmark ? undefined : true}
            className={group.isChartBenchmark ? undefined : "session-progress-group-benchmark-placeholder"}
          >
            时长基准
          </em>
          <small>{group.recordMetricLabel}</small>
          <span>最近 {group.recentLabel}</span>
          <span>最佳 {group.bestLabel}</span>
        </button>
      ))}
    </div>
  );
}

export function SessionProgressLegend({
  currentLabel = "本次",
  series,
}: {
  currentLabel?: string;
  series: SessionProgressSeries[];
}): JSX.Element {
  return (
    <div className="session-progress-legend">
      {series.some((line) => !line.isCurrent) ? (
        <span>
          <i className="session-progress-legend-history" />
          过去
        </span>
      ) : null}
      <span>
        <i className="session-progress-legend-current" />
        {currentLabel}
      </span>
    </div>
  );
}
