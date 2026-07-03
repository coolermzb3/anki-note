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
import { getNoteById, PRACTICE_GROUPS_LOW_TO_HIGH } from "../domain/notes";
import { buildDailyStats, buildNoteStats, buildPracticeSessionStats, formatMs, isQualifiedReview } from "../domain/stats";
import type { PracticeGroupId, PracticeSessionRecord, ReviewRecord } from "../domain/types";
import { StaffPrompt } from "./StaffPrompt";

interface StatsViewProps {
  reviews: ReviewRecord[];
  sessions?: PracticeSessionRecord[];
}

type RangeKey = "7" | "30" | "all";
type RecognitionTimeGrouping = "day" | "practice-session";

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

export function StatsView({ reviews, sessions = EMPTY_SESSIONS }: StatsViewProps): JSX.Element {
  const [range, setRange] = useState<RangeKey>("30");
  const [groupFilter, setGroupFilter] = useState<PracticeGroupId[]>([]);
  const [includeInterrupted, setIncludeInterrupted] = useState(false);
  const [recognitionTimeGrouping, setRecognitionTimeGrouping] = useState<RecognitionTimeGrouping>("practice-session");
  const [chartGroupFilter, setChartGroupFilter] = useState<PracticeGroupId[] | null>(null);

  const filteredReviews = useMemo(() => filterByRange(reviews, range), [range, reviews]);
  const chartGroupIdsWithData = useMemo(() => {
    const groupIds = new Set<PracticeGroupId>();
    for (const review of filteredReviews) {
      if (isQualifiedReview(review, includeInterrupted)) {
        groupIds.add(review.groupId);
      }
    }
    return PRACTICE_GROUPS_LOW_TO_HIGH.map((group) => group.id).filter((groupId) => groupIds.has(groupId));
  }, [filteredReviews, includeInterrupted]);
  const activeChartGroupIds = chartGroupFilter ?? chartGroupIdsWithData;
  const chartFilteredReviews = useMemo(() => {
    const activeGroups = new Set(activeChartGroupIds);
    return filteredReviews.filter((review) => activeGroups.has(review.groupId));
  }, [activeChartGroupIds, filteredReviews]);
  const recognitionTimeStats = useMemo(() => {
    const source =
      recognitionTimeGrouping === "day"
        ? buildDailyStats(chartFilteredReviews, includeInterrupted).map((day) => ({
            key: day.date,
            label: formatShortDate(day.date),
            tooltipLabel: formatShortDate(day.date),
            completedReviews: day.completedReviews,
            p10Ms: day.p10Ms,
            medianMs: day.medianMs,
            p90Ms: day.p90Ms,
          }))
        : buildPracticeSessionStats(chartFilteredReviews, sessions, includeInterrupted).map((session) => {
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
  }, [chartFilteredReviews, includeInterrupted, recognitionTimeGrouping, sessions]);
  const noteStats = useMemo(
    () => buildNoteStats(filteredReviews, groupFilter, includeInterrupted),
    [filteredReviews, groupFilter, includeInterrupted],
  );
  const weakest = [...noteStats]
    .filter((stat) => stat.reviewCount > 0)
    .sort((a, b) => b.weaknessScore - a.weaknessScore)
    .slice(0, 5);
  const strongest = [...noteStats]
    .filter((stat) => stat.reviewCount > 0)
    .sort((a, b) => a.weaknessScore - b.weaknessScore)
    .slice(0, 5);

  function toggleChartGroup(groupId: PracticeGroupId): void {
    setChartGroupFilter((current) => {
      const base = current ?? chartGroupIdsWithData;
      return base.includes(groupId) ? base.filter((id) => id !== groupId) : [...base, groupId];
    });
  }

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
        {PRACTICE_GROUPS_LOW_TO_HIGH.map((group) => {
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

      <div className="stats-main-grid">
        <div className="stats-left-column">
          <div className="panel heatmap-panel">
            <div className="panel-heading">
              <h2>练习量</h2>
            </div>
            <HeatMap reviews={reviews} includeInterrupted={includeInterrupted} />
          </div>

          <div className="panel chart-panel">
            <div className="panel-heading">
              <h2>识别时长</h2>
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
            <div className="chart-group-filter" aria-label="识别时长组筛选">
              {PRACTICE_GROUPS_LOW_TO_HIGH.map((group) => {
                const active = activeChartGroupIds.includes(group.id);
                const hasData = chartGroupIdsWithData.includes(group.id);
                return (
                  <button
                    className={[
                      active ? "active" : "",
                      hasData ? "" : "group-empty",
                    ]
                      .filter(Boolean)
                      .join(" ")}
                    key={group.id}
                    title={hasData ? group.label : `${group.label} 暂无数据`}
                    onClick={() => toggleChartGroup(group.id)}
                  >
                    {group.label}
                  </button>
                );
              })}
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
                    <Line dataKey="p10" dot={false} name="P10" stroke="#2f7d74" strokeWidth={2} type="monotone" />
                    <Line dataKey="median" dot={false} name="中位" stroke="#2b2520" strokeWidth={2.5} type="monotone" />
                    <Line dataKey="p90" dot={false} name="P90" stroke="#c84c3d" strokeWidth={2} type="monotone" />
                  </LineChart>
                </ResponsiveContainer>
              )}
            </div>
          </div>
        </div>

        <aside className="stats-right-column">
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
                {weakest.length === 0 ? <div className="empty-state">暂无记录</div> : null}
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
        </aside>
      </div>
    </section>
  );
}
