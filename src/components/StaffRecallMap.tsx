import { useCallback, useEffect, useRef, useState, type MouseEvent as ReactMouseEvent, type PointerEvent as ReactPointerEvent } from "react";
import { Formatter, Renderer, type Stave, StaveNote, Voice } from "vexflow";
import { noteToVexKey } from "../domain/notes";
import { compareTargetNotePitch, formatStaffRecallDeltaMs, type NoteNameColumn } from "../domain/staffRecall";
import { formatMs } from "../domain/stats";
import type { NoteName, Staff, TargetNote, TargetNoteId } from "../domain/types";
import { STAFF_RECALL_LAYOUT } from "./staffLayoutProfiles";
import {
  alignStaveNotesToCenters,
  createStaffRenderSurface,
  drawGrandStaff,
  getEvenlySpacedCenters,
  getGrandStaffAnchors,
  getGrandStaffNoteArea,
  getResponsiveStaffFrame,
  logicalPx,
} from "./staffGeometry";

export interface StaffRecallColumnState {
  activeMs?: number;
  correctNoteIds: TargetNoteId[];
  wrongNoteId?: TargetNoteId;
}

interface StaffRecallMapProps {
  activeNoteName?: NoteName;
  columnStates: Record<NoteName, StaffRecallColumnState>;
  columns: NoteNameColumn[];
  comparisonMedianMsByNoteName: Record<NoteName, number | undefined>;
  inputNotes: TargetNote[];
  onPlacement: (columnNoteName: NoteName, note: TargetNote) => void;
  runCompleted: boolean;
}

interface PlacementGeometry {
  note: TargetNote;
  y: number;
}

interface ColumnGeometry {
  centerX: number;
  left: number;
  noteName: NoteName;
  placements: PlacementGeometry[];
  right: number;
}

interface MapGeometry {
  columns: ColumnGeometry[];
  height: number;
  placementHitRadius: number;
  width: number;
  x: number;
  y: number;
}

const NOTE_DURATION = "w";
const TRANSPARENT = "rgba(0, 0, 0, 0)";
const NEUTRAL_COLOR = "#211c18";
const MUTED_COLOR = "#766b5f";
const CORRECT_COLOR = "#2f8f5f";
const WRONG_COLOR = "#c84c3d";
const HOVER_COLOR = "rgba(37, 111, 103, 0.42)";
function getStatusLineY(lineIndex: 0 | 1 | 2): number {
  const lastLineY = logicalPx(
    STAFF_RECALL_LAYOUT.vertical.viewHeightPx - STAFF_RECALL_LAYOUT.status.bottomLineOffsetPx,
    STAFF_RECALL_LAYOUT.notationScale,
  );
  return lastLineY - logicalPx(
    (2 - lineIndex) * STAFF_RECALL_LAYOUT.status.lineGapPx,
    STAFF_RECALL_LAYOUT.notationScale,
  );
}

function makeChord(
  notes: readonly TargetNote[],
  staff: Staff,
  noteColor: string,
): StaveNote {
  const hasNotes = notes.length > 0;
  const chord = new StaveNote({
    clef: staff,
    duration: NOTE_DURATION,
    keys: hasNotes ? notes.map(noteToVexKey) : [staff === "treble" ? "b/4" : "d/3"],
  });
  const resolvedNoteColor = hasNotes ? noteColor : TRANSPARENT;
  chord.setStyle({ fillStyle: resolvedNoteColor, strokeStyle: resolvedNoteColor });
  chord.setLedgerLineStyle({ fillStyle: resolvedNoteColor, strokeStyle: resolvedNoteColor });
  return chord;
}

function formatAndDrawLayer({
  bass,
  bassTickables,
  centers,
  context,
  noteAreaLeft,
  noteAreaRight,
  treble,
  trebleTickables,
}: {
  bass: Stave;
  bassTickables: StaveNote[];
  centers: readonly number[];
  context: ReturnType<Renderer["getContext"]>;
  noteAreaLeft: number;
  noteAreaRight: number;
  treble: Stave;
  trebleTickables: StaveNote[];
}): void {
  trebleTickables.forEach((tickable) => tickable.setStave(treble));
  bassTickables.forEach((tickable) => tickable.setStave(bass));
  const voiceOptions = { beatValue: 4, numBeats: Math.max(1, trebleTickables.length) * 4 };
  const trebleVoice = new Voice(voiceOptions).addTickables(trebleTickables);
  const bassVoice = new Voice(voiceOptions).addTickables(bassTickables);
  new Formatter().joinVoices([trebleVoice, bassVoice]).format(
    [trebleVoice, bassVoice],
    Math.max(1, noteAreaRight - noteAreaLeft),
    { context },
  );
  alignStaveNotesToCenters(trebleTickables, centers);
  trebleVoice.draw(context, treble);
  bassVoice.draw(context, bass);
}

function drawCenteredText(context: ReturnType<Renderer["getContext"]>, text: string, x: number, y: number): void {
  const { width } = context.measureText(text);
  context.fillText(text, x - width / 2, y);
}

function getColumnBounds(
  centers: readonly number[],
  index: number,
  width: number,
): { left: number; right: number } {
  const center = centers[index];
  const previousCenter = centers[index - 1];
  const nextCenter = centers[index + 1];
  const left = previousCenter === undefined
    ? center - ((nextCenter ?? center) - center) / 2
    : (previousCenter + center) / 2;
  const right = nextCenter === undefined
    ? center + (center - (previousCenter ?? center)) / 2
    : (center + nextCenter) / 2;
  return {
    left: Math.max(0, left),
    right: Math.min(width, right),
  };
}

function getNoteLine(note: TargetNote): number {
  return new StaveNote({
    clef: note.staff,
    duration: NOTE_DURATION,
    keys: [noteToVexKey(note)],
  }).getLineNumber();
}

function getPlacements(notes: readonly TargetNote[], stave: Stave): PlacementGeometry[] {
  return notes.map((note) => ({
    note,
    y: stave.getYForNote(getNoteLine(note)),
  }));
}

function getLedgerLines(notes: readonly TargetNote[]): number[] {
  if (notes.length === 0) {
    return [];
  }
  const noteLines = notes.map(getNoteLine);
  const lowestLine = Math.min(...noteLines);
  const highestLine = Math.max(...noteLines);
  const ledgerLines: number[] = [];
  for (let line = 0; line >= lowestLine; line -= 1) {
    ledgerLines.push(line);
  }
  for (let line = 6; line <= highestLine; line += 1) {
    ledgerLines.push(line);
  }
  return ledgerLines;
}

function addLedgerGuides(
  parent: SVGElement,
  centers: readonly number[],
  notes: readonly TargetNote[],
  stave: Stave,
): void {
  const ledgerLines = getLedgerLines(notes);
  centers.forEach((centerX) => {
    ledgerLines.forEach((line) => {
      const guide = document.createElementNS("http://www.w3.org/2000/svg", "line");
      guide.setAttribute("class", "staff-recall-ledger-guide");
      const halfWidth = logicalPx(
        STAFF_RECALL_LAYOUT.ledgerGuideHalfWidthPx,
        STAFF_RECALL_LAYOUT.notationScale,
      );
      guide.setAttribute("x1", String(centerX - halfWidth));
      guide.setAttribute("x2", String(centerX + halfWidth));
      guide.setAttribute("y1", String(stave.getYForNote(line)));
      guide.setAttribute("y2", String(stave.getYForNote(line)));
      parent.appendChild(guide);
    });
  });
}

function addStatusText({
  active,
  centerX,
  comparisonMedianMs,
  parent,
  state,
}: {
  active: boolean;
  centerX: number;
  comparisonMedianMs?: number;
  parent: SVGElement;
  state: StaffRecallColumnState;
}): void {
  const status = document.createElementNS("http://www.w3.org/2000/svg", "text");
  status.setAttribute("class", "staff-recall-column-status");
  status.setAttribute("x", String(centerX));
  status.setAttribute("text-anchor", "middle");

  const addLine = (text: string, lineIndex: 0 | 1 | 2, className?: string): void => {
    const line = document.createElementNS("http://www.w3.org/2000/svg", "tspan");
    line.setAttribute("x", String(centerX));
    line.setAttribute("y", String(getStatusLineY(lineIndex)));
    if (className) {
      line.setAttribute("class", className);
    }
    line.textContent = text;
    status.appendChild(line);
  };

  if (state.activeMs !== undefined) {
    addLine("本次", 0, "status-label");
    addLine(formatMs(state.activeMs), 1, "status-value");
    if (comparisonMedianMs !== undefined) {
      const delta = formatStaffRecallDeltaMs(state.activeMs - comparisonMedianMs);
      if (delta) {
        addLine(delta.text, 2, delta.direction);
      }
    }
  } else if (active) {
    addLine("计时中", 1, "status-value");
  } else if (comparisonMedianMs !== undefined) {
    addLine("中位", 0, "status-label");
    addLine(formatMs(comparisonMedianMs), 1, "status-value");
  }
  parent.appendChild(status);
}

function noteById(notes: readonly TargetNote[], noteId: TargetNoteId | undefined): TargetNote | undefined {
  return noteId ? notes.find((note) => note.id === noteId) : undefined;
}

function isColumnMasked(
  noteName: NoteName,
  state: StaffRecallColumnState,
  activeNoteName: NoteName | undefined,
  runCompleted: boolean,
): boolean {
  if (runCompleted) {
    return false;
  }
  if (activeNoteName) {
    return noteName !== activeNoteName;
  }
  return state.activeMs !== undefined;
}

export function StaffRecallMap({
  activeNoteName,
  columnStates,
  columns,
  comparisonMedianMsByNoteName,
  inputNotes,
  onPlacement,
  runCompleted,
}: StaffRecallMapProps): JSX.Element {
  const frameRef = useRef<HTMLDivElement | null>(null);
  const rendererTargetRef = useRef<HTMLDivElement | null>(null);
  const geometryRef = useRef<MapGeometry | null>(null);
  const [hovered, setHovered] = useState<{ columnNoteName: NoteName; targetNoteId: TargetNoteId } | null>(null);

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
      const displayWidth = Math.max(1, Math.floor(frame.clientWidth || frame.parentElement?.clientWidth || 1));
      const displayHeight = STAFF_RECALL_LAYOUT.vertical.viewHeightPx;
      // 悬浮音改变时会重画 SVG；先固定容器高度，避免清空节点触发页面滚动锚定。
      rendererTarget.style.height = `${displayHeight}px`;
      rendererTarget.innerHTML = "";
      const surface = createStaffRenderSurface(
        rendererTarget,
        displayWidth,
        displayHeight,
        STAFF_RECALL_LAYOUT.notationScale,
      );
      const { context, svg } = surface;
      frame.style.setProperty(
        "--staff-recall-status-font-size",
        `${logicalPx(STAFF_RECALL_LAYOUT.status.fontSizePx, surface.scale)}px`,
      );
      frame.style.setProperty(
        "--staff-recall-status-label-font-size",
        `${logicalPx(STAFF_RECALL_LAYOUT.status.labelFontSizePx, surface.scale)}px`,
      );
      frame.style.setProperty(
        "--staff-recall-status-value-font-size",
        `${logicalPx(STAFF_RECALL_LAYOUT.status.valueFontSizePx, surface.scale)}px`,
      );
      const frameMetrics = getResponsiveStaffFrame(surface, columns.length, STAFF_RECALL_LAYOUT.horizontal);
      const includeLedgerVariants = inputNotes.some((note) => note.isLedgerVariant);
      const clefGapPx = (
        includeLedgerVariants
          ? STAFF_RECALL_LAYOUT.vertical.ledgerGapPx
          : STAFF_RECALL_LAYOUT.vertical.gapPx
      );
      const anchors = getGrandStaffAnchors(
        surface.scale,
        STAFF_RECALL_LAYOUT.vertical.centerYPx,
        clefGapPx,
      );
      const grandStaff = drawGrandStaff(context, frameMetrics, anchors, { brace: true });
      const { bass, treble } = grandStaff;

      const trebleInputNotes = inputNotes.filter((note) => note.staff === "treble").sort(compareTargetNotePitch);
      const bassInputNotes = inputNotes.filter((note) => note.staff === "bass").sort(compareTargetNotePitch);
      const commonNoteStartX = Math.max(treble.getNoteStartX(), bass.getNoteStartX());
      treble.setNoteStartX(commonNoteStartX);
      bass.setNoteStartX(commonNoteStartX);
      const noteArea = getGrandStaffNoteArea(
        grandStaff,
        columns.length,
        surface.scale,
        STAFF_RECALL_LAYOUT.horizontal,
      );
      const centers = getEvenlySpacedCenters(columns.length, noteArea.left, noteArea.right);
      addLedgerGuides(svg, centers, trebleInputNotes, treble);
      addLedgerGuides(svg, centers, bassInputNotes, bass);

      const correctNotesForColumn = (column: NoteNameColumn, staff: Staff): TargetNote[] => {
        const correctIds = new Set(columnStates[column.noteName].correctNoteIds);
        return column.notes.filter((note) => note.staff === staff && correctIds.has(note.id));
      };
      formatAndDrawLayer({
        bass,
        bassTickables: columns.map((column) => makeChord(correctNotesForColumn(column, "bass"), "bass", CORRECT_COLOR)),
        centers,
        context,
        noteAreaLeft: noteArea.left,
        noteAreaRight: noteArea.right,
        treble,
        trebleTickables: columns.map((column) => makeChord(correctNotesForColumn(column, "treble"), "treble", CORRECT_COLOR)),
      });

      const wrongNoteForColumn = (column: NoteNameColumn, staff: Staff): TargetNote[] => {
        const note = noteById(inputNotes, columnStates[column.noteName].wrongNoteId);
        return note?.staff === staff ? [note] : [];
      };
      formatAndDrawLayer({
        bass,
        bassTickables: columns.map((column) => makeChord(wrongNoteForColumn(column, "bass"), "bass", WRONG_COLOR)),
        centers,
        context,
        noteAreaLeft: noteArea.left,
        noteAreaRight: noteArea.right,
        treble,
        trebleTickables: columns.map((column) => makeChord(wrongNoteForColumn(column, "treble"), "treble", WRONG_COLOR)),
      });

      const hoverNoteForColumn = (column: NoteNameColumn, staff: Staff): TargetNote[] => {
        if (hovered?.columnNoteName !== column.noteName) {
          return [];
        }
        const note = noteById(inputNotes, hovered.targetNoteId);
        if (!note || note.staff !== staff || columnStates[column.noteName].correctNoteIds.includes(note.id)) {
          return [];
        }
        return [note];
      };
      formatAndDrawLayer({
        bass,
        bassTickables: columns.map((column) => makeChord(hoverNoteForColumn(column, "bass"), "bass", HOVER_COLOR)),
        centers,
        context,
        noteAreaLeft: noteArea.left,
        noteAreaRight: noteArea.right,
        treble,
        trebleTickables: columns.map((column) => makeChord(hoverNoteForColumn(column, "treble"), "treble", HOVER_COLOR)),
      });

      const placements = [
        ...getPlacements(trebleInputNotes, treble),
        ...getPlacements(bassInputNotes, bass),
      ];
      const columnGeometry = columns.map((column, index): ColumnGeometry => {
        const { left, right } = getColumnBounds(centers, index, surface.width);
        return {
          centerX: centers[index],
          left,
          noteName: column.noteName,
          placements,
          right,
        };
      });
      columnGeometry.forEach((geometry, index) => {
        const column = columns[index];
        const state = columnStates[column.noteName];
        const masked = isColumnMasked(column.noteName, state, activeNoteName, runCompleted);
        if (masked) {
          const mask = document.createElementNS("http://www.w3.org/2000/svg", "rect");
          mask.setAttribute("class", "staff-recall-column-mask");
          mask.setAttribute("x", String(geometry.left));
          mask.setAttribute("y", String(logicalPx(STAFF_RECALL_LAYOUT.overlay.maskTopPx, surface.scale)));
          mask.setAttribute("width", String(Math.max(1, geometry.right - geometry.left)));
          mask.setAttribute(
            "height",
            String(
              logicalPx(
                STAFF_RECALL_LAYOUT.overlay.maskBottomPx - STAFF_RECALL_LAYOUT.overlay.maskTopPx,
                surface.scale,
              ),
            ),
          );
          svg.appendChild(mask);
        } else if (activeNoteName === column.noteName) {
          const active = document.createElementNS("http://www.w3.org/2000/svg", "rect");
          active.setAttribute("class", "staff-recall-column-active");
          active.setAttribute("x", String(geometry.left + 4));
          active.setAttribute("y", String(logicalPx(STAFF_RECALL_LAYOUT.overlay.maskTopPx, surface.scale)));
          active.setAttribute("width", String(Math.max(1, geometry.right - geometry.left - 8)));
          active.setAttribute(
            "height",
            String(
              logicalPx(
                STAFF_RECALL_LAYOUT.overlay.maskBottomPx - STAFF_RECALL_LAYOUT.overlay.maskTopPx,
                surface.scale,
              ),
            ),
          );
          active.setAttribute("rx", "8");
          svg.insertBefore(active, svg.firstChild);
        }
      });

      const uiGroup = context.openGroup("staff-recall-ui");
      columnGeometry.forEach((geometry, index) => {
        const column = columns[index];
        const state = columnStates[column.noteName];
        addStatusText({
          active: activeNoteName === column.noteName,
          centerX: geometry.centerX,
          comparisonMedianMs: comparisonMedianMsByNoteName[column.noteName],
          parent: uiGroup,
          state,
        });
      });
      context
        .setFont("Inter", logicalPx(STAFF_RECALL_LAYOUT.labels.noteNameFontSizePx, surface.scale), 800)
        .setFillStyle(NEUTRAL_COLOR);
      columnGeometry.forEach((geometry) => {
        drawCenteredText(
          context,
          geometry.noteName,
          geometry.centerX,
          logicalPx(STAFF_RECALL_LAYOUT.labels.noteNameYPx, surface.scale),
        );
      });
      context
        .setFont("Inter", logicalPx(STAFF_RECALL_LAYOUT.labels.fixedDoNumberFontSizePx, surface.scale), 700)
        .setFillStyle(MUTED_COLOR);
      columnGeometry.forEach((geometry, index) => {
        drawCenteredText(
          context,
          columns[index].answerNumber,
          geometry.centerX,
          logicalPx(
            STAFF_RECALL_LAYOUT.labels.noteNameYPx + STAFF_RECALL_LAYOUT.labels.lineGapPx,
            surface.scale,
          ),
        );
      });
      context.closeGroup();

      geometryRef.current = {
        columns: columnGeometry,
        height: surface.height,
        placementHitRadius:
          treble.getSpacingBetweenLines() * STAFF_RECALL_LAYOUT.placementHitRadiusInStaffSpaces,
        width: surface.width,
        x: 0,
        y: 0,
      };
    }

    render();
    const observer = new ResizeObserver(render);
    observer.observe(frame);
    return () => observer.disconnect();
  }, [activeNoteName, columnStates, columns, comparisonMedianMsByNoteName, hovered, inputNotes, runCompleted]);

  const hitTest = useCallback((clientX: number, clientY: number): { columnNoteName: NoteName; note: TargetNote } | null => {
    const rendererTarget = rendererTargetRef.current;
    const geometry = geometryRef.current;
    const svg = rendererTarget?.querySelector("svg");
    if (!geometry || !svg) {
      return null;
    }
    const bounds = svg.getBoundingClientRect();
    if (bounds.width <= 0 || bounds.height <= 0) {
      return null;
    }
    const x = geometry.x + ((clientX - bounds.left) / bounds.width) * geometry.width;
    const y = geometry.y + ((clientY - bounds.top) / bounds.height) * geometry.height;
    const column = geometry.columns.find((candidate) => x >= candidate.left && x <= candidate.right);
    if (!column) {
      return null;
    }
    const state = columnStates[column.noteName];
    if (isColumnMasked(column.noteName, state, activeNoteName, runCompleted) || runCompleted) {
      return null;
    }
    const nearest = column.placements.reduce<{ distance: number; placement: PlacementGeometry } | undefined>(
      (best, placement) => {
        const distance = Math.abs(placement.y - y);
        return !best || distance < best.distance ? { distance, placement } : best;
      },
      undefined,
    );
    if (!nearest || nearest.distance > geometry.placementHitRadius) {
      return null;
    }
    return { columnNoteName: column.noteName, note: nearest.placement.note };
  }, [activeNoteName, columnStates, runCompleted]);

  const handlePointerMove = useCallback((event: ReactPointerEvent<HTMLDivElement>): void => {
    if (event.pointerType === "touch") {
      setHovered((current) => (current === null ? current : null));
      return;
    }
    const hit = hitTest(event.clientX, event.clientY);
    setHovered((current) => {
      if (!hit) {
        return current === null ? current : null;
      }
      if (current?.columnNoteName === hit.columnNoteName && current.targetNoteId === hit.note.id) {
        return current;
      }
      return { columnNoteName: hit.columnNoteName, targetNoteId: hit.note.id };
    });
  }, [hitTest]);

  const handleClick = useCallback((event: ReactMouseEvent<HTMLDivElement>): void => {
    const hit = hitTest(event.clientX, event.clientY);
    if (hit) {
      onPlacement(hit.columnNoteName, hit.note);
    }
  }, [hitTest, onPlacement]);

  return (
    <div className="staff-recall-scroll">
      <div
        aria-label="默写大谱表"
        className="staff-recall-map"
        onClick={handleClick}
        onPointerLeave={() => setHovered(null)}
        onPointerMove={handlePointerMove}
        ref={frameRef}
      >
        <div className="staff-recall-map-renderer" ref={rendererTargetRef} />
      </div>
    </div>
  );
}
