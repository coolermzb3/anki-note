import type { PromptNoteDuration } from "../domain/types";
import { getQuarterNoteBeats } from "./staffPageNotation";

export interface StaffPageUiPreferences {
  pausedPlaybackBpm: number;
  smoothStaffPageScroll: boolean;
  startPausedReading: boolean;
}

export const STAFF_PAGE_UI_PREFERENCES_KEY = "anki-note.staffPageUiPreferences";
export const MIN_PAUSED_PLAYBACK_BPM = 30;
export const MAX_PAUSED_PLAYBACK_BPM = 300;

export const DEFAULT_STAFF_PAGE_UI_PREFERENCES: StaffPageUiPreferences = {
  pausedPlaybackBpm: 100,
  smoothStaffPageScroll: true,
  startPausedReading: false,
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function normalizePausedPlaybackBpm(value: unknown, fallback = 100): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return fallback;
  }
  return Math.min(MAX_PAUSED_PLAYBACK_BPM, Math.max(MIN_PAUSED_PLAYBACK_BPM, Math.round(value)));
}

export function getPausedPlaybackIntervalMs(bpm: number, noteDuration: PromptNoteDuration): number {
  const beats = noteDuration === "whole" ? 1 : getQuarterNoteBeats(noteDuration);
  return (60_000 / normalizePausedPlaybackBpm(bpm)) * beats;
}

export function parseStaffPageUiPreferences(
  value: unknown,
  fallback: StaffPageUiPreferences,
): StaffPageUiPreferences {
  if (!isRecord(value)) {
    return fallback;
  }
  return {
    pausedPlaybackBpm: normalizePausedPlaybackBpm(value.pausedPlaybackBpm, fallback.pausedPlaybackBpm),
    smoothStaffPageScroll:
      typeof value.smoothStaffPageScroll === "boolean"
        ? value.smoothStaffPageScroll
        : fallback.smoothStaffPageScroll,
    startPausedReading:
      typeof value.startPausedReading === "boolean" ? value.startPausedReading : fallback.startPausedReading,
  };
}
