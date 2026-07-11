import {
  buildPracticeComparisonSnapshot,
  type PracticeComparisonSnapshot,
} from "./practiceComparison";
import type { PracticeSessionRecord, PracticeSessionRecordV1 } from "./types";

function deriveV1PracticeComparisonSnapshot(
  session: PracticeSessionRecordV1,
): PracticeComparisonSnapshot | undefined {
  if (
    session.promptDisplayMode === undefined ||
    session.includeLedgerVariants === undefined ||
    session.queueStrategy === undefined ||
    (session.queueStrategy === "note-drill" && session.drillNoteNames === undefined)
  ) {
    return undefined;
  }
  return buildPracticeComparisonSnapshot({
    drillNoteNames: session.drillNoteNames ?? [],
    enabledGroupIds: session.enabledGroupIds,
    includeInterStaffLedgerSpellings: session.includeLedgerVariants,
    promptDisplayMode: session.promptDisplayMode,
    queueStrategy: session.queueStrategy,
    staffNotationMode: "grand",
  });
}

export function getPracticeSessionComparisonSnapshot(
  session: PracticeSessionRecord,
): PracticeComparisonSnapshot | undefined {
  if (session.schemaVersion === 2) {
    return {
      effectiveQueueAlgorithm: session.effectiveQueueAlgorithm,
      promptDisplayMode: session.promptDisplayMode,
      targetNoteSetKey: session.targetNoteSetKey,
    };
  }
  return deriveV1PracticeComparisonSnapshot(session);
}
