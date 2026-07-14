import { describe, expect, it } from "vitest";
import { averageDailyPracticeMs } from "./PracticeHeatmap";

describe("practice heatmap", () => {
  it("averages non-zero active days within the selected range", () => {
    const dailyStats = [
      { completedReviews: 1, date: "2026-06-01", heatLevel: 1 as const, totalActiveMs: 60_000 },
      { completedReviews: 1, date: "2026-07-09", heatLevel: 0 as const, totalActiveMs: 0 },
      { completedReviews: 1, date: "2026-07-10", heatLevel: 1 as const, totalActiveMs: 60_000 },
      { completedReviews: 1, date: "2026-07-15", heatLevel: 2 as const, totalActiveMs: 120_000 },
    ];
    const today = new Date(2026, 6, 15, 12);

    expect(averageDailyPracticeMs(dailyStats, "1", today)).toBe(120_000);
    expect(averageDailyPracticeMs(dailyStats, "7", today)).toBe(90_000);
    expect(averageDailyPracticeMs(dailyStats, "30", today)).toBe(90_000);
    expect(averageDailyPracticeMs(dailyStats, "all", today)).toBe(80_000);
  });
});
