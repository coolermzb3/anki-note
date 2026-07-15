import { useLayoutEffect, useMemo, useRef } from "react";
import { Beam, Formatter, GhostNote, Stave, StaveNote, Stem, Voice } from "vexflow";
import { noteToVexKey } from "../domain/notes";
import type { PromptNoteDuration, StaffNotationMode, TargetNote } from "../domain/types";
import { PRACTICE_PAGE_STAFF_LAYOUT } from "./staffLayoutProfiles";
import {
  createStaffRenderSurface,
  drawStaffSystem,
  getFixedStaffFrame,
  getLedgerStemDirection,
  logicalPx,
} from "./staffGeometry";
import {
  getBarlineGapCenter,
  getCrossStaffOuterStemDirection,
  getQuarterNoteBeats,
  getStaffPageBarlineInterval,
  getStaffPageBeamRuns,
  getVisibleBeamStemDirection,
  getVexNoteDuration,
} from "./staffPageNotation";

interface StaffPagePromptProps {
  notes: TargetNote[];
  completedCount: number;
  isScrolling?: boolean;
  noteDuration: PromptNoteDuration;
  scrollDurationMs?: number;
  staffNotationMode: StaffNotationMode;
  useLedgerGap: boolean;
  visibleRowCount?: number;
  wrongIndex?: number;
}

const NEUTRAL_COLOR = "#211c18";
const COMPLETE_COLOR = "#2f8f5f";
const WRONG_COLOR = "#c84c3d";
const BARLINE_COLOR = "#211c18";
type StaffPageTickable = GhostNote | StaveNote;

function chunkNotes(notes: TargetNote[]): TargetNote[][] {
  const rows: TargetNote[][] = [];
  const { notesPerRow } = PRACTICE_PAGE_STAFF_LAYOUT.multirow;
  for (let index = 0; index < notes.length; index += notesPerRow) {
    rows.push(notes.slice(index, index + notesPerRow));
  }
  return rows.slice(0, PRACTICE_PAGE_STAFF_LAYOUT.multirow.rows + 1);
}

function makeStaveNote(note: TargetNote, color: string, noteDuration: PromptNoteDuration): StaveNote {
  const stemDirection = getLedgerStemDirection(note);
  const staveNote = new StaveNote({
    clef: note.staff,
    duration: getVexNoteDuration(noteDuration),
    keys: [noteToVexKey(note)],
    ...(stemDirection === undefined ? {} : { stemDirection }),
  });
  staveNote.setStyle({ fillStyle: color, strokeStyle: color });
  staveNote.setLedgerLineStyle({ fillStyle: color, strokeStyle: color });
  return staveNote;
}

function colorForIndex(index: number, completedCount: number, wrongIndex: number | undefined): string {
  if (index === wrongIndex) {
    return WRONG_COLOR;
  }
  if (index < completedCount) {
    return COMPLETE_COLOR;
  }
  return NEUTRAL_COLOR;
}

function makeStaffPageBeams(
  rowSlots: readonly (TargetNote | undefined)[],
  rowTickables: readonly StaffPageTickable[],
  noteDuration: PromptNoteDuration,
  visibleYBounds: { bottomY: number; topY: number },
): Beam[] {
  return getStaffPageBeamRuns(rowSlots, noteDuration).flatMap(({ size, startIndex }) => {
    const groupNotes = rowSlots.slice(startIndex, startIndex + size);
    const tickables = rowTickables.slice(startIndex, startIndex + size);
    if (
      !groupNotes.every((note): note is TargetNote => note !== undefined) ||
      !tickables.every((tickable) => tickable instanceof StaveNote)
    ) {
      return [];
    }
    const staveNotes = tickables as StaveNote[];
    const isCrossStaff = groupNotes.some((note) => note.staff !== groupNotes[0].staff);
    const noteYs = staveNotes.map((staveNote) => ({ y: staveNote.getYs()[0] }));
    const preferredDirection =
      getVisibleBeamStemDirection(noteYs, visibleYBounds, Stem.HEIGHT) ??
      (isCrossStaff ? getCrossStaffOuterStemDirection(noteYs) : undefined);
    const stemDirection =
      preferredDirection === undefined ? undefined : preferredDirection === "up" ? Stem.UP : Stem.DOWN;
    const beams = Beam.generateBeams(staveNotes, stemDirection === undefined ? {} : { stemDirection });
    return beams.map((beam) =>
      beam.setStyle({ fillStyle: NEUTRAL_COLOR, strokeStyle: NEUTRAL_COLOR }),
    );
  });
}

function addBarline(parent: SVGElement, x: number, y1: number, y2: number): void {
  const line = document.createElementNS("http://www.w3.org/2000/svg", "line");
  line.setAttribute("class", "staff-page-barline");
  line.setAttribute("x1", x.toFixed(2));
  line.setAttribute("x2", x.toFixed(2));
  line.setAttribute("y1", y1.toFixed(2));
  line.setAttribute("y2", y2.toFixed(2));
  line.setAttribute("stroke", BARLINE_COLOR);
  line.setAttribute("stroke-width", "1.6");
  line.setAttribute("shape-rendering", "crispEdges");
  parent.appendChild(line);
}

function getBarlineX(
  nextTickable: StaffPageTickable,
  previousNote: StaveNote | undefined,
  nextNote: StaveNote | undefined,
): number | undefined {
  if (!previousNote) {
    return undefined;
  }
  const previousBounds = previousNote.getBoundingBox();
  const nextBounds = nextNote?.getBoundingBox();
  return getBarlineGapCenter(
    previousBounds.getX() + previousBounds.getW(),
    nextBounds?.getX() ?? nextTickable.getAbsoluteX(),
  );
}

export function StaffPagePrompt({
  notes,
  completedCount,
  isScrolling = false,
  noteDuration,
  scrollDurationMs = 0,
  staffNotationMode,
  useLedgerGap,
  visibleRowCount = PRACTICE_PAGE_STAFF_LAYOUT.multirow.rows,
  wrongIndex,
}: StaffPagePromptProps): JSX.Element {
  const frameRef = useRef<HTMLDivElement | null>(null);
  const rendererTargetRef = useRef<HTMLDivElement | null>(null);
  const rows = useMemo(() => chunkNotes(notes), [notes]);

  useLayoutEffect(() => {
    const frame = frameRef.current;
    const rendererTarget = rendererTargetRef.current;
    if (!frame || !rendererTarget) {
      return;
    }

    function render(): void {
      if (!frame || !rendererTarget) {
        return;
      }

      rendererTarget.innerHTML = "";
      const rowCount = Math.max(1, rows.length);
      const containerWidth = frame.clientWidth || 920;
      const displayWidth = Math.max(
        PRACTICE_PAGE_STAFF_LAYOUT.width.minPx,
        Math.min(PRACTICE_PAGE_STAFF_LAYOUT.width.maxPx, containerWidth),
      );
      const surface = createStaffRenderSurface(
        rendererTarget,
        displayWidth,
        rowCount * PRACTICE_PAGE_STAFF_LAYOUT.vertical.viewHeightPx +
          Math.max(0, rowCount - 1) * PRACTICE_PAGE_STAFF_LAYOUT.multirow.rowGapPx,
        PRACTICE_PAGE_STAFF_LAYOUT.notationScale,
      );
      const renderedScale = containerWidth / displayWidth;
      const rowStepPx =
        (PRACTICE_PAGE_STAFF_LAYOUT.vertical.viewHeightPx +
          PRACTICE_PAGE_STAFF_LAYOUT.multirow.rowGapPx) * renderedScale;
      const clampedVisibleRowCount = Math.max(1, Math.min(visibleRowCount, rowCount));
      const visibleHeight =
        (clampedVisibleRowCount * PRACTICE_PAGE_STAFF_LAYOUT.vertical.viewHeightPx +
          Math.max(0, clampedVisibleRowCount - 1) * PRACTICE_PAGE_STAFF_LAYOUT.multirow.rowGapPx) * renderedScale;
      frame.style.height = `${visibleHeight}px`;
      rendererTarget.style.setProperty("--staff-page-scroll-distance", `${rowStepPx}px`);
      rendererTarget.style.setProperty("--staff-page-scroll-duration", `${scrollDurationMs}ms`);
      const { context } = surface;
      const frameMetrics = getFixedStaffFrame(
        surface,
        PRACTICE_PAGE_STAFF_LAYOUT.horizontal.staffSidePaddingPx,
      );
      rows.forEach((rowNotes, rowIndex) => {
        const rowStep = logicalPx(
          PRACTICE_PAGE_STAFF_LAYOUT.vertical.viewHeightPx +
            PRACTICE_PAGE_STAFF_LAYOUT.multirow.rowGapPx,
          surface.scale,
        );
        const baseY = rowIndex * rowStep;
        const visibleYBounds = {
          bottomY: baseY + logicalPx(PRACTICE_PAGE_STAFF_LAYOUT.vertical.viewHeightPx, surface.scale),
          topY: baseY,
        };
        const rowGroup = context.openGroup("staff-page-system");
        const rowStartIndex = rowIndex * PRACTICE_PAGE_STAFF_LAYOUT.multirow.notesPerRow;
        const rowSlots = Array.from(
          { length: PRACTICE_PAGE_STAFF_LAYOUT.multirow.notesPerRow },
          (_, slotIndex) => rowNotes[slotIndex],
        );
        const vexDuration = getVexNoteDuration(noteDuration);
        const voiceOptions = {
          beatValue: 4,
          numBeats: PRACTICE_PAGE_STAFF_LAYOUT.multirow.notesPerRow * getQuarterNoteBeats(noteDuration),
        };
        let beams: Beam[];
        let layoutTickables: StaffPageTickable[];
        let visibleTickables: Array<StaveNote | undefined>;
        let barlineTopY: number;
        let barlineBottomY: number;
        const system = drawStaffSystem({
          brace: true,
          columnCount: PRACTICE_PAGE_STAFF_LAYOUT.multirow.notesPerRow,
          context,
          frame: frameMetrics,
          horizontal: PRACTICE_PAGE_STAFF_LAYOUT.horizontal,
          mode: staffNotationMode,
          scale: surface.scale,
          useLedgerGap,
          vertical: PRACTICE_PAGE_STAFF_LAYOUT.vertical,
          yOffset: baseY,
        });
        const { noteArea } = system;
        if (system.mode === "grand") {
          const { bass, treble } = system;
          const tickables = rowSlots.map((note, slotIndex) => {
            if (!note) {
              return new GhostNote(vexDuration).setStave(treble);
            }
            return makeStaveNote(
              note,
              colorForIndex(rowStartIndex + slotIndex, completedCount, wrongIndex),
              noteDuration,
            ).setStave(note.staff === "treble" ? treble : bass);
          });
          const voice = new Voice(voiceOptions).addTickables(tickables);
          treble.setNoteStartX(noteArea.left);
          bass.setNoteStartX(noteArea.left);
          treble.setWidth(Math.max(1, noteArea.right - frameMetrics.x));
          bass.setWidth(Math.max(1, noteArea.right - frameMetrics.x));
          beams = makeStaffPageBeams(rowSlots, tickables, noteDuration, visibleYBounds);
          const formatter = new Formatter().joinVoices([voice]);
          formatter.format(
            [voice],
            treble.getNoteEndX() - treble.getNoteStartX() - Stave.defaultPadding,
            { context },
          );
          formatter.postFormat();
          voice.draw(context);
          layoutTickables = tickables;
          visibleTickables = tickables.map((tickable, index) =>
            rowSlots[index] && tickable instanceof StaveNote ? tickable : undefined,
          );
          barlineTopY = treble.getYForLine(0);
          barlineBottomY = bass.getYForLine(4);
        } else {
          const { stave } = system;
          const tickables = rowSlots.map((note, slotIndex) =>
            note
              ? makeStaveNote(
                  note,
                  colorForIndex(rowStartIndex + slotIndex, completedCount, wrongIndex),
                  noteDuration,
                ).setStave(stave)
              : new GhostNote(vexDuration).setStave(stave),
          );
          const voice = new Voice(voiceOptions).addTickables(tickables);
          beams = makeStaffPageBeams(rowSlots, tickables, noteDuration, visibleYBounds);
          stave.setNoteStartX(noteArea.left);
          stave.setWidth(Math.max(1, noteArea.right - frameMetrics.x));
          new Formatter().joinVoices([voice]).formatToStave([voice], stave, { context, stave });
          voice.draw(context, stave);
          layoutTickables = tickables;
          visibleTickables = tickables.map((tickable, index) =>
            rowSlots[index] && tickable instanceof StaveNote ? tickable : undefined,
          );
          barlineTopY = stave.getYForLine(0);
          barlineBottomY = stave.getYForLine(4);
        }

        beams.forEach((beam) => beam.setContext(context).drawWithStyle());

        const barlineInterval = getStaffPageBarlineInterval(noteDuration);
        for (
          let boundaryIndex = barlineInterval;
          boundaryIndex <= rowNotes.length && boundaryIndex < PRACTICE_PAGE_STAFF_LAYOUT.multirow.notesPerRow;
          boundaryIndex += barlineInterval
        ) {
          const nextTickable = layoutTickables[boundaryIndex];
          const barlineX = getBarlineX(
            nextTickable,
            visibleTickables[boundaryIndex - 1],
            visibleTickables[boundaryIndex],
          );
          if (barlineX !== undefined) {
            addBarline(rowGroup, barlineX, barlineTopY, barlineBottomY);
          }
        }
        context.closeGroup();
      });
    }

    render();
    const observer = new ResizeObserver(render);
    observer.observe(frame);
    return () => observer.disconnect();
  }, [completedCount, noteDuration, rows, scrollDurationMs, staffNotationMode, useLedgerGap, visibleRowCount, wrongIndex]);

  return (
    <div ref={frameRef} className="staff-page" aria-label="谱页">
      <div
        ref={rendererTargetRef}
        className={`staff-page-renderer${isScrolling ? " staff-page-renderer-scrolling" : ""}`}
      />
    </div>
  );
}
