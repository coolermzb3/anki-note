import { describe, expect, it } from "vitest";
import { makeDefaultSettings } from "./db";

describe("makeDefaultSettings", () => {
  it("uses the cold-start practice defaults", () => {
    expect(makeDefaultSettings()).toMatchObject({
      defaultMode: "fixed-duration",
      fixedDurationSeconds: 60,
      promptDisplayMode: "staff-page",
      promptNoteDuration: "quarter",
      autoPlayTarget: false,
      enabledGroupIds: ["G3-F4"],
      correctDelayMs: 0,
      pianoVolume: 0.8,
    });
  });
});
