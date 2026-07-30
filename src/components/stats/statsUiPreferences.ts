import {
  RECOGNITION_RELATIVE_BASELINE_MODES,
  RECOGNITION_SERIES_KEYS,
  RECOGNITION_TIME_GROUPINGS,
  RECOGNITION_TIME_METRICS,
  RECOGNITION_TIME_VALUE_MODES,
  type RecognitionRelativeBaselineMode,
  type RecognitionSeriesKey,
  type RecognitionTimeGrouping,
  type RecognitionTimeMetric,
  type RecognitionTimeValueMode,
} from "./recognitionTrend";
import { parseStatsRange, parseStatsRangeDays, type StatsRange } from "./statsRange";

export const STATS_CAROUSEL_CARD_IDS = ["recognition-time", "session-progress", "note-range"] as const;
export type StatsCarouselCardId = (typeof STATS_CAROUSEL_CARD_IDS)[number];

export interface StatsUiPreferences {
  carouselCardId: StatsCarouselCardId;
  customRangeDays: number;
  hiddenRecognitionSeries: RecognitionSeriesKey[];
  range: StatsRange;
  recognitionTimeGrouping: RecognitionTimeGrouping;
  recognitionTimeMetric: RecognitionTimeMetric;
  recognitionTimeRelativeBaselineMode: RecognitionRelativeBaselineMode;
  recognitionTimeValueMode: RecognitionTimeValueMode;
}

export const STATS_UI_PREFERENCES_KEY = "anki-note.statsUiPreferences";
export const DEFAULT_STATS_UI_PREFERENCES: StatsUiPreferences = {
  carouselCardId: STATS_CAROUSEL_CARD_IDS[1],
  customRangeDays: 14,
  hiddenRecognitionSeries: [],
  range: 30,
  recognitionTimeGrouping: "practice-session",
  recognitionTimeMetric: "duration",
  recognitionTimeRelativeBaselineMode: "previous-range-end",
  recognitionTimeValueMode: "absolute",
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isRecognitionTimeGrouping(value: unknown): value is RecognitionTimeGrouping {
  return typeof value === "string" && RECOGNITION_TIME_GROUPINGS.includes(value as RecognitionTimeGrouping);
}

function isRecognitionTimeMetric(value: unknown): value is RecognitionTimeMetric {
  return typeof value === "string" && RECOGNITION_TIME_METRICS.includes(value as RecognitionTimeMetric);
}

function isRecognitionRelativeBaselineMode(value: unknown): value is RecognitionRelativeBaselineMode {
  return typeof value === "string" &&
    RECOGNITION_RELATIVE_BASELINE_MODES.includes(value as RecognitionRelativeBaselineMode);
}

function isRecognitionTimeValueMode(value: unknown): value is RecognitionTimeValueMode {
  return typeof value === "string" && RECOGNITION_TIME_VALUE_MODES.includes(value as RecognitionTimeValueMode);
}

export function parseHiddenRecognitionSeries(
  value: unknown,
  fallback: RecognitionSeriesKey[] = [],
): RecognitionSeriesKey[] {
  if (!Array.isArray(value)) {
    return fallback;
  }

  const hiddenSeries = RECOGNITION_SERIES_KEYS.filter((seriesKey) => value.some((item) => item === seriesKey));
  return hiddenSeries.length === RECOGNITION_SERIES_KEYS.length ? fallback : hiddenSeries;
}

function isStatsCarouselCardId(value: unknown): value is StatsCarouselCardId {
  return typeof value === "string" && STATS_CAROUSEL_CARD_IDS.includes(value as StatsCarouselCardId);
}

export function parseStatsUiPreferences(value: unknown, fallback: StatsUiPreferences): StatsUiPreferences {
  if (!isRecord(value)) {
    return fallback;
  }

  return {
    carouselCardId: isStatsCarouselCardId(value.carouselCardId) ? value.carouselCardId : fallback.carouselCardId,
    customRangeDays: parseStatsRangeDays(value.customRangeDays) ?? fallback.customRangeDays,
    hiddenRecognitionSeries: parseHiddenRecognitionSeries(
      value.hiddenRecognitionSeries,
      fallback.hiddenRecognitionSeries,
    ),
    range: parseStatsRange(value.range, fallback.range),
    recognitionTimeGrouping: isRecognitionTimeGrouping(value.recognitionTimeGrouping)
      ? value.recognitionTimeGrouping
      : fallback.recognitionTimeGrouping,
    recognitionTimeMetric: isRecognitionTimeMetric(value.recognitionTimeMetric)
      ? value.recognitionTimeMetric
      : fallback.recognitionTimeMetric,
    recognitionTimeRelativeBaselineMode: isRecognitionRelativeBaselineMode(value.recognitionTimeRelativeBaselineMode)
      ? value.recognitionTimeRelativeBaselineMode
      : typeof value.recognitionTimeResetNewRangeAtFirstPoint === "boolean"
        ? value.recognitionTimeResetNewRangeAtFirstPoint
          ? "new-range-start"
          : "previous-range-end"
        : fallback.recognitionTimeRelativeBaselineMode,
    recognitionTimeValueMode: isRecognitionTimeValueMode(value.recognitionTimeValueMode)
      ? value.recognitionTimeValueMode
      : fallback.recognitionTimeValueMode,
  };
}
