import { describe, expect, it } from "vitest";
import { makeDefaultSettings, normalizeAppSettings } from "./db";

describe("makeDefaultSettings", () => {
  it("uses the cold-start practice defaults", () => {
    expect(makeDefaultSettings()).toMatchObject({
      defaultMode: "fixed-duration",
      fixedDurationSeconds: 60,
      promptDisplayMode: "staff-page",
      promptNoteDuration: "quarter",
      autoPlayTarget: false,
      enabledGroupIds: ["G3-F4"],
      includeInterStaffLedgerSpellings: false,
      correctDelayMs: 0,
      answerKeyboardScale: 1,
      pianoVolume: 0.8,
    });
  });

  it("preserves the V2 notation mode while defaulting legacy settings to grand staff", () => {
    const current = makeDefaultSettings();
    expect(
      normalizeAppSettings({ ...current, enabledGroupIds: [], staffNotationMode: "bass-only" as const }),
    ).toMatchObject({
      enabledGroupIds: [],
      staffNotationMode: "bass-only",
    });
    expect(normalizeAppSettings({
      id: "default",
      schemaVersion: 1,
      dataSetId: "legacy",
      createdAt: "2026-07-01T00:00:00.000+08:00",
      enabledGroupIds: [],
    })).toMatchObject({
      enabledGroupIds: ["G3-F4"],
      staffNotationMode: "grand",
    });
  });

  it("discards the unreleased checkbox setting shape without failing", () => {
    const { staffNotationMode: _removedMode, ...staleV2 } = makeDefaultSettings();
    const normalized = normalizeAppSettings({
      ...staleV2,
      selectedStaffs: ["bass"],
    } as unknown as Parameters<typeof normalizeAppSettings>[0]);

    expect(normalized.staffNotationMode).toBe("grand");
    expect("selectedStaffs" in normalized).toBe(false);
  });

  it("defaults and clamps the answer keyboard scale without a schema migration", () => {
    const current = makeDefaultSettings();

    expect(normalizeAppSettings({ ...current, answerKeyboardScale: 2 }).answerKeyboardScale).toBe(1.5);
    expect(normalizeAppSettings({ ...current, answerKeyboardScale: 0.1 }).answerKeyboardScale).toBe(0.7);
    expect(normalizeAppSettings({
      ...current,
      answerKeyboardScale: undefined,
    } as unknown as Parameters<typeof normalizeAppSettings>[0]).answerKeyboardScale).toBe(1);
  });
});
