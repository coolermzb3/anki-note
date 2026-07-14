import {
  RECOGNITION_SERIES_KEYS,
  RECOGNITION_TIME_GROUPINGS,
  RECOGNITION_TIME_METRICS,
  RECOGNITION_TIME_VALUE_MODES,
  type RecognitionSeriesKey,
  type RecognitionTimeGrouping,
  type RecognitionTimeMetric,
  type RecognitionTimeValueMode,
} from "./recognitionTrend";
import { STATS_RANGES, type StatsRange } from "./statsRange";

export const STATS_CAROUSEL_CARD_IDS = ["recognition-time", "session-progress", "note-range"] as const;
export type StatsCarouselCardId = (typeof STATS_CAROUSEL_CARD_IDS)[number];

export interface StatsUiPreferences {
  carouselCardId: StatsCarouselCardId;
  hiddenRecognitionSeries: RecognitionSeriesKey[];
  range: StatsRange;
  recognitionTimeGrouping: RecognitionTimeGrouping;
  recognitionTimeMetric: RecognitionTimeMetric;
  recognitionTimeValueMode: RecognitionTimeValueMode;
}

export const STATS_UI_PREFERENCES_KEY = "anki-note.statsUiPreferences";
export const DEFAULT_STATS_UI_PREFERENCES: StatsUiPreferences = {
  carouselCardId: STATS_CAROUSEL_CARD_IDS[1],
  hiddenRecognitionSeries: [],
  range: "30",
  recognitionTimeGrouping: "practice-session",
  recognitionTimeMetric: "duration",
  recognitionTimeValueMode: "absolute",
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isStatsRange(value: unknown): value is StatsRange {
  return typeof value === "string" && STATS_RANGES.includes(value as StatsRange);
}

function isRecognitionTimeGrouping(value: unknown): value is RecognitionTimeGrouping {
  return typeof value === "string" && RECOGNITION_TIME_GROUPINGS.includes(value as RecognitionTimeGrouping);
}

function isRecognitionTimeMetric(value: unknown): value is RecognitionTimeMetric {
  return typeof value === "string" && RECOGNITION_TIME_METRICS.includes(value as RecognitionTimeMetric);
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
    hiddenRecognitionSeries: parseHiddenRecognitionSeries(
      value.hiddenRecognitionSeries,
      fallback.hiddenRecognitionSeries,
    ),
    range: isStatsRange(value.range) ? value.range : fallback.range,
    recognitionTimeGrouping: isRecognitionTimeGrouping(value.recognitionTimeGrouping)
      ? value.recognitionTimeGrouping
      : fallback.recognitionTimeGrouping,
    recognitionTimeMetric: isRecognitionTimeMetric(value.recognitionTimeMetric)
      ? value.recognitionTimeMetric
      : fallback.recognitionTimeMetric,
    recognitionTimeValueMode: isRecognitionTimeValueMode(value.recognitionTimeValueMode)
      ? value.recognitionTimeValueMode
      : fallback.recognitionTimeValueMode,
  };
}
