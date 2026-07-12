export const DEFAULT_HISTORY_LIMIT = 10;

interface HistoryLimitControlProps {
  ariaLabel: string;
  historyLimit: number;
  leadingLabel?: string;
  onHistoryLimitChange: (historyLimit: number) => void;
  trailingLabel?: string;
}

export function normalizeHistoryLimit(value: string): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(1, Math.floor(parsed)) : DEFAULT_HISTORY_LIMIT;
}

export function HistoryLimitControl({
  ariaLabel,
  historyLimit,
  leadingLabel = "历史",
  onHistoryLimitChange,
  trailingLabel = "次",
}: HistoryLimitControlProps): JSX.Element {
  return (
    <label className="session-progress-history-limit">
      <span>{leadingLabel}</span>
      <input
        aria-label={ariaLabel}
        min={1}
        step={1}
        type="number"
        value={historyLimit}
        onChange={(event) => onHistoryLimitChange(normalizeHistoryLimit(event.target.value))}
      />
      <span>{trailingLabel}</span>
    </label>
  );
}
