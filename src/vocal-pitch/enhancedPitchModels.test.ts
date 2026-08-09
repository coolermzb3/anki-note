import { describe, expect, it } from "vitest";
import {
  ENHANCED_PITCH_REMINDER_KEY,
  isEnhancedPitchReminderSuppressedToday,
  suppressEnhancedPitchReminderToday,
} from "./enhancedPitchModels";

describe("enhanced pitch reminder", () => {
  it("suppresses prompts only for the current local date", () => {
    const values = new Map<string, string>();
    const storage = {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
    };
    const today = new Date(2026, 7, 9, 12);
    suppressEnhancedPitchReminderToday(storage, today);
    expect(values.get(ENHANCED_PITCH_REMINDER_KEY)).toBe("2026-08-09");
    expect(isEnhancedPitchReminderSuppressedToday(storage, today)).toBe(true);
    expect(isEnhancedPitchReminderSuppressedToday(storage, new Date(2026, 7, 10, 0))).toBe(false);
  });
});
