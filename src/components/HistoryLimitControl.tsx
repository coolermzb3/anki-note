export const DEFAULT_HISTORY_LIMIT = 10;

interface HistoryLimitControlProps {
  allHistory: boolean;
  allHistoryCount: number;
  ariaLabel: string;
  historyLimit: number;
  leadingLabel?: string;
  onAllHistoryChange: (allHistory: boolean) => void;
  onHistoryLimitChange: (historyLimit: number) => void;
  trailingLabel?: string;
}

export function normalizeHistoryLimit(value: string): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(1, Math.floor(parsed)) : DEFAULT_HISTORY_LIMIT;
}

export function resolveHistoryLimit(historyLimit: number, allHistory: boolean, availableCount: number): number {
  return allHistory ? availableCount : historyLimit;
}

export function HistoryLimitControl({
  allHistory,
  allHistoryCount,
  ariaLabel,
  historyLimit,
  leadingLabel = "历史",
  onAllHistoryChange,
  onHistoryLimitChange,
  trailingLabel = "次",
}: HistoryLimitControlProps): JSX.Element {
  return (
    <div className="session-progress-history-limit">
      <span>{leadingLabel}</span>
      <input
        aria-label={ariaLabel}
        disabled={allHistory}
        min={1}
        step={1}
        type="number"
        value={allHistory ? allHistoryCount : historyLimit}
        onChange={(event) => onHistoryLimitChange(normalizeHistoryLimit(event.target.value))}
      />
      <span>{trailingLabel}</span>
      <label className="session-progress-history-all">
        <input
          aria-label={`${ariaLabel}全部`}
          checked={allHistory}
          type="checkbox"
          onChange={(event) => onAllHistoryChange(event.target.checked)}
        />
        <span>全部</span>
      </label>
    </div>
  );
}
