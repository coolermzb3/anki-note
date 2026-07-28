import { describe, expect, it } from "vitest";

import {
  DEFAULT_STAFF_RECALL_UI_PREFERENCES,
  parseStaffRecallUiPreferences,
} from "./staffRecallPreferences";

describe("staff recall preferences", () => {
  it("defaults old preferences to a numeric history limit", () => {
    expect(
      parseStaffRecallUiPreferences({ historyLimit: 24 }, DEFAULT_STAFF_RECALL_UI_PREFERENCES),
    ).toEqual({
      allHistory: false,
      historyLimit: 24,
    });
  });

  it("persists the all-history choice independently from the numeric limit", () => {
    expect(
      parseStaffRecallUiPreferences({ allHistory: true, historyLimit: 24 }, DEFAULT_STAFF_RECALL_UI_PREFERENCES),
    ).toEqual({
      allHistory: true,
      historyLimit: 24,
    });
  });
});
