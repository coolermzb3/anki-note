import { useEffect, useMemo, useRef } from "react";
import { Formatter, GhostNote, StaveNote, Voice } from "vexflow";
import { noteToVexKey } from "../domain/notes";
import type { PromptNoteDuration, TargetNote } from "../domain/types";
import { PRACTICE_PAGE_STAFF_LAYOUT } from "./staffLayoutProfiles";
import {
  createStaffRenderSurface,
  drawGrandStaff,
  getFixedStaffFrame,
  getGrandStaffAnchors,
  getGrandStaffNoteArea,
  getLedgerStemDirection,
  logicalPx,
  type DrawnGrandStaff,
} from "./staffGeometry";

interface StaffPagePromptProps {
  notes: TargetNote[];
  completedCount: number;
  noteDuration: PromptNoteDuration;
  useLedgerGap: boolean;
  wrongIndex?: number;
}

const NEUTRAL_COLOR = "#211c18";
const COMPLETE_COLOR = "#2f8f5f";
const WRONG_COLOR = "#c84c3d";
const BARLINE_COLOR = "#211c18";
function chunkNotes(notes: TargetNote[]): TargetNote[][] {
  const rows: TargetNote[][] = [];
  const { notesPerRow } = PRACTICE_PAGE_STAFF_LAYOUT.multirow;
  for (let index = 0; index < notes.length; index += notesPerRow) {
    rows.push(notes.slice(index, index + notesPerRow));
  }
  return rows.slice(0, PRACTICE_PAGE_STAFF_LAYOUT.multirow.rows);
}

function noteDurationToVexDuration(noteDuration: PromptNoteDuration): "q" | "w" {
  return noteDuration === "quarter" ? "q" : "w";
}

function noteDurationToBeats(noteDuration: PromptNoteDuration): number {
  return noteDuration === "quarter" ? 1 : 4;
}

function makeStaveNote(note: TargetNote, color: string, noteDuration: PromptNoteDuration): StaveNote {
  const stemDirection = getLedgerStemDirection(note);
  const staveNote = new StaveNote({
    clef: note.staff,
    duration: noteDurationToVexDuration(noteDuration),
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

export function StaffPagePrompt({
  notes,
  completedCount,
  noteDuration,
  useLedgerGap,
  wrongIndex,
}: StaffPagePromptProps): JSX.Element {
  const frameRef = useRef<HTMLDivElement | null>(null);
  const rendererTargetRef = useRef<HTMLDivElement | null>(null);
  const rows = useMemo(() => chunkNotes(notes), [notes]);

  useEffect(() => {
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
      const { context } = surface;
      const frameMetrics = getFixedStaffFrame(
        surface,
        PRACTICE_PAGE_STAFF_LAYOUT.horizontal.staffSidePaddingPx,
      );
      const anchors = getGrandStaffAnchors(
        surface.scale,
        PRACTICE_PAGE_STAFF_LAYOUT.vertical.centerYPx,
        useLedgerGap
          ? PRACTICE_PAGE_STAFF_LAYOUT.vertical.ledgerGapPx
          : PRACTICE_PAGE_STAFF_LAYOUT.vertical.gapPx,
      );

      const getSystemNoteArea = (staves: DrawnGrandStaff) =>
        getGrandStaffNoteArea(
          staves,
          PRACTICE_PAGE_STAFF_LAYOUT.multirow.notesPerRow,
          surface.scale,
          PRACTICE_PAGE_STAFF_LAYOUT.horizontal,
        );

      rows.forEach((rowNotes, rowIndex) => {
        const rowStep = logicalPx(
          PRACTICE_PAGE_STAFF_LAYOUT.vertical.viewHeightPx +
            PRACTICE_PAGE_STAFF_LAYOUT.multirow.rowGapPx,
          surface.scale,
        );
        const baseY = rowIndex * rowStep;
        const rowGroup = context.openGroup("staff-page-system");
        const grandStaff = drawGrandStaff(context, frameMetrics, anchors, {
          brace: true,
          yOffset: baseY,
        });
        const { bass, treble } = grandStaff;
        const noteArea = getSystemNoteArea(grandStaff);

        const rowStartIndex = rowIndex * PRACTICE_PAGE_STAFF_LAYOUT.multirow.notesPerRow;
        const rowSlots = Array.from(
          { length: PRACTICE_PAGE_STAFF_LAYOUT.multirow.notesPerRow },
          (_, slotIndex) => rowNotes[slotIndex],
        );
        const vexDuration = noteDurationToVexDuration(noteDuration);
        const trebleTickables = rowSlots.map((note, slotIndex) =>
          note?.staff === "treble"
            ? makeStaveNote(note, colorForIndex(rowStartIndex + slotIndex, completedCount, wrongIndex), noteDuration)
            : new GhostNote(vexDuration),
        );
        const bassTickables = rowSlots.map((note, slotIndex) =>
          note?.staff === "bass"
            ? makeStaveNote(note, colorForIndex(rowStartIndex + slotIndex, completedCount, wrongIndex), noteDuration)
            : new GhostNote(vexDuration),
        );
        const voiceOptions = {
          beatValue: 4,
          numBeats: PRACTICE_PAGE_STAFF_LAYOUT.multirow.notesPerRow * noteDurationToBeats(noteDuration),
        };
        const trebleVoice = new Voice(voiceOptions).addTickables(trebleTickables);
        const bassVoice = new Voice(voiceOptions).addTickables(bassTickables);
        treble.setNoteStartX(noteArea.left);
        bass.setNoteStartX(noteArea.left);
        treble.setWidth(Math.max(1, noteArea.right - frameMetrics.x));
        bass.setWidth(Math.max(1, noteArea.right - frameMetrics.x));
        new Formatter().joinVoices([trebleVoice, bassVoice]).formatToStave([trebleVoice, bassVoice], treble, {
          context,
          stave: treble,
        });
        trebleVoice.draw(context, treble);
        bassVoice.draw(context, bass);

        for (
          let boundaryIndex = PRACTICE_PAGE_STAFF_LAYOUT.multirow.barlineInterval;
          boundaryIndex <= rowNotes.length && boundaryIndex < PRACTICE_PAGE_STAFF_LAYOUT.multirow.notesPerRow;
          boundaryIndex += PRACTICE_PAGE_STAFF_LAYOUT.multirow.barlineInterval
        ) {
          const previousTickable = trebleTickables[boundaryIndex - 1];
          const nextTickable = trebleTickables[boundaryIndex];
          const barlineX = (previousTickable.getAbsoluteX() + nextTickable.getAbsoluteX()) / 2;
          addBarline(rowGroup, barlineX, treble.getYForLine(0), bass.getYForLine(4));
        }
        context.closeGroup();
      });
    }

    render();
    const observer = new ResizeObserver(render);
    observer.observe(frame);
    return () => observer.disconnect();
  }, [completedCount, noteDuration, rows, useLedgerGap, wrongIndex]);

  return (
    <div ref={frameRef} className="staff-page" aria-label="谱页">
      <div ref={rendererTargetRef} className="staff-page-renderer" />
    </div>
  );
}
