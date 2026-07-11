import type { TargetNoteId } from "./types";

export function buildTargetNoteSetKey(targetNoteIds: readonly TargetNoteId[]): string {
  return [...new Set(targetNoteIds)].sort().join("|");
}
