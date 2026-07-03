import { BarChart3 } from "lucide-react";
import { useMemo, useState } from "react";
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { getNoteById, PRACTICE_GROUPS } from "../domain/notes";
import { buildDailyStats, buildNoteStats, formatMs } from "../domain/stats";
import type { PracticeGroupId, ReviewRecord } from "../domain/types";
import { StaffPrompt } from "./StaffPrompt";

interface StatsViewProps {
  reviews: ReviewRecord[];
}

type RangeKey = "7" | "30" | "all";

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

function HeatMap({ reviews, includeInterrupted }: { reviews: ReviewRecord[]; includeInterrupted: boolean }): JSX.Element {
  const daily = buildDailyStats(reviews, includeInterrupted);
  const byDate = new Map(daily.map((day) => [day.date, day]));
  const today = new Date();
  const days = Array.from({ length: 84 }, (_, index) => {
    const date = new Date(today);
    date.setDate(today.getDate() - (83 - index));
    const key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
    return { key, stat: byDate.get(key) };
  });

  return (
    <div className="heatmap" aria-label="练习热力图">
      {days.map((day) => (
        <div
          className={`heat-cell heat-${day.stat?.heatLevel ?? 0}`}
          key={day.key}
          title={`${day.key}: ${day.stat?.completedReviews ?? 0}`}
        />
      ))}
    </div>
  );
}

export function StatsView({ reviews }: StatsViewProps): JSX.Element {
  const [range, setRange] = useState<RangeKey>("30");
  const [groupFilter, setGroupFilter] = useState<PracticeGroupId[]>([]);
  const [includeInterrupted, setIncludeInterrupted] = useState(false);

  const filteredReviews = useMemo(() => filterByRange(reviews, range), [range, reviews]);
  const dailyStats = useMemo(
    () =>
      buildDailyStats(filteredReviews, includeInterrupted).map((day) => ({
        ...day,
        p10: day.p10Ms === undefined ? undefined : Number((day.p10Ms / 1000).toFixed(2)),
        median: day.medianMs === undefined ? undefined : Number((day.medianMs / 1000).toFixed(2)),
        p90: day.p90Ms === undefined ? undefined : Number((day.p90Ms / 1000).toFixed(2)),
      })),
    [filteredReviews, includeInterrupted],
  );
  const noteStats = useMemo(
    () => buildNoteStats(filteredReviews, groupFilter, includeInterrupted),
    [filteredReviews, groupFilter, includeInterrupted],
  );
  const weakest = [...noteStats].sort((a, b) => b.weaknessScore - a.weaknessScore).slice(0, 5);
  const strongest = [...noteStats]
    .filter((stat) => stat.reviewCount > 0)
    .sort((a, b) => a.weaknessScore - b.weaknessScore)
    .slice(0, 5);

  return (
    <section className="stats-shell">
      <div className="stats-header">
        <div>
          <h1>统计</h1>
          <p>默认排除中断记录</p>
        </div>
        <BarChart3 size={24} />
      </div>

      <div className="toolbar">
        <div className="segmented">
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
        <label className="switch-line">
          <input
            checked={includeInterrupted}
            type="checkbox"
            onChange={(event) => setIncludeInterrupted(event.target.checked)}
          />
          <span>含中断记录</span>
        </label>
      </div>

      <div className="group-filter">
        {PRACTICE_GROUPS.map((group) => {
          const checked = groupFilter.includes(group.id);
          return (
            <label className={checked ? "choice choice-active" : "choice"} key={group.id}>
              <input
                checked={checked}
                type="checkbox"
                onChange={(event) => {
                  setGroupFilter((current) =>
                    event.target.checked ? [...current, group.id] : current.filter((id) => id !== group.id),
                  );
                }}
              />
              <span>{group.label}</span>
            </label>
          );
        })}
      </div>

      <div className="panel">
        <div className="panel-heading">
          <h2>练习量</h2>
        </div>
        <HeatMap reviews={reviews} includeInterrupted={includeInterrupted} />
      </div>

      <div className="panel chart-panel">
        <div className="panel-heading">
          <h2>识别时长</h2>
        </div>
        <div className="chart-box">
          {dailyStats.length === 0 ? (
            <div className="empty-state">暂无记录</div>
          ) : (
            <ResponsiveContainer height={260} width="100%">
              <LineChart data={dailyStats}>
                <CartesianGrid stroke="#ded6c9" strokeDasharray="3 3" />
                <XAxis dataKey="date" tick={{ fontSize: 11 }} />
                <YAxis tick={{ fontSize: 11 }} unit="s" />
                <Tooltip />
                <Line dataKey="p10" dot={false} name="P10" stroke="#2f7d74" strokeWidth={2} type="monotone" />
                <Line dataKey="median" dot={false} name="中位" stroke="#2e2a24" strokeWidth={2.5} type="monotone" />
                <Line dataKey="p90" dot={false} name="P90" stroke="#c84c3d" strokeWidth={2} type="monotone" />
              </LineChart>
            </ResponsiveContainer>
          )}
        </div>
      </div>

      <div className="rank-grid">
        <div className="panel">
          <div className="panel-heading">
            <h2>最需要练</h2>
          </div>
          <div className="stat-card-list">
            {weakest.map((stat) => (
              <div className="stat-card" key={stat.targetNoteId}>
                <StaffPrompt compact note={getNoteById(stat.targetNoteId)} />
                <div className="stat-card-body">
                  <strong>{stat.targetNoteId}</strong>
                  <span>中位 {formatMs(stat.medianMs)}</span>
                  <span>错误率 {Math.round(stat.errorRate * 100)}%</span>
                  <span>{stat.commonConfusion ? `常错 ${stat.commonConfusion}` : "无混淆"}</span>
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="panel">
          <div className="panel-heading">
            <h2>最稳定</h2>
          </div>
          <div className="stat-card-list">
            {strongest.map((stat) => (
              <div className="stat-card" key={stat.targetNoteId}>
                <StaffPrompt compact note={getNoteById(stat.targetNoteId)} />
                <div className="stat-card-body">
                  <strong>{stat.targetNoteId}</strong>
                  <span>中位 {formatMs(stat.medianMs)}</span>
                  <span>错误率 {Math.round(stat.errorRate * 100)}%</span>
                  <span>记录 {stat.reviewCount}</span>
                </div>
              </div>
            ))}
            {strongest.length === 0 ? <div className="empty-state">暂无记录</div> : null}
          </div>
        </div>
      </div>
    </section>
  );
}
