import { STATS_CAROUSEL_CARD_IDS, type StatsCarouselCardId } from "./statsUiPreferences";

export type StatsCarouselMoveDirection = -1 | 1;

export function normalizeStatsCarouselIndex(index: number): number {
  return ((index % STATS_CAROUSEL_CARD_IDS.length) + STATS_CAROUSEL_CARD_IDS.length) % STATS_CAROUSEL_CARD_IDS.length;
}

export function getStatsCarouselOrder(index: number): StatsCarouselCardId[] {
  const normalizedIndex = normalizeStatsCarouselIndex(index);
  return [
    ...STATS_CAROUSEL_CARD_IDS.slice(normalizedIndex),
    ...STATS_CAROUSEL_CARD_IDS.slice(0, normalizedIndex),
  ];
}

export function getStatsCarouselMoveDirection(
  currentIndex: number,
  targetIndex: number,
): StatsCarouselMoveDirection | undefined {
  const normalizedCurrentIndex = normalizeStatsCarouselIndex(currentIndex);
  const normalizedTargetIndex = normalizeStatsCarouselIndex(targetIndex);
  const directDelta = normalizedTargetIndex - normalizedCurrentIndex;
  if (directDelta === 0) {
    return undefined;
  }
  if (directDelta > STATS_CAROUSEL_CARD_IDS.length / 2) {
    return -1;
  }
  if (directDelta < -STATS_CAROUSEL_CARD_IDS.length / 2) {
    return 1;
  }
  return directDelta > 0 ? 1 : -1;
}

export function rotateStatsCarouselOrder(
  order: readonly StatsCarouselCardId[],
  direction: StatsCarouselMoveDirection,
): StatsCarouselCardId[] {
  if (direction === 1) {
    return [...order.slice(1), order[0]];
  }
  return [order[order.length - 1], ...order.slice(0, -1)];
}
