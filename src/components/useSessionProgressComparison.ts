import { useEffect, useMemo, useState } from "react";

import {
  buildSessionProgressGroupBenchmark,
  buildSessionProgressGroupSeries,
  buildSessionProgressGroups,
  getSessionProgressChartWindowMs,
  type SessionProgressBenchmark,
  type SessionProgressMode,
} from "../domain/sessionProgress";
import {
  createSessionProgressSelection,
  getSelectedSessionProgressGroups,
  getSessionProgressComparisonDimension,
  getSessionProgressGroupDimensionValue,
  getSessionProgressSelectionValues,
  resolveSessionProgressSelection,
  SESSION_PROGRESS_CONDITION_DIMENSIONS,
  type SessionProgressConditionDimension,
  type SessionProgressConditionValue,
  type SessionProgressSelection,
} from "../domain/sessionProgressSelection";
import { buildTargetNoteSetKey } from "../domain/targetNoteSet";
import type {
  EffectiveQueueAlgorithm,
  PracticeSessionRecord,
  PromptNoteDuration,
  ReviewRecord,
  TargetNote,
} from "../domain/types";
import type {
  SessionProgressChartGroup,
  SessionProgressGroupLegendItem,
} from "./SessionProgressChart";

const COMPARISON_COLORS = ["#4477aa", "#ee6677", "#228833", "#aa3377"] as const;

interface ConditionMetadata {
  label: string;
  order: readonly SessionProgressConditionValue[];
  valueLabel: (value: SessionProgressConditionValue, algorithms: EffectiveQueueAlgorithm[]) => string;
}

const CONDITION_METADATA: Record<SessionProgressConditionDimension, ConditionMetadata> = {
  promptDisplayMode: {
    label: "显示模式",
    order: ["single-note", "staff-page"],
    valueLabel: (value) => value === "single-note" ? "单音" : "谱页",
  },
  effectiveQueueAlgorithm: {
    label: "队列算法",
    order: ["adaptive-v1", "focused-v1", "melody-v1", "melody-v2"],
    valueLabel: (value, algorithms) => {
      if (value === "adaptive-v1") {
        return "常规";
      }
      if (value === "focused-v1") {
        return "薄弱项";
      }
      const hasBothMelodyVersions = algorithms.includes("melody-v1") && algorithms.includes("melody-v2");
      if (!hasBothMelodyVersions) {
        return "自动旋律";
      }
      return value === "melody-v1" ? "自动旋律（旧版）" : "自动旋律（当前）";
    },
  },
  promptNoteDuration: {
    label: "音符时值",
    order: ["whole", "quarter", "eighth", "sixteenth"],
    valueLabel: (value) => ({
      whole: "全音符",
      quarter: "四分音符",
      eighth: "八分音符",
      sixteenth: "十六分音符",
    })[value as PromptNoteDuration],
  },
};

export interface SessionProgressConditionOption {
  count: number;
  disabled: boolean;
  label: string;
  value: SessionProgressConditionValue;
}

export interface SessionProgressComparisonModel {
  applyCondition: (
    dimension: SessionProgressConditionDimension,
    value: SessionProgressConditionValue,
    values: SessionProgressConditionValue[],
  ) => void;
  benchmark?: SessionProgressBenchmark;
  chartGroups: SessionProgressChartGroup[];
  chartWindowMs: number;
  conditionOptions: (dimension: SessionProgressConditionDimension) => SessionProgressConditionOption[];
  legendItems: SessionProgressGroupLegendItem[];
  selection: SessionProgressSelection | null;
  selectionAnnouncement: string;
  selectedSessionIds: ReadonlySet<string>;
  setTimeBenchmark: (groupId: string) => void;
  toggleCondition: (dimension: SessionProgressConditionDimension, value: SessionProgressConditionValue) => void;
  transientNotice: string;
}

export function sessionProgressDimensionLabel(dimension: SessionProgressConditionDimension): string {
  return CONDITION_METADATA[dimension].label;
}

function formatProgressValue(metric: "completed-count" | "elapsed-ms", value: number | undefined): string {
  if (value === undefined) {
    return "—";
  }
  if (metric === "completed-count") {
    return `${value}题`;
  }
  const seconds = value / 1000;
  return seconds < 60 ? `${seconds.toFixed(1)}秒` : `${Math.floor(seconds / 60)}分${Math.round(seconds % 60)}秒`;
}

export function useSessionProgressComparison({
  activeNotes,
  historyLimit,
  mode,
  reviews,
  sessions,
}: {
  activeNotes: TargetNote[];
  historyLimit: number;
  mode: SessionProgressMode;
  reviews: ReviewRecord[];
  sessions: PracticeSessionRecord[];
}): SessionProgressComparisonModel {
  const [selection, setSelection] = useState<SessionProgressSelection | null>(null);
  const [selectionAnnouncement, setSelectionAnnouncement] = useState("");
  const [transientNotice, setTransientNotice] = useState("");
  const groups = useMemo(() => buildSessionProgressGroups(sessions, reviews), [reviews, sessions]);
  const targetNoteSetKey = useMemo(
    () => buildTargetNoteSetKey(activeNotes.map((note) => note.id)),
    [activeNotes],
  );
  const targetGroups = useMemo(
    () => groups.filter((group) => group.key.targetNoteSetKey === targetNoteSetKey),
    [groups, targetNoteSetKey],
  );

  useEffect(() => {
    if (targetGroups.length === 0) {
      setSelection(null);
      return;
    }
    setSelection((current) => {
      if (current && targetGroups.some((group) => group.keyString === current.chartBenchmarkGroupKey)) {
        return current;
      }
      return createSessionProgressSelection(targetGroups[0]);
    });
  }, [targetGroups]);

  useEffect(() => {
    if (!transientNotice) {
      return undefined;
    }
    const timeoutId = window.setTimeout(() => setTransientNotice(""), 2800);
    return () => window.clearTimeout(timeoutId);
  }, [transientNotice]);

  const selectedGroups = useMemo(
    () => selection ? getSelectedSessionProgressGroups(targetGroups, selection) : [],
    [selection, targetGroups],
  );
  const timeBenchmarkGroup = selection
    ? selectedGroups.find((group) => group.keyString === selection.chartBenchmarkGroupKey)
    : undefined;
  const timeBenchmarkReviews = timeBenchmarkGroup
    ? reviews.filter((review) => review.sessionId === timeBenchmarkGroup.latestSession.id)
    : [];
  const chartWindowMs = timeBenchmarkGroup
    ? getSessionProgressChartWindowMs(timeBenchmarkGroup.latestSession, timeBenchmarkReviews, mode)
    : 0;
  const comparisonDimension = selection ? getSessionProgressComparisonDimension(selection) : undefined;
  const availableAlgorithms = useMemo(
    () => [...new Set(targetGroups.map((group) => group.key.effectiveQueueAlgorithm))],
    [targetGroups],
  );
  const benchmarks = useMemo(
    () => new Map(selectedGroups.map((group) => [
      group.keyString,
      buildSessionProgressGroupBenchmark({ groupKey: group.key, reviews, sessions }),
    ])),
    [reviews, selectedGroups, sessions],
  );
  const chartGroups = useMemo<SessionProgressChartGroup[]>(() => {
    if (!selection || chartWindowMs <= 0) {
      return [];
    }
    return selectedGroups.map((group) => {
      const metadata = comparisonDimension ? CONDITION_METADATA[comparisonDimension] : undefined;
      const value = comparisonDimension
        ? getSessionProgressGroupDimensionValue(group.key, comparisonDimension)
        : undefined;
      const colorIndex = value === undefined ? -1 : metadata!.order.indexOf(value);
      return {
        color: selectedGroups.length === 1
          ? "#256f67"
          : COMPARISON_COLORS[Math.max(0, colorIndex) % COMPARISON_COLORS.length],
        id: group.keyString,
        label: metadata && value !== undefined ? metadata.valueLabel(value, availableAlgorithms) : "当前条件",
        series: buildSessionProgressGroupSeries({
          bestSessionId: benchmarks.get(group.keyString)?.bestSessionId,
          chartWindowMs,
          groupKey: group.key,
          historyLimit,
          mode,
          reviews,
          sessions,
        }),
      };
    });
  }, [
    availableAlgorithms,
    benchmarks,
    chartWindowMs,
    comparisonDimension,
    historyLimit,
    mode,
    reviews,
    selectedGroups,
    selection,
    sessions,
  ]);
  const benchmark = selectedGroups.length === 1 ? benchmarks.get(selectedGroups[0].keyString) : undefined;

  const conditionOptions = (dimension: SessionProgressConditionDimension): SessionProgressConditionOption[] => {
    if (!selection) {
      return [];
    }
    const metadata = CONDITION_METADATA[dimension];
    const availableValues = new Set<SessionProgressConditionValue>(
      targetGroups.map((group) => getSessionProgressGroupDimensionValue(group.key, dimension)),
    );
    const visibleOrder = dimension === "effectiveQueueAlgorithm"
      ? metadata.order.filter((value) => value !== "melody-v1" || availableValues.has(value))
      : metadata.order;
    return visibleOrder.map((value) => {
      const count = targetGroups
        .filter((group) => {
          if (getSessionProgressGroupDimensionValue(group.key, dimension) !== value) {
            return false;
          }
          return SESSION_PROGRESS_CONDITION_DIMENSIONS
            .filter((otherDimension) => otherDimension !== dimension)
            .every((otherDimension) => getSessionProgressSelectionValues(selection, otherDimension).includes(
              getSessionProgressGroupDimensionValue(group.key, otherDimension),
            ));
        })
        .reduce((total, group) => total + group.sessionCount, 0);
      return {
        count,
        disabled: !availableValues.has(value),
        label: metadata.valueLabel(value, availableAlgorithms),
        value,
      };
    });
  };

  const applyCondition = (
    dimension: SessionProgressConditionDimension,
    value: SessionProgressConditionValue,
    values: SessionProgressConditionValue[],
  ): void => {
    if (!selection) {
      return;
    }
    const previousMultiDimension = getSessionProgressComparisonDimension(selection);
    const result = resolveSessionProgressSelection({
      current: selection,
      dimension,
      groups: targetGroups,
      preferredValue: value,
      values,
    });
    if (result.rejected) {
      setSelectionAnnouncement("所选值之间没有共同的有效条件组合，已保留原选择。");
      return;
    }
    setSelection(result.selection);
    const nextMultiDimension = getSessionProgressComparisonDimension(result.selection);
    if (
      values.length > 1 &&
      previousMultiDimension !== undefined &&
      previousMultiDimension !== dimension &&
      nextMultiDimension === dimension
    ) {
      setTransientNotice(
        `只允许一个维度多选，已将${sessionProgressDimensionLabel(previousMultiDimension)}改为${sessionProgressDimensionLabel(dimension)}。`,
      );
    }
    const automaticallyChanged = result.changedDimensions.filter((changed) => changed !== dimension);
    setSelectionAnnouncement(
      automaticallyChanged.length > 0
        ? `已保留${sessionProgressDimensionLabel(dimension)}选择，并自动调整${automaticallyChanged.map(sessionProgressDimensionLabel).join("、")}。`
        : "已更新答对进度比较条件。",
    );
  };

  const toggleCondition = (
    dimension: SessionProgressConditionDimension,
    value: SessionProgressConditionValue,
  ): void => {
    if (!selection) {
      return;
    }
    const currentValues = getSessionProgressSelectionValues(selection, dimension);
    const selected = currentValues.includes(value);
    if (selected && currentValues.length === 1) {
      setSelectionAnnouncement(`${sessionProgressDimensionLabel(dimension)}至少保留一项。`);
      return;
    }
    applyCondition(
      dimension,
      value,
      selected ? currentValues.filter((candidate) => candidate !== value) : [...currentValues, value],
    );
  };

  const legendItems: SessionProgressGroupLegendItem[] = selectedGroups.map((group) => {
    const chartGroup = chartGroups.find((candidate) => candidate.id === group.keyString);
    const groupBenchmark = benchmarks.get(group.keyString);
    const latest = group.latestSession;
    const recordMetricLabel = latest.mode === "fixed-duration"
      ? `固定${latest.fixedDurationSeconds ?? 0}秒`
      : `固定${latest.fixedCount ?? 0}题`;
    const incompleteLabel = latest.mode === "fixed-duration"
      ? `未覆盖${latest.fixedDurationSeconds ?? 0}秒`
      : `未完成${latest.fixedCount ?? 0}题`;
    return {
      bestLabel: groupBenchmark ? formatProgressValue(groupBenchmark.metric, groupBenchmark.bestValue) : "—",
      color: chartGroup?.color ?? "#256f67",
      id: group.keyString,
      isChartBenchmark: group.keyString === selection?.chartBenchmarkGroupKey,
      label: chartGroup?.label ?? "当前条件",
      recentLabel: groupBenchmark?.currentValue === undefined
        ? incompleteLabel
        : formatProgressValue(groupBenchmark.metric, groupBenchmark.currentValue),
      recordMetricLabel,
    };
  });
  const selectedSessionIds = useMemo(
    () => new Set(selectedGroups.flatMap((group) => group.sessionIds)),
    [selectedGroups],
  );

  return {
    applyCondition,
    benchmark,
    chartGroups,
    chartWindowMs,
    conditionOptions,
    legendItems,
    selection,
    selectionAnnouncement,
    selectedSessionIds,
    setTimeBenchmark: (groupId) => {
      setSelection((current) => current ? { ...current, chartBenchmarkGroupKey: groupId } : current);
      setSelectionAnnouncement("已切换时长基准，组内纪录保持不变。");
    },
    toggleCondition,
    transientNotice,
  };
}
