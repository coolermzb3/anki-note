import { writeBackupNow } from "../data/backup";
import { db, getBackupState } from "../data/db";
import { isCompletedReview, isStatisticalReview } from "../domain/reviews";
import type { PracticeSessionRecord, ReviewRecord } from "../domain/types";
import { isSingleNoteNameDrill } from "../domain/practiceSession";

export interface EmptySessionCandidate {
  session: PracticeSessionRecord;
  reviewCount: number;
  completedReviewCount: number;
  statisticalReviewCount: number;
  ignoredReviewCount: number;
  interruptedReviewCount: number;
  reason: "single-note-drill-without-completed-count" | "no-statistical-review";
}

export interface EmptySessionReport {
  generatedAt: string;
  totalSessionCount: number;
  totalReviewCount: number;
  openSessionCount: number;
  candidateCount: number;
  candidateReviewCount: number;
  candidates: EmptySessionCandidate[];
}

export interface EmptySessionDeleteResult {
  report: EmptySessionReport;
  deletedSessionCount: number;
  deletedReviewCount: number;
  backup:
    | { status: "updated" }
    | { status: "skipped"; reason: "no-directory" | "permission-not-granted" | "disabled" }
    | { status: "failed"; error: string };
}

export interface DeleteEmptySessionsOptions {
  writeBackup?: boolean;
}

interface IndexedDbMaintenanceDebug {
  listEmptySessions: () => Promise<EmptySessionReport>;
  deleteEmptySessions: (options?: DeleteEmptySessionsOptions) => Promise<EmptySessionDeleteResult>;
}

declare global {
  interface Window {
    ankiNoteIndexedDbMaintenance?: IndexedDbMaintenanceDebug;
  }
}

function groupReviewsBySession(reviews: ReviewRecord[]): Map<string, ReviewRecord[]> {
  const reviewsBySession = new Map<string, ReviewRecord[]>();
  for (const review of reviews) {
    reviewsBySession.set(review.sessionId, [...(reviewsBySession.get(review.sessionId) ?? []), review]);
  }
  return reviewsBySession;
}

function isEmptyPersistedSession(session: PracticeSessionRecord, sessionReviews: ReviewRecord[]): boolean {
  if (!session.endedAt) {
    return false;
  }

  if (session.completedCount > 0) {
    return false;
  }

  if (isSingleNoteNameDrill(session)) {
    return !sessionReviews.some(isCompletedReview);
  }

  return !sessionReviews.some(isStatisticalReview);
}

function makeCandidate(session: PracticeSessionRecord, sessionReviews: ReviewRecord[]): EmptySessionCandidate {
  return {
    session,
    reviewCount: sessionReviews.length,
    completedReviewCount: sessionReviews.filter(isCompletedReview).length,
    statisticalReviewCount: sessionReviews.filter(isStatisticalReview).length,
    ignoredReviewCount: sessionReviews.filter((review) => review.ignored).length,
    interruptedReviewCount: sessionReviews.filter((review) => review.interrupted).length,
    reason: isSingleNoteNameDrill(session) ? "single-note-drill-without-completed-count" : "no-statistical-review",
  };
}

export async function listEmptySessions(): Promise<EmptySessionReport> {
  const [sessions, reviews] = await Promise.all([
    db.practiceSessions.orderBy("startedAt").toArray(),
    db.reviews.orderBy("startedAt").toArray(),
  ]);
  const reviewsBySession = groupReviewsBySession(reviews);
  const candidates = sessions
    .filter((session) => isEmptyPersistedSession(session, reviewsBySession.get(session.id) ?? []))
    .map((session) => makeCandidate(session, reviewsBySession.get(session.id) ?? []));

  return {
    generatedAt: new Date().toISOString(),
    totalSessionCount: sessions.length,
    totalReviewCount: reviews.length,
    openSessionCount: sessions.filter((session) => !session.endedAt).length,
    candidateCount: candidates.length,
    candidateReviewCount: candidates.reduce((sum, candidate) => sum + candidate.reviewCount, 0),
    candidates,
  };
}

async function writeBackupIfAlreadyPermitted(enabled: boolean): Promise<EmptySessionDeleteResult["backup"]> {
  if (!enabled) {
    return { status: "skipped", reason: "disabled" };
  }

  const backupState = await getBackupState();
  const handle = backupState.directoryHandle;
  if (!handle) {
    return { status: "skipped", reason: "no-directory" };
  }

  if (handle.queryPermission) {
    const permission = await handle.queryPermission({ mode: "readwrite" });
    if (permission !== "granted") {
      return { status: "skipped", reason: "permission-not-granted" };
    }
  }

  try {
    await writeBackupNow();
    return { status: "updated" };
  } catch (error) {
    return { status: "failed", error: error instanceof Error ? error.message : String(error) };
  }
}

export async function deleteEmptySessions(options: DeleteEmptySessionsOptions = {}): Promise<EmptySessionDeleteResult> {
  const report = await listEmptySessions();
  const sessionIds = new Set(report.candidates.map((candidate) => candidate.session.id));
  const deletedReviewIds = await db.reviews.filter((review) => sessionIds.has(review.sessionId)).primaryKeys();

  await db.transaction("rw", db.settings, db.practiceSessions, db.reviews, async () => {
    await db.practiceSessions.bulkDelete([...sessionIds]);
    await db.reviews.bulkDelete(deletedReviewIds);

    const settings = await db.settings.get("default");
    if (!settings) {
      return;
    }

    const [firstRemainingReview] = await db.reviews.filter((review) => !review.ignored).sortBy("startedAt");
    const nextSettings = { ...settings };
    if (firstRemainingReview) {
      nextSettings.firstReviewAt = firstRemainingReview.startedAt;
    } else {
      delete nextSettings.firstReviewAt;
    }
    await db.settings.put(nextSettings);
  });

  const backup = await writeBackupIfAlreadyPermitted(options.writeBackup ?? true);

  return {
    report,
    deletedSessionCount: sessionIds.size,
    deletedReviewCount: deletedReviewIds.length,
    backup,
  };
}

export function installIndexedDbMaintenanceDebug(): () => void {
  const debugApi: IndexedDbMaintenanceDebug = {
    listEmptySessions,
    deleteEmptySessions,
  };
  window.ankiNoteIndexedDbMaintenance = debugApi;
  return () => {
    if (window.ankiNoteIndexedDbMaintenance === debugApi) {
      delete window.ankiNoteIndexedDbMaintenance;
    }
  };
}
