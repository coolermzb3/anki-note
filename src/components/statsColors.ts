import type { HeatLevel, PositiveHeatLevel } from "../domain/stats";

export type StatsRangeTone = "blue" | "red";

const HEATMAP_COLORS = {
  0: "#efe7dc",
  // 1: "#94c9b7",
  // 2: "#4f9e88",
  // 3: "#256f67",
  1: "#9be9a8",
  2: "#45c668",
  3: "#258544",
} satisfies Record<HeatLevel, string>;

const RANGE_TONE_COLORS = {
  blue: {
    1: "#26ad75",
    // 2: "#4f99ce",
    2: "#cdc611",
    3: "#ad3226",
  },
  red: {
    1: "#e7aaa2",
    2: "#d86f63",
    3: "#ad3226",
  },
} satisfies Record<StatsRangeTone, Record<PositiveHeatLevel, string>>;

export const STATS_COLORS = {
  heatmap: HEATMAP_COLORS,
  range: {
    neutral: "#211c18",
    muted: "#766b5f",
    tone: RANGE_TONE_COLORS,
    transparentNote: "rgba(0, 0, 0, 0)",
  },
  recognitionChart: {
    p10: "#2f7d74",
    median: "#2b2520",
    p90: "#c84c3d",
    errorRate: "#6f5bb5",
    grid: "#e5dccf",
    muted: "#7a6f61",
    panel: "#fffaf2",
    rangeFill: "rgba(47, 125, 116, 0.14)",
    rangeMoveHandle: "rgba(47, 125, 116, 0.45)",
    rangePreview: "#efe7dc",
    rangePreviewLine: "#cdbca8",
    selectedRangePreview: "rgba(47, 125, 116, 0.08)",
    sliderBackground: "rgba(255, 250, 242, 0.92)",
    sliderBorder: "#dfd3c4",
  },
} as const;
