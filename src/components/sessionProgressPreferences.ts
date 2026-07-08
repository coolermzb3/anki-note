import type { SessionProgressMode } from "../domain/sessionProgress";
import { DEFAULT_SESSION_PROGRESS_HISTORY_LIMIT, normalizeSessionProgressHistoryLimit } from "./SessionProgressChart";

const SESSION_PROGRESS_MODES: readonly SessionProgressMode[] = ["actual-order", "duration-cumsum"];

export const SESSION_PROGRESS_UI_PREFERENCES_KEY = "anki-note.sessionProgressUiPreferences";

export interface SessionProgressUiPreferences {
  historyLimit: number;
  mode: SessionProgressMode;
}

export const DEFAULT_SESSION_PROGRESS_UI_PREFERENCES: SessionProgressUiPreferences = {
  historyLimit: DEFAULT_SESSION_PROGRESS_HISTORY_LIMIT,
  mode: "actual-order",
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function isSessionProgressMode(value: unknown): value is SessionProgressMode {
  return typeof value === "string" && SESSION_PROGRESS_MODES.includes(value as SessionProgressMode);
}

export function parseSessionProgressUiPreferences(
  value: unknown,
  fallback: SessionProgressUiPreferences,
): SessionProgressUiPreferences {
  if (!isRecord(value)) {
    return fallback;
  }

  return {
    historyLimit:
      typeof value.historyLimit === "number" || typeof value.historyLimit === "string"
        ? normalizeSessionProgressHistoryLimit(String(value.historyLimit))
        : fallback.historyLimit,
    mode: isSessionProgressMode(value.mode) ? value.mode : fallback.mode,
  };
}
