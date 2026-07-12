import { useEffect, useState } from "react";

import type { SessionProgressMode } from "../domain/sessionProgress";
import {
  getSessionProgressSelectionValues,
  SESSION_PROGRESS_CONDITION_DIMENSIONS,
  type SessionProgressConditionDimension,
  type SessionProgressConditionValue,
} from "../domain/sessionProgressSelection";
import {
  SessionProgressChart,
  SessionProgressControls,
  SessionProgressGroupLegend,
  SessionProgressLegend,
} from "./SessionProgressChart";
import {
  sessionProgressDimensionLabel,
  type SessionProgressComparisonModel,
  type SessionProgressConditionOption,
} from "./useSessionProgressComparison";

function SessionProgressConditionSelector({
  dimension,
  isOpen,
  onOpenChange,
  onSelectOnly,
  onToggle,
  options,
  selectedValues,
}: {
  dimension: SessionProgressConditionDimension;
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  onSelectOnly: (value: SessionProgressConditionValue) => void;
  onToggle: (value: SessionProgressConditionValue) => void;
  options: SessionProgressConditionOption[];
  selectedValues: SessionProgressConditionValue[];
}): JSX.Element {
  const selectedLabels = options
    .filter((option) => selectedValues.includes(option.value))
    .map((option) => option.label)
    .join("、");
  const isMultiple = selectedValues.length > 1;
  return (
    <div className="session-progress-condition-selector">
      <button
        aria-expanded={isOpen}
        className="session-progress-condition-trigger"
        onClick={() => onOpenChange(!isOpen)}
        type="button"
      >
        <span>{sessionProgressDimensionLabel(dimension)}</span>
        <strong className={isMultiple ? "session-progress-condition-multiple" : undefined}>
          {isMultiple ? "已多选" : selectedLabels}
        </strong>
      </button>
      {isOpen ? (
        <div className="session-progress-condition-menu">
          {options.map((option) => (
            <div className="session-progress-condition-option" key={option.value}>
              <label aria-label={`${selectedValues.includes(option.value) ? "移除" : "加入"}${option.label}对比`}>
                <input
                  checked={selectedValues.includes(option.value)}
                  disabled={option.disabled}
                  onChange={() => onToggle(option.value)}
                  type="checkbox"
                />
              </label>
              <button
                className="session-progress-condition-single"
                disabled={option.disabled}
                onClick={() => {
                  onSelectOnly(option.value);
                  onOpenChange(false);
                }}
                type="button"
              >
                <span>{option.label}</span>
                <small>{option.count}</small>
              </button>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}

export function SessionProgressCard({
  historyLimit,
  mode,
  model,
  onHistoryLimitChange,
  onModeChange,
}: {
  historyLimit: number;
  mode: SessionProgressMode;
  model: SessionProgressComparisonModel;
  onHistoryLimitChange: (historyLimit: number) => void;
  onModeChange: (mode: SessionProgressMode) => void;
}): JSX.Element {
  const [openSelector, setOpenSelector] = useState<SessionProgressConditionDimension | null>(null);

  useEffect(() => {
    if (!openSelector) {
      return undefined;
    }
    const closeOnOutsidePointer = (event: PointerEvent): void => {
      if (!(event.target instanceof Element) || !event.target.closest(".session-progress-condition-selector")) {
        setOpenSelector(null);
      }
    };
    const closeOnEscape = (event: KeyboardEvent): void => {
      if (event.key === "Escape") {
        setOpenSelector(null);
      }
    };
    document.addEventListener("pointerdown", closeOnOutsidePointer);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", closeOnOutsidePointer);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [openSelector]);

  useEffect(() => {
    if (!model.selection) {
      setOpenSelector(null);
    }
  }, [model.selection]);

  const hasSeries = model.chartGroups.length > 0 && model.chartGroups.some((group) => group.series.length > 0);
  return (
    <div className="panel chart-panel stats-carousel-card">
      <div className="panel-heading">
        <h2>答对进度</h2>
        <div className="chart-panel-actions">
          <SessionProgressControls
            benchmark={model.benchmark}
            currentLabel="最近"
            historyLeadingLabel="每组最近"
            historyLimit={historyLimit}
            historyTrailingLabel="条"
            mode={mode}
            onHistoryLimitChange={onHistoryLimitChange}
            onModeChange={onModeChange}
          />
        </div>
      </div>
      {model.selection ? (
        <div className="session-progress-condition-bar">
          {SESSION_PROGRESS_CONDITION_DIMENSIONS.map((dimension) => (
            <SessionProgressConditionSelector
              dimension={dimension}
              isOpen={openSelector === dimension}
              key={dimension}
              onOpenChange={(open) => setOpenSelector(open ? dimension : null)}
              onSelectOnly={(value) => model.applyCondition(dimension, value, [value])}
              onToggle={(value) => model.toggleCondition(dimension, value)}
              options={model.conditionOptions(dimension)}
              selectedValues={getSessionProgressSelectionValues(model.selection!, dimension)}
            />
          ))}
          {model.transientNotice ? (
            <span className="session-progress-transient-notice" role="status">
              {model.transientNotice}
            </span>
          ) : null}
          <span className="sr-only" aria-live="polite">{model.selectionAnnouncement}</span>
        </div>
      ) : null}
      <div className="chart-box">
        {!hasSeries ? (
          <div className="empty-state">暂无记录</div>
        ) : (
          <SessionProgressChart
            chartWindowMs={model.chartWindowMs}
            groups={model.chartGroups}
            height={330}
            overlay={
              model.chartGroups.length > 1 ? (
                <SessionProgressGroupLegend
                  groups={model.legendItems}
                  onChartBenchmarkChange={model.setTimeBenchmark}
                />
              ) : (
                <SessionProgressLegend currentLabel="最近" series={model.chartGroups[0].series} />
              )
            }
            series={[]}
          />
        )}
      </div>
    </div>
  );
}
