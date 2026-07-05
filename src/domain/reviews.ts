import type { ReviewRecord } from "./types";

type CompletedReviewScope = Pick<ReviewRecord, "answeredCorrectly" | "interrupted">;
type StatisticalReviewScope = CompletedReviewScope & Pick<ReviewRecord, "ignored">;

export function isCompletedReview(review: CompletedReviewScope): boolean {
  return review.answeredCorrectly && !review.interrupted;
}

// `ignored` is retained as a storage/data-import guard even though current single-note drills do not persist ignored reviews.
export function isStatisticalReview(review: StatisticalReviewScope): boolean {
  return !review.ignored && isCompletedReview(review);
}
