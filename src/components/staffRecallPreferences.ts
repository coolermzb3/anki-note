import { DEFAULT_HISTORY_LIMIT, normalizeHistoryLimit } from "./HistoryLimitControl";

export const STAFF_RECALL_UI_PREFERENCES_KEY = "anki-note.staffRecallUiPreferences";

export interface StaffRecallUiPreferences {
  historyLimit: number;
}

export const DEFAULT_STAFF_RECALL_UI_PREFERENCES: StaffRecallUiPreferences = {
  historyLimit: DEFAULT_HISTORY_LIMIT,
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function parseStaffRecallUiPreferences(
  value: unknown,
  fallback: StaffRecallUiPreferences,
): StaffRecallUiPreferences {
  if (!isRecord(value)) {
    return fallback;
  }
  return {
    historyLimit:
      typeof value.historyLimit === "number" || typeof value.historyLimit === "string"
        ? normalizeHistoryLimit(String(value.historyLimit))
        : fallback.historyLimit,
  };
}
