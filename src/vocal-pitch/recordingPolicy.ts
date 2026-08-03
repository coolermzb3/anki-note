export type VocalRecorderStatus = "idle" | "recording" | "stopping";
export type VocalRecordingEndReason = "background" | "input-interrupted" | "limit" | "manual" | "unexpected";

export type VocalRecordingSpaceAction = "finish-recording" | "toggle-playback" | "none";

export function getVocalRecordingSpaceAction(
  status: VocalRecorderStatus,
  hasMaterial: boolean,
): VocalRecordingSpaceAction {
  if (status === "recording") return "finish-recording";
  if (status === "idle" && hasMaterial) return "toggle-playback";
  return "none";
}

export function shouldFinishVocalRecordingWhenHidden(
  status: VocalRecorderStatus,
  allowBackgroundRecording: boolean,
): boolean {
  return status === "recording" && !allowBackgroundRecording;
}
