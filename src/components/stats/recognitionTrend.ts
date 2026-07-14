export const RECOGNITION_TIME_GROUPINGS = ["day", "practice-session"] as const;
export type RecognitionTimeGrouping = (typeof RECOGNITION_TIME_GROUPINGS)[number];
export const RECOGNITION_TIME_METRICS = ["duration", "speed"] as const;
export type RecognitionTimeMetric = (typeof RECOGNITION_TIME_METRICS)[number];
export const RECOGNITION_TIME_VALUE_MODES = ["absolute", "relative"] as const;
export type RecognitionTimeValueMode = (typeof RECOGNITION_TIME_VALUE_MODES)[number];
export const RECOGNITION_SERIES_KEYS = ["p10", "median", "p90", "errorRate"] as const;
export type RecognitionSeriesKey = (typeof RECOGNITION_SERIES_KEYS)[number];

export interface RecognitionTimeChartStat {
  addedNoteLabels: string[];
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
}
