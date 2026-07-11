import { useEffect, useMemo, useRef } from "react";
import { Formatter, GhostNote, StaveNote, Voice } from "vexflow";
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

interface StaffPagePromptProps {
  notes: TargetNote[];
  completedCount: number;
  noteDuration: PromptNoteDuration;
  staffNotationMode: StaffNotationMode;
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
  staffNotationMode,
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
      rows.forEach((rowNotes, rowIndex) => {
        const rowStep = logicalPx(
          PRACTICE_PAGE_STAFF_LAYOUT.vertical.viewHeightPx +
            PRACTICE_PAGE_STAFF_LAYOUT.multirow.rowGapPx,
          surface.scale,
        );
        const baseY = rowIndex * rowStep;
        const rowGroup = context.openGroup("staff-page-system");
        const rowStartIndex = rowIndex * PRACTICE_PAGE_STAFF_LAYOUT.multirow.notesPerRow;
        const rowSlots = Array.from(
          { length: PRACTICE_PAGE_STAFF_LAYOUT.multirow.notesPerRow },
          (_, slotIndex) => rowNotes[slotIndex],
        );
        const vexDuration = noteDurationToVexDuration(noteDuration);
        const voiceOptions = {
          beatValue: 4,
          numBeats: PRACTICE_PAGE_STAFF_LAYOUT.multirow.notesPerRow * noteDurationToBeats(noteDuration),
        };
        let layoutTickables;
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
          layoutTickables = trebleTickables;
          barlineTopY = treble.getYForLine(0);
          barlineBottomY = bass.getYForLine(4);
        } else {
          const { staff, stave } = system;
          const tickables = rowSlots.map((note, slotIndex) =>
            note
              ? makeStaveNote(note, colorForIndex(rowStartIndex + slotIndex, completedCount, wrongIndex), noteDuration)
              : new GhostNote(vexDuration),
          );
          const voice = new Voice(voiceOptions).addTickables(tickables);
          stave.setNoteStartX(noteArea.left);
          stave.setWidth(Math.max(1, noteArea.right - frameMetrics.x));
          new Formatter().joinVoices([voice]).formatToStave([voice], stave, { context, stave });
          voice.draw(context, stave);
          layoutTickables = tickables;
          barlineTopY = stave.getYForLine(0);
          barlineBottomY = stave.getYForLine(4);
        }

        for (
          let boundaryIndex = PRACTICE_PAGE_STAFF_LAYOUT.multirow.barlineInterval;
          boundaryIndex <= rowNotes.length && boundaryIndex < PRACTICE_PAGE_STAFF_LAYOUT.multirow.notesPerRow;
          boundaryIndex += PRACTICE_PAGE_STAFF_LAYOUT.multirow.barlineInterval
        ) {
          const previousTickable = layoutTickables[boundaryIndex - 1];
          const nextTickable = layoutTickables[boundaryIndex];
          const barlineX = (previousTickable.getAbsoluteX() + nextTickable.getAbsoluteX()) / 2;
          addBarline(rowGroup, barlineX, barlineTopY, barlineBottomY);
        }
        context.closeGroup();
      });
    }

    render();
    const observer = new ResizeObserver(render);
    observer.observe(frame);
    return () => observer.disconnect();
  }, [completedCount, noteDuration, rows, staffNotationMode, useLedgerGap, wrongIndex]);

  return (
    <div ref={frameRef} className="staff-page" aria-label="谱页">
      <div ref={rendererTargetRef} className="staff-page-renderer" />
    </div>
  );
}
