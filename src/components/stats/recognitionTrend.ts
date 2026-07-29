import { getNotesForGroups, normalizeCurrentPracticeGroupIds } from "../../domain/notes";
import { localDateKey, type RecognitionTrendPoint } from "../../domain/stats";
import { buildTargetNoteSetKey } from "../../domain/targetNoteSet";
import type { PracticeSessionRecord, TargetNote, TargetNoteId } from "../../domain/types";

export const RECOGNITION_TIME_GROUPINGS = ["day", "practice-session"] as const;
export type RecognitionTimeGrouping = (typeof RECOGNITION_TIME_GROUPINGS)[number];
export const RECOGNITION_TIME_METRICS = ["duration", "speed"] as const;
export type RecognitionTimeMetric = (typeof RECOGNITION_TIME_METRICS)[number];
export const RECOGNITION_TIME_VALUE_MODES = ["absolute", "relative"] as const;
export type RecognitionTimeValueMode = (typeof RECOGNITION_TIME_VALUE_MODES)[number];
export const RECOGNITION_SERIES_KEYS = ["p10", "median", "p90", "errorRate"] as const;
export type RecognitionSeriesKey = (typeof RECOGNITION_SERIES_KEYS)[number];

export interface RecognitionTimeRelativeBaseline {
  median?: number;
  p10?: number;
  p90?: number;
}

export interface RecognitionTimeChartStat {
  boundaryLabel?: string;
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
  relativeBaseline?: RecognitionTimeRelativeBaseline;
  transition: boolean;
  transitionKind?: RecognitionTransitionKind;
}

export type RecognitionTransitionKind = "cold-start" | "expansion";

export interface RecognitionRangeTransition {
  baselineNoteIds: TargetNoteId[];
  completedAt?: string;
  fromNoteCount: number;
  kind: RecognitionTransitionKind;
  startedAt: string;
  toNoteCount: number;
}

export interface RecognitionRangeTransitionBaseline {
  transition: RecognitionRangeTransition;
  trend: readonly RecognitionTrendPoint[];
}

export interface RecognitionTrendRelativeBaseline {
  medianMs?: number;
  p10Ms?: number;
  p90Ms?: number;
}

export interface RecognitionTrendPhasePoint extends RecognitionTrendPoint {
  boundaryLabel?: string;
  breakBefore: boolean;
  relativeBaseline?: RecognitionTrendRelativeBaseline;
  transition: boolean;
  transitionKind?: RecognitionTransitionKind;
}

function sessionRangeNoteIds(session: PracticeSessionRecord): TargetNoteId[] {
  if (session.schemaVersion === 3 || session.schemaVersion === 4) {
    const config = session.startSnapshot.practiceConfig;
    return getNotesForGroups(
      normalizeCurrentPracticeGroupIds(config.enabledGroupIds),
      config.includeInterStaffLedgerSpellings ?? false,
      config.staffNotationMode,
    ).map((note) => note.id);
  }
  if (session.schemaVersion === 2) {
    return getNotesForGroups(
      normalizeCurrentPracticeGroupIds(session.enabledGroupIds),
      session.includeInterStaffLedgerSpellings ?? false,
      session.staffNotationMode,
    ).map((note) => note.id);
  }
  return getNotesForGroups(
    normalizeCurrentPracticeGroupIds(session.enabledGroupIds),
    session.includeLedgerVariants ?? false,
    "grand",
  ).map((note) => note.id);
}

interface RecognitionRangeEpisode {
  endedAt?: string;
  key: string;
  noteIds: TargetNoteId[];
  startedAt: string;
}

function buildRecognitionRangeEpisodes(sessions: readonly PracticeSessionRecord[]): RecognitionRangeEpisode[] {
  const ranges = sessions
    .map((session) => {
      const noteIds = sessionRangeNoteIds(session);
      return {
        key: buildTargetNoteSetKey(noteIds),
        noteIds,
        startedAt: session.startedAt,
      };
    })
    .filter((range) => range.noteIds.length > 0)
    .sort((left, right) => new Date(left.startedAt).getTime() - new Date(right.startedAt).getTime());
  const episodes: RecognitionRangeEpisode[] = [];
  for (const range of ranges) {
    const latest = episodes[episodes.length - 1];
    if (latest?.key === range.key) {
      continue;
    }
    if (latest) {
      latest.endedAt = range.startedAt;
    }
    episodes.push({ ...range });
  }
  return episodes;
}

export function findRecognitionRangeTransitions(
  sessions: readonly PracticeSessionRecord[],
  activeNotes: readonly TargetNote[],
  trend: readonly RecognitionTrendPoint[],
): RecognitionRangeTransition[] {
  if (sessions.length === 0 || activeNotes.length === 0 || trend.length === 0) {
    return [];
  }
  const currentNoteIds = activeNotes.map((note) => note.id);
  const currentKey = buildTargetNoteSetKey(currentNoteIds);
  const currentSet = new Set(currentNoteIds);
  const episodes = buildRecognitionRangeEpisodes(sessions);
  const completedRangeKeys = new Set<string>();
  const pendingExpansions = new Set<string>();
  const transitions: RecognitionRangeTransition[] = [];
  let hasCompletedVisibleRange = false;
  for (const [index, episode] of episodes.entries()) {
    const previous = episodes[index - 1];
    const previousSet = new Set(previous?.noteIds ?? []);
    const isExpansion = previous !== undefined &&
      previous.noteIds.every((noteId) => episode.noteIds.includes(noteId)) &&
      episode.noteIds.some((noteId) => !previousSet.has(noteId));
    if (isExpansion && !completedRangeKeys.has(episode.key)) {
      pendingExpansions.add(episode.key);
    }
    const startedAt = new Date(episode.startedAt).getTime();
    const endedAt = episode.endedAt ? new Date(episode.endedAt).getTime() : undefined;
    const startIndex = trend.findIndex((point) => {
      const boundaryAt = new Date(point.boundaryAt).getTime();
      return boundaryAt >= startedAt && (endedAt === undefined || boundaryAt < endedAt);
    });
    if (startIndex < 0) {
      continue;
    }
    const completedPoint = trend.slice(startIndex).find((point) => {
      const boundaryAt = new Date(point.boundaryAt).getTime();
      if (endedAt !== undefined && boundaryAt >= endedAt) {
        return false;
      }
      const covered = new Set(point.coveredNoteIds);
      return episode.noteIds.every((noteId) => covered.has(noteId));
    });
    const isVisible = episode.noteIds.every((noteId) => currentSet.has(noteId));
    const isCurrentEpisode = episode.endedAt === undefined && episode.key === currentKey;
    const rangeAlreadyCompleted = completedRangeKeys.has(episode.key);
    const hasPendingExpansion = pendingExpansions.has(episode.key);
    const coveredBeforeStart = new Set(trend[startIndex - 1]?.coveredNoteIds ?? []);
    const completedBeforeStart = episode.noteIds.every((noteId) => coveredBeforeStart.has(noteId));
    const isColdStart = !hasCompletedVisibleRange && isVisible;
    if (isColdStart && (completedPoint || isCurrentEpisode)) {
      transitions.push({
        baselineNoteIds: [],
        completedAt: completedPoint?.boundaryAt,
        fromNoteCount: 0,
        kind: "cold-start",
        startedAt: trend[0].boundaryAt,
        toNoteCount: completedPoint?.coveredNoteIds.length ?? episode.noteIds.length,
      });
    } else if (hasPendingExpansion && !rangeAlreadyCompleted && !completedBeforeStart) {
      if (isVisible && (completedPoint || isCurrentEpisode)) {
        transitions.push({
          baselineNoteIds: [...coveredBeforeStart],
          completedAt: completedPoint?.boundaryAt,
          fromNoteCount: coveredBeforeStart.size,
          kind: "expansion",
          startedAt: trend[startIndex].boundaryAt,
          toNoteCount: completedPoint?.coveredNoteIds.length ?? episode.noteIds.length,
        });
      }
    }
    if (completedPoint) {
      completedRangeKeys.add(episode.key);
      pendingExpansions.delete(episode.key);
      if (isVisible) {
        hasCompletedVisibleRange = true;
      }
    }
  }
  return transitions;
}

function bucketKey(iso: string, grouping: RecognitionTimeGrouping): string {
  return grouping === "day" ? localDateKey(iso) : iso;
}

function bucketPosition(iso: string, grouping: RecognitionTimeGrouping): number {
  return grouping === "day"
    ? Number(localDateKey(iso).replaceAll("-", ""))
    : new Date(iso).getTime();
}

function copyRecognitionMetrics(
  point: RecognitionTrendPoint,
  source: RecognitionTrendPoint | undefined,
): RecognitionTrendPoint {
  return source
    ? {
        ...point,
        errorRate: source.errorRate,
        medianMs: source.medianMs,
        p10Ms: source.p10Ms,
        p90Ms: source.p90Ms,
      }
    : point;
}

function transitionBucket(
  transition: RecognitionRangeTransition,
  grouping: RecognitionTimeGrouping,
): {
  completedKey?: string;
  completedPosition?: number;
  startKey: string;
  startPosition: number;
} {
  return {
    completedKey: transition.completedAt ? bucketKey(transition.completedAt, grouping) : undefined,
    completedPosition: transition.completedAt ? bucketPosition(transition.completedAt, grouping) : undefined,
    startKey: bucketKey(transition.startedAt, grouping),
    startPosition: bucketPosition(transition.startedAt, grouping),
  };
}

function latestMetricPoint(
  trend: readonly RecognitionTrendPoint[],
  boundaryAt: string,
): RecognitionTrendPoint | undefined {
  const boundaryTime = new Date(boundaryAt).getTime();
  for (let index = trend.length - 1; index >= 0; index -= 1) {
    if (new Date(trend[index].boundaryAt).getTime() <= boundaryTime) {
      return trend[index];
    }
  }
  return undefined;
}

function hasRecognitionTimeMetrics(baseline: RecognitionTrendRelativeBaseline): boolean {
  return baseline.medianMs !== undefined || baseline.p10Ms !== undefined || baseline.p90Ms !== undefined;
}

function fillMissingRecognitionTimeMetrics(
  baseline: RecognitionTrendRelativeBaseline,
  point: RecognitionTrendPoint,
): RecognitionTrendRelativeBaseline {
  return {
    medianMs: baseline.medianMs ?? point.medianMs,
    p10Ms: baseline.p10Ms ?? point.p10Ms,
    p90Ms: baseline.p90Ms ?? point.p90Ms,
  };
}

function latestRecognitionTimeMetricsBefore(
  trend: readonly RecognitionTrendPoint[],
  position: number,
  grouping: RecognitionTimeGrouping,
): RecognitionTrendRelativeBaseline | undefined {
  let baseline: RecognitionTrendRelativeBaseline = {};
  for (let index = trend.length - 1; index >= 0; index -= 1) {
    const point = trend[index];
    if (bucketPosition(point.boundaryAt, grouping) >= position) {
      continue;
    }
    baseline = fillMissingRecognitionTimeMetrics(baseline, point);
    if (baseline.medianMs !== undefined && baseline.p10Ms !== undefined && baseline.p90Ms !== undefined) {
      break;
    }
  }
  return hasRecognitionTimeMetrics(baseline) ? baseline : undefined;
}

export function applyRecognitionRangeTransitions(
  trend: readonly RecognitionTrendPoint[],
  baselines: readonly RecognitionRangeTransitionBaseline[],
  grouping: RecognitionTimeGrouping,
): RecognitionTrendPhasePoint[] {
  const phases = baselines.map(({ transition, trend: baselineTrend }) => {
    const bucket = transitionBucket(transition, grouping);
    return {
      ...bucket,
      baselineTrend,
      preTransitionBaseline: latestRecognitionTimeMetricsBefore(trend, bucket.startPosition, grouping),
      transition,
    };
  });

  return trend.map((point) => {
    const pointKey = bucketKey(point.boundaryAt, grouping);
    const pointPosition = bucketPosition(point.boundaryAt, grouping);
    const starts = phases.filter((phase) => phase.startKey === pointKey);
    const completions = phases.filter((phase) => phase.completedKey === pointKey);
    const activePhase = phases.find((phase) =>
      pointPosition >= phase.startPosition &&
      (phase.completedPosition === undefined || pointPosition < phase.completedPosition));
    const activeStart = starts.find((phase) => phase.completedKey !== pointKey);
    const metricPoint = activePhase
      ? copyRecognitionMetrics(point, latestMetricPoint(activePhase.baselineTrend, point.boundaryAt))
      : point;
    const completedPhase = completions[completions.length - 1];
    return {
      ...metricPoint,
      boundaryLabel: activeStart
        ? activeStart.transition.kind === "cold-start"
          ? `开始积累 0→${activeStart.transition.toNoteCount}`
          : `开始扩展 ${activeStart.transition.fromNoteCount}→${activeStart.transition.toNoteCount}`
        : completions.length > 0
          ? completions.some((phase) => phase.transition.kind === "cold-start")
            ? "初始范围已纳入"
            : "新范围已纳入"
          : undefined,
      breakBefore: starts.length > 0 || completions.length > 0,
      relativeBaseline: completedPhase?.transition.kind === "expansion"
        ? completedPhase.preTransitionBaseline
        : undefined,
      transition: activePhase !== undefined,
      transitionKind: activePhase?.transition.kind,
    };
  });
}
