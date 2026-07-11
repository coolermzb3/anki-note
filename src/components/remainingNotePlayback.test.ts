import { describe, expect, it } from "vitest";
import { getRemainingPlaybackToggleAction } from "./remainingNotePlayback";

describe("remaining-note playback toggle", () => {
  it("starts and resumes from idle and paused states", () => {
    expect(getRemainingPlaybackToggleAction("idle", true)).toBe("start");
    expect(getRemainingPlaybackToggleAction("paused", true)).toBe("resume");
  });

  it("pauses while more notes remain", () => {
    expect(getRemainingPlaybackToggleAction("playing", true)).toBe("pause");
  });

  it("completes when the final note has already begun", () => {
    expect(getRemainingPlaybackToggleAction("playing", false)).toBe("complete");
  });
});
