import { describe, expect, it } from "vitest";
import { getVocalRecordingSpaceAction, shouldFinishVocalRecordingWhenHidden } from "./recordingPolicy";

describe("vocal recording policy", () => {
  it("uses Space to finish recording and otherwise toggle playback", () => {
    expect(getVocalRecordingSpaceAction("recording", false)).toBe("finish-recording");
    expect(getVocalRecordingSpaceAction("idle", true)).toBe("toggle-playback");
    expect(getVocalRecordingSpaceAction("idle", false)).toBe("none");
    expect(getVocalRecordingSpaceAction("stopping", true)).toBe("none");
  });

  it("stops a hidden recording unless background recording is allowed", () => {
    expect(shouldFinishVocalRecordingWhenHidden("recording", false)).toBe(true);
    expect(shouldFinishVocalRecordingWhenHidden("recording", true)).toBe(false);
    expect(shouldFinishVocalRecordingWhenHidden("idle", false)).toBe(false);
  });
});
