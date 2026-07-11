import { PRACTICE_PAGE_STAFF_LAYOUT } from "./staffLayoutProfiles";

const STAFF_PAGE_SIZE =
  PRACTICE_PAGE_STAFF_LAYOUT.multirow.rows * PRACTICE_PAGE_STAFF_LAYOUT.multirow.notesPerRow;
const STAFF_PAGE_SCROLL_TRIGGER_REMAINING = 8;

export function getStaffPageRefillCount({
  completedSessionCount,
  fixedSessionCount,
  nextIndex,
  plannedNoteCount,
}: {
  completedSessionCount: number;
  fixedSessionCount?: number;
  nextIndex: number;
  plannedNoteCount: number;
}): number {
  const remainingVisibleCount = plannedNoteCount - nextIndex;
  if (plannedNoteCount !== STAFF_PAGE_SIZE || remainingVisibleCount !== STAFF_PAGE_SCROLL_TRIGGER_REMAINING) {
    return 0;
  }
  const availableFutureCount =
    fixedSessionCount === undefined
      ? PRACTICE_PAGE_STAFF_LAYOUT.multirow.notesPerRow
      : Math.max(0, fixedSessionCount - completedSessionCount - remainingVisibleCount);
  return Math.min(PRACTICE_PAGE_STAFF_LAYOUT.multirow.notesPerRow, availableFutureCount);
}
