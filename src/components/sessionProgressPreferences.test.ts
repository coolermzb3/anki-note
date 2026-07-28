import { describe, expect, it } from "vitest";

import {
  DEFAULT_SESSION_PROGRESS_UI_PREFERENCES,
  parseSessionProgressUiPreferences,
} from "./sessionProgressPreferences";

describe("session progress preferences", () => {
  it("defaults old preferences to a numeric history limit", () => {
    expect(
      parseSessionProgressUiPreferences(
        { historyLimit: 18, mode: "duration-cumsum" },
        DEFAULT_SESSION_PROGRESS_UI_PREFERENCES,
      ),
    ).toEqual({
      allHistory: false,
      historyLimit: 18,
      mode: "duration-cumsum",
    });
  });

  it("persists the all-history choice independently from the numeric limit", () => {
    expect(
      parseSessionProgressUiPreferences(
        { allHistory: true, historyLimit: 18, mode: "actual-order" },
        DEFAULT_SESSION_PROGRESS_UI_PREFERENCES,
      ),
    ).toEqual({
      allHistory: true,
      historyLimit: 18,
      mode: "actual-order",
    });
  });
});
