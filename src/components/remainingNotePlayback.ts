export type RemainingPlaybackState = "idle" | "paused" | "playing";
export type RemainingPlaybackToggleAction = "complete" | "pause" | "resume" | "start";

export function getRemainingPlaybackToggleAction(
  state: RemainingPlaybackState,
  hasNextNote: boolean,
): RemainingPlaybackToggleAction {
  if (state === "idle") {
    return "start";
  }
  if (state === "paused") {
    return "resume";
  }
  return hasNextNote ? "pause" : "complete";
}
