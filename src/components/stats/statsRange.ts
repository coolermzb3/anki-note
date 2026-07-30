export const STATS_RANGE_PRESETS = [1, 7, 30] as const;
export type StatsRange = number | "all";

export function parseStatsRangeDays(value: unknown): number | undefined {
  const normalized = typeof value === "string" && /^\d+$/.test(value.trim())
    ? Number(value)
    : value;
  return typeof normalized === "number" && Number.isInteger(normalized) && normalized > 0
    ? normalized
    : undefined;
}

export function parseStatsRange(value: unknown, fallback: StatsRange): StatsRange {
  return value === "all" ? value : parseStatsRangeDays(value) ?? fallback;
}

export function getStatsRangeCutoff(range: StatsRange, today = new Date()): Date | undefined {
  if (range === "all") {
    return undefined;
  }
  const cutoff = new Date(today);
  cutoff.setDate(cutoff.getDate() - range + 1);
  cutoff.setHours(0, 0, 0, 0);
  return cutoff;
}
