import { describe, expect, it } from "vitest";
import {
  DEFAULT_STAFF_PAGE_UI_PREFERENCES,
  getPausedPlaybackIntervalMs,
  normalizePausedPlaybackBpm,
  parseStaffPageUiPreferences,
} from "./staffPageUiPreferences";

describe("staff-page UI preferences", () => {
  it("normalizes BPM to the supported integer range", () => {
    expect(normalizePausedPlaybackBpm(29)).toBe(30);
    expect(normalizePausedPlaybackBpm(100.6)).toBe(101);
    expect(normalizePausedPlaybackBpm(301)).toBe(300);
    expect(normalizePausedPlaybackBpm(Number.NaN, 120)).toBe(120);
  });

  it("parses stored preferences without losing defaults", () => {
    expect(
      parseStaffPageUiPreferences(
        { pausedPlaybackBpm: 140, smoothStaffPageScroll: false, startPausedReading: true },
        DEFAULT_STAFF_PAGE_UI_PREFERENCES,
      ),
    ).toEqual({ pausedPlaybackBpm: 140, smoothStaffPageScroll: false, startPausedReading: true });
    expect(parseStaffPageUiPreferences({}, DEFAULT_STAFF_PAGE_UI_PREFERENCES)).toEqual(
      DEFAULT_STAFF_PAGE_UI_PREFERENCES,
    );
  });

  it("uses one beat for whole and quarter notes during paused playback", () => {
    expect(getPausedPlaybackIntervalMs(100, "whole")).toBe(600);
    expect(getPausedPlaybackIntervalMs(100, "quarter")).toBe(600);
    expect(getPausedPlaybackIntervalMs(100, "eighth")).toBe(300);
    expect(getPausedPlaybackIntervalMs(100, "sixteenth")).toBe(150);
  });
});
