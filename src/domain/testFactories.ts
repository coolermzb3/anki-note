import type { NoteName, PracticeGroupId, ReviewRecord, TargetNoteId } from "./types";

export function makeReview(overrides: Partial<ReviewRecord> & { targetNoteId: TargetNoteId }): ReviewRecord {
  const noteName = overrides.targetNoteId[0] as NoteName;
  const octave = Number(overrides.targetNoteId[1]) as ReviewRecord["octave"];
  const groupId = `C${octave}-B${octave}` as PracticeGroupId;
  const now = "2026-07-04T12:00:00.000+08:00";
  return {
    id: overrides.id ?? crypto.randomUUID(),
    schemaVersion: 1,
    sessionId: overrides.sessionId ?? "session-1",
    targetNoteId: overrides.targetNoteId,
    groupId: overrides.groupId ?? groupId,
    noteName: overrides.noteName ?? noteName,
    octave: overrides.octave ?? octave,
    startedAt: overrides.startedAt ?? now,
    endedAt: overrides.endedAt ?? now,
    answeredAt: overrides.answeredAt ?? now,
    answeredCorrectly: overrides.answeredCorrectly ?? true,
    interrupted: overrides.interrupted ?? false,
    interruptReason: overrides.interruptReason,
    activeMs: overrides.activeMs ?? 1000,
    wrongAnswers: overrides.wrongAnswers ?? [],
    replayCount: overrides.replayCount ?? 0,
    focusLosses: overrides.focusLosses ?? [],
  };
}
