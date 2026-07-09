export const DEFAULT_HISTORY_LIMIT = 10;

interface HistoryLimitControlProps {
  ariaLabel: string;
  historyLimit: number;
  onHistoryLimitChange: (historyLimit: number) => void;
}

export function normalizeHistoryLimit(value: string): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(1, Math.floor(parsed)) : DEFAULT_HISTORY_LIMIT;
}

export function HistoryLimitControl({
  ariaLabel,
  historyLimit,
  onHistoryLimitChange,
}: HistoryLimitControlProps): JSX.Element {
  return (
    <label className="session-progress-history-limit">
      <span>历史</span>
      <input
        aria-label={ariaLabel}
        min={1}
        step={1}
        type="number"
        value={historyLimit}
        onChange={(event) => onHistoryLimitChange(normalizeHistoryLimit(event.target.value))}
      />
      <span>次</span>
    </label>
  );
}
