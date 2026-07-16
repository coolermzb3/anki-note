import { describe, expect, it } from "vitest";

import {
  getStatsCarouselMoveDirection,
  getStatsCarouselOrder,
  normalizeStatsCarouselIndex,
  rotateStatsCarouselOrder,
} from "./statsCarousel";

describe("statistics carousel", () => {
  it("keeps one instance of each card in cyclic display order", () => {
    expect(getStatsCarouselOrder(0)).toEqual(["recognition-time", "session-progress", "note-range"]);
    expect(getStatsCarouselOrder(1)).toEqual(["session-progress", "note-range", "recognition-time"]);
    expect(getStatsCarouselOrder(2)).toEqual(["note-range", "recognition-time", "session-progress"]);
    expect(new Set(getStatsCarouselOrder(0))).toHaveLength(3);
  });

  it("moves to dot targets through the shortest wraparound direction", () => {
    expect(getStatsCarouselMoveDirection(0, 1)).toBe(1);
    expect(getStatsCarouselMoveDirection(1, 0)).toBe(-1);
    expect(getStatsCarouselMoveDirection(0, 2)).toBe(-1);
    expect(getStatsCarouselMoveDirection(2, 0)).toBe(1);
    expect(getStatsCarouselMoveDirection(1, 1)).toBeUndefined();
  });

  it("rotates the unique cards without cloning them", () => {
    const order = getStatsCarouselOrder(0);
    expect(rotateStatsCarouselOrder(order, 1)).toEqual(["session-progress", "note-range", "recognition-time"]);
    expect(rotateStatsCarouselOrder(order, -1)).toEqual(["note-range", "recognition-time", "session-progress"]);
  });

  it("normalizes indexes across repeated navigation", () => {
    expect(normalizeStatsCarouselIndex(3)).toBe(0);
    expect(normalizeStatsCarouselIndex(-1)).toBe(2);
  });
});
