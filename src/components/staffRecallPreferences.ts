import { DEFAULT_HISTORY_LIMIT, normalizeHistoryLimit } from "./HistoryLimitControl";

export const STAFF_RECALL_UI_PREFERENCES_KEY = "anki-note.staffRecallUiPreferences";

export interface StaffRecallUiPreferences {
  allHistory: boolean;
  historyLimit: number;
}

export const DEFAULT_STAFF_RECALL_UI_PREFERENCES: StaffRecallUiPreferences = {
  allHistory: false,
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
    allHistory: typeof value.allHistory === "boolean" ? value.allHistory : fallback.allHistory,
    historyLimit:
      typeof value.historyLimit === "number" || typeof value.historyLimit === "string"
        ? normalizeHistoryLimit(String(value.historyLimit))
        : fallback.historyLimit,
  };
}
