import { useLayoutEffect, useRef, useState, type CSSProperties } from "react";

import type { SessionProgressMode, SessionProgressSeries } from "../domain/sessionProgress";

export const DEFAULT_SESSION_PROGRESS_HISTORY_LIMIT = 10;

const SESSION_PROGRESS_WIDTH = 720;
const DEFAULT_SESSION_PROGRESS_HEIGHT = 260;
const SESSION_PROGRESS_PADDING = { bottom: 38, left: 50, right: 18, top: 18 };

interface SessionProgressControlsProps {
  historyLimit: number;
  mode: SessionProgressMode;
  onHistoryLimitChange: (historyLimit: number) => void;
  onModeChange: (mode: SessionProgressMode) => void;
}

interface SessionProgressChartProps {
  height?: number;
  series: SessionProgressSeries[];
}

type SessionProgressChartStyle = CSSProperties & {
  "--session-progress-chart-height": string;
};

export function normalizeSessionProgressHistoryLimit(value: string): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(1, Math.floor(parsed)) : DEFAULT_SESSION_PROGRESS_HISTORY_LIMIT;
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

export function SessionProgressControls({
  historyLimit,
  mode,
  onHistoryLimitChange,
  onModeChange,
}: SessionProgressControlsProps): JSX.Element {
  return (
    <div className="session-progress-controls">
      <div className="segmented" aria-label="答对进度口径">
        <button className={mode === "actual-order" ? "active" : ""} onClick={() => onModeChange("actual-order")}>
          真实顺序
        </button>
        <button className={mode === "duration-cumsum" ? "active" : ""} onClick={() => onModeChange("duration-cumsum")}>
          排序累加
        </button>
      </div>
      <label className="session-progress-history-limit">
        <span>历史</span>
        <input
          aria-label="历史练习次数"
          min={1}
          step={1}
          type="number"
          value={historyLimit}
          onChange={(event) => onHistoryLimitChange(normalizeSessionProgressHistoryLimit(event.target.value))}
        />
        <span>次</span>
      </label>
    </div>
  );
}

export function SessionProgressChart({
  height = DEFAULT_SESSION_PROGRESS_HEIGHT,
  series,
}: SessionProgressChartProps): JSX.Element {
  const chartWrapRef = useRef<HTMLDivElement | null>(null);
  const [chartWidth, setChartWidth] = useState(SESSION_PROGRESS_WIDTH);
  const allPoints = series.flatMap((line) => line.points);
  const dataMaxElapsedMs = Math.max(...allPoints.map((point) => point.elapsedMs), 0);
  const xMax = Math.max(dataMaxElapsedMs, 1000);
  const maxCompleted = Math.max(...allPoints.map((point) => point.completedReviews), 1);
  const yStep = Math.max(1, Math.ceil(maxCompleted / 4));
  const yMax = Math.max(yStep, Math.ceil(maxCompleted / yStep) * yStep);
  const plotRight = Math.max(SESSION_PROGRESS_PADDING.left + 1, chartWidth - SESSION_PROGRESS_PADDING.right);
  const plotWidth = plotRight - SESSION_PROGRESS_PADDING.left;
  const plotHeight = height - SESSION_PROGRESS_PADDING.top - SESSION_PROGRESS_PADDING.bottom;
  const xTicks = Array.from({ length: 5 }, (_, index) => (xMax * index) / 4);
  const yTicks = Array.from({ length: Math.floor(yMax / yStep) + 1 }, (_, index) => index * yStep);
  const toX = (elapsedMs: number): number =>
    SESSION_PROGRESS_PADDING.left + (Math.min(elapsedMs, xMax) / xMax) * plotWidth;
  const toY = (completedReviews: number): number =>
    SESSION_PROGRESS_PADDING.top + plotHeight - (completedReviews / yMax) * plotHeight;
  const makePath = (points: SessionProgressSeries["points"]): string =>
    points
      .map(
        (point, index) =>
          `${index === 0 ? "M" : "L"} ${toX(point.elapsedMs).toFixed(1)} ${toY(point.completedReviews).toFixed(1)}`,
      )
      .join(" ");

  useLayoutEffect(() => {
    const element = chartWrapRef.current;
    if (!element) {
      return undefined;
    }

    const updateWidth = (): void => {
      const nextWidth = Math.round(element.clientWidth);
      if (nextWidth <= 0) {
        return;
      }
      setChartWidth((currentWidth) => (currentWidth === nextWidth ? currentWidth : nextWidth));
    };

    updateWidth();
    const resizeObserver = new ResizeObserver(updateWidth);
    resizeObserver.observe(element);
    return () => resizeObserver.disconnect();
  }, []);

  const chartStyle = {
    "--session-progress-chart-height": `${height}px`,
  } as SessionProgressChartStyle;

  return (
    <div
      className="session-progress-chart-wrap"
      ref={chartWrapRef}
      style={chartStyle}
    >
      <svg
        aria-label="答对进度图"
        className="session-progress-chart"
        role="img"
        viewBox={`0 0 ${chartWidth} ${height}`}
      >
        {yTicks.map((tick) => (
          <g key={`y-${tick}`}>
            <line
              className="session-progress-grid-line"
              x1={SESSION_PROGRESS_PADDING.left}
              x2={plotRight}
              y1={toY(tick)}
              y2={toY(tick)}
            />
            <text
              className="session-progress-tick"
              textAnchor="end"
              x={SESSION_PROGRESS_PADDING.left - 8}
              y={toY(tick) + 4}
            >
              {tick}
            </text>
          </g>
        ))}
        {xTicks.map((tick) => (
          <g key={`x-${tick}`}>
            <line
              className="session-progress-grid-line"
              x1={toX(tick)}
              x2={toX(tick)}
              y1={SESSION_PROGRESS_PADDING.top}
              y2={height - SESSION_PROGRESS_PADDING.bottom}
            />
            <text
              className="session-progress-tick"
              textAnchor="middle"
              x={toX(tick)}
              y={height - SESSION_PROGRESS_PADDING.bottom + 20}
            >
              {formatElapsedMs(tick)}
            </text>
          </g>
        ))}
        <line
          className="session-progress-axis"
          x1={SESSION_PROGRESS_PADDING.left}
          x2={plotRight}
          y1={height - SESSION_PROGRESS_PADDING.bottom}
          y2={height - SESSION_PROGRESS_PADDING.bottom}
        />
        <line
          className="session-progress-axis"
          x1={SESSION_PROGRESS_PADDING.left}
          x2={SESSION_PROGRESS_PADDING.left}
          y1={SESSION_PROGRESS_PADDING.top}
          y2={height - SESSION_PROGRESS_PADDING.bottom}
        />
        {series.map((line) => {
          const lastPoint = line.points[line.points.length - 1];
          return (
            <g key={line.sessionId}>
              <path
                className={line.isCurrent ? "session-progress-line-current" : "session-progress-line-history"}
                d={makePath(line.points)}
              />
              {line.isCurrent && lastPoint ? (
                <circle
                  className="session-progress-current-point"
                  cx={toX(lastPoint.elapsedMs)}
                  cy={toY(lastPoint.completedReviews)}
                  r={4}
                />
              ) : null}
            </g>
          );
        })}
        <text
          className="session-progress-axis-label"
          textAnchor="middle"
          x={chartWidth / 2}
          y={height - 4}
        >
          局内时间
        </text>
        <text
          className="session-progress-axis-label"
          textAnchor="middle"
          transform={`rotate(-90 14 ${height / 2})`}
          x={14}
          y={height / 2}
        >
          答对题数
        </text>
      </svg>
    </div>
  );
}

export function SessionProgressLegend({ series }: { series: SessionProgressSeries[] }): JSX.Element {
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
        本次
      </span>
    </div>
  );
}
