import { describe, expect, it } from "vitest";
import { Stem } from "vexflow";
import { getNoteById } from "../domain/notes";

import {
  getEvenlySpacedCenters,
  getGrandStaffAnchors,
  getLedgerStemDirection,
  getNoteAreaBounds,
  getResponsiveStaffFrame,
  logicalPx,
} from "./staffGeometry";

describe("staff geometry", () => {
  it("keeps display-space tuning values stable across notation scales", () => {
    expect(logicalPx(80, 2)).toBe(40);
    expect(
      getResponsiveStaffFrame(
        { scale: 2, width: 600 },
        7,
        {
          clefReservePx: 144,
          preferredColumnGapPx: 72,
          staffSidePaddingPx: 100,
          noteAreaSidePaddingPx: 80,
          minNoteAreaSidePaddingPx: 36,
        },
      ),
    ).toEqual({ x: 50, staveWidth: 500 });
  });

  it("derives a note area from actual stave note bounds", () => {
    expect(
      getNoteAreaBounds(60, 540, 7, 1, {
        preferredColumnGapPx: 72,
        noteAreaSidePaddingPx: 80,
        minNoteAreaSidePaddingPx: 36,
      }),
    ).toEqual({ left: 96, right: 504 });
    expect(getEvenlySpacedCenters(3, 10, 30)).toEqual([10, 20, 30]);
    expect(getEvenlySpacedCenters(1, 10, 30)).toEqual([20]);
    expect(getGrandStaffAnchors(2, 240, 144)).toEqual({ trebleY: 84, bassY: 156 });
  });

  it("keeps the note area inside an unusually narrow stave", () => {
    expect(
      getNoteAreaBounds(10, 30, 7, 1, {
        preferredColumnGapPx: 72,
        noteAreaSidePaddingPx: 80,
        minNoteAreaSidePaddingPx: 36,
      }),
    ).toEqual({ left: 19.5, right: 20.5 });
  });

  it("points ledger-note stems back toward the staff", () => {
    expect(getLedgerStemDirection(getNoteById("F1"))).toBe(Stem.UP);
    expect(getLedgerStemDirection(getNoteById("G6"))).toBe(Stem.DOWN);
    expect(getLedgerStemDirection(getNoteById("C3"))).toBeUndefined();
    expect(getLedgerStemDirection(getNoteById("C5"))).toBeUndefined();
  });
});
