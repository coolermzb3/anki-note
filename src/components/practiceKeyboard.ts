import type { PromptDisplayMode } from "../domain/types";

export type PausedKeyboardAction = "allow-edit" | "block" | "toggle-playback";

export function getPausedKeyboardAction({
  code,
  isEditableTarget,
  promptDisplayMode,
}: {
  code: string;
  isEditableTarget: boolean;
  promptDisplayMode: PromptDisplayMode;
}): PausedKeyboardAction {
  if (code === "Space" && promptDisplayMode === "staff-page") {
    return "toggle-playback";
  }
  return isEditableTarget ? "allow-edit" : "block";
}
