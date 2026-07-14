export const STATS_RANGES = ["1", "7", "30", "all"] as const;
export type StatsRange = (typeof STATS_RANGES)[number];

export function getStatsRangeCutoff(range: StatsRange, today = new Date()): Date | undefined {
  if (range === "all") {
    return undefined;
  }
  const cutoff = new Date(today);
  cutoff.setDate(cutoff.getDate() - Number(range) + 1);
  cutoff.setHours(0, 0, 0, 0);
  return cutoff;
}
