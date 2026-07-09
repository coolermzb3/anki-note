import { useLayoutEffect, useRef, useState } from "react";
import { totalStaffRecallActiveMs } from "../domain/staffRecall";
import type { StaffRecallRunRecord } from "../domain/types";

interface StaffRecallTrendChartProps {
  currentRunId: string;
  runs: StaffRecallRunRecord[];
}

const CHART_WIDTH = 720;
const CHART_HEIGHT = 144;
const PADDING = { bottom: 26, left: 42, right: 14, top: 14 };

function formatSeconds(ms: number): string {
  return `${(ms / 1000).toFixed(1)}s`;
}

export function StaffRecallTrendChart({ currentRunId, runs }: StaffRecallTrendChartProps): JSX.Element {
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const [width, setWidth] = useState(CHART_WIDTH);

  useLayoutEffect(() => {
    const element = wrapRef.current;
    if (!element) {
      return undefined;
    }
    const updateWidth = (): void => {
      const nextWidth = Math.round(element.clientWidth);
      if (nextWidth > 0) {
        setWidth(nextWidth);
      }
    };
    updateWidth();
    const observer = new ResizeObserver(updateWidth);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  const points = runs.map((run) => ({ id: run.id, totalMs: totalStaffRecallActiveMs(run) }));
  const values = points.map((point) => point.totalMs);
  const rawMin = Math.min(...values);
  const rawMax = Math.max(...values);
  const paddingMs = Math.max(250, (rawMax - rawMin) * 0.12);
  const minMs = Math.max(0, rawMin - paddingMs);
  const maxMs = Math.max(minMs + 500, rawMax + paddingMs);
  const plotWidth = Math.max(1, width - PADDING.left - PADDING.right);
  const plotHeight = CHART_HEIGHT - PADDING.top - PADDING.bottom;
  const toX = (index: number): number =>
    PADDING.left + (points.length <= 1 ? plotWidth / 2 : (index / (points.length - 1)) * plotWidth);
  const toY = (value: number): number =>
    PADDING.top + ((maxMs - value) / (maxMs - minMs)) * plotHeight;
  const path = points.map((point, index) => `${index === 0 ? "M" : "L"} ${toX(index)} ${toY(point.totalMs)}`).join(" ");

  return (
    <div className="staff-recall-trend-wrap" ref={wrapRef}>
      <svg
        aria-label={`最近 ${runs.length} 次默写总时间趋势`}
        className="staff-recall-trend-chart"
        role="img"
        viewBox={`0 0 ${width} ${CHART_HEIGHT}`}
      >
        <line
          className="staff-recall-trend-grid"
          x1={PADDING.left}
          x2={width - PADDING.right}
          y1={PADDING.top}
          y2={PADDING.top}
        />
        <line
          className="staff-recall-trend-grid"
          x1={PADDING.left}
          x2={width - PADDING.right}
          y1={PADDING.top + plotHeight}
          y2={PADDING.top + plotHeight}
        />
        <text className="staff-recall-trend-tick" textAnchor="end" x={PADDING.left - 7} y={PADDING.top + 4}>
          {formatSeconds(maxMs)}
        </text>
        <text
          className="staff-recall-trend-tick"
          textAnchor="end"
          x={PADDING.left - 7}
          y={PADDING.top + plotHeight + 4}
        >
          {formatSeconds(minMs)}
        </text>
        <path className="staff-recall-trend-line" d={path} />
        {points.map((point, index) => (
          <circle
            className={point.id === currentRunId ? "staff-recall-trend-point current" : "staff-recall-trend-point"}
            cx={toX(index)}
            cy={toY(point.totalMs)}
            key={point.id}
            r={point.id === currentRunId ? 4.5 : 3.2}
          />
        ))}
      </svg>
    </div>
  );
}
