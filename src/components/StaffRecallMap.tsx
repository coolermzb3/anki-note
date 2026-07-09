import { useCallback, useEffect, useRef, useState, type MouseEvent as ReactMouseEvent, type PointerEvent as ReactPointerEvent } from "react";
import { Formatter, Renderer, Stave, StaveConnector, StaveNote, Voice } from "vexflow";
import { noteToVexKey } from "../domain/notes";
import { compareTargetNotePitch, formatStaffRecallDeltaMs, type NoteNameColumn } from "../domain/staffRecall";
import { formatMs } from "../domain/stats";
import type { NoteName, Staff, TargetNote, TargetNoteId } from "../domain/types";

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
  width: number;
}

const NOTE_DURATION = "w";
const TRANSPARENT = "rgba(0, 0, 0, 0)";
const NEUTRAL_COLOR = "#211c18";
const MUTED_COLOR = "#766b5f";
const CORRECT_COLOR = "#2f8f5f";
const WRONG_COLOR = "#c84c3d";
const HOVER_COLOR = "rgba(37, 111, 103, 0.42)";
const RECALL_MAP_LAYOUT = {
  // 默写谱表排版在这里手调。VexFlow 使用下方逻辑尺寸绘制，再由 SVG viewBox 整体放大。
  scale: 2,
  height: 730,

  // x: 宽度不足时依次压缩谱表外侧空白、音符区域空白和列距。
  staffSidePadding: 50,
  clefReserveWidth: 72, // 预留给谱号 无需调整
  noteAreaSidePadding: 40,
  minNoteAreaSidePadding: 18,
  preferredColumnGap: 36,

  // y: 高低音谱表锚点的中点；调整它可整体上下移动大谱表。
  staffCenterY: 120,

  clefGap: {
    default: 72,
    withLedgerVariants: 130,
  },
  labelY: 26,
  answerNumberY: 38,
  statusLineGap: 11,
  statusBottomPadding: 15,
  maskTop: 62,
  maskBottom: 412,
  ledgerGuideHalfWidth: 10,
  placementHitRadius: 5,
};

function getStatusLineY(lineIndex: 0 | 1 | 2): number {
  const lastLineY = RECALL_MAP_LAYOUT.height / RECALL_MAP_LAYOUT.scale - RECALL_MAP_LAYOUT.statusBottomPadding;
  return lastLineY - (2 - lineIndex) * RECALL_MAP_LAYOUT.statusLineGap;
}

function columnCenterX(note: StaveNote): number {
  return (note.getNoteHeadBeginX() + note.getNoteHeadEndX()) / 2;
}

function alignTickablesToCenters(tickables: StaveNote[], centers: readonly number[]): void {
  tickables.forEach((tickable, index) => {
    const center = centers[index];
    if (center === undefined) {
      return;
    }
    const tickContext = tickable.checkTickContext();
    tickContext.setX(tickContext.getX() + center - columnCenterX(tickable));
  });
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
  alignTickablesToCenters(trebleTickables, centers);
  trebleVoice.draw(context, treble);
  bassVoice.draw(context, bass);
}

function drawCenteredText(context: ReturnType<Renderer["getContext"]>, text: string, x: number, y: number): void {
  const { width } = context.measureText(text);
  context.fillText(text, x - width / 2, y);
}

function getEvenlySpacedCenters(count: number, left: number, right: number): number[] {
  if (count <= 0) {
    return [];
  }
  if (count === 1) {
    return [(left + right) / 2];
  }
  const span = Math.max(1, right - left);
  return Array.from({ length: count }, (_, index) => left + (span * index) / (count - 1));
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
  svg: SVGSVGElement,
  centers: readonly number[],
  notes: readonly TargetNote[],
  stave: Stave,
): void {
  const ledgerLines = getLedgerLines(notes);
  centers.forEach((centerX) => {
    ledgerLines.forEach((line) => {
      const guide = document.createElementNS("http://www.w3.org/2000/svg", "line");
      guide.setAttribute("class", "staff-recall-ledger-guide");
      guide.setAttribute("x1", String(centerX - RECALL_MAP_LAYOUT.ledgerGuideHalfWidth));
      guide.setAttribute("x2", String(centerX + RECALL_MAP_LAYOUT.ledgerGuideHalfWidth));
      guide.setAttribute("y1", String(stave.getYForNote(line)));
      guide.setAttribute("y2", String(stave.getYForNote(line)));
      svg.appendChild(guide);
    });
  });
}

function addStatusText({
  active,
  centerX,
  comparisonMedianMs,
  state,
  svg,
}: {
  active: boolean;
  centerX: number;
  comparisonMedianMs?: number;
  state: StaffRecallColumnState;
  svg: SVGSVGElement;
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
  svg.appendChild(status);
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
      const displayHeight = RECALL_MAP_LAYOUT.height;
      // 悬浮音改变时会重画 SVG；先固定容器高度，避免清空节点触发页面滚动锚定。
      rendererTarget.style.height = `${displayHeight}px`;
      rendererTarget.innerHTML = "";
      const width = displayWidth / RECALL_MAP_LAYOUT.scale;
      const height = displayHeight / RECALL_MAP_LAYOUT.scale;
      const renderer = new Renderer(rendererTarget, Renderer.Backends.SVG);
      renderer.resize(displayWidth, displayHeight);
      const context = renderer.getContext();
      context.scale(RECALL_MAP_LAYOUT.scale, RECALL_MAP_LAYOUT.scale);
      const svg = rendererTarget.querySelector("svg");
      const preferredMapContentWidth =
        RECALL_MAP_LAYOUT.clefReserveWidth +
        Math.max(0, columns.length - 1) * RECALL_MAP_LAYOUT.preferredColumnGap +
        RECALL_MAP_LAYOUT.noteAreaSidePadding * 2;
      const staffSidePadding = Math.min(
        RECALL_MAP_LAYOUT.staffSidePadding,
        Math.max(0, (width - preferredMapContentWidth) / 2),
      );
      const staveWidth = Math.max(1, width - staffSidePadding * 2);
      const includeLedgerVariants = inputNotes.some((note) => note.isLedgerVariant);
      const clefGap = (
        includeLedgerVariants
          ? RECALL_MAP_LAYOUT.clefGap.withLedgerVariants
          : RECALL_MAP_LAYOUT.clefGap.default
      );
      const trebleY = RECALL_MAP_LAYOUT.staffCenterY - clefGap / 2;
      const bassY = RECALL_MAP_LAYOUT.staffCenterY + clefGap / 2;
      const treble = new Stave(
        staffSidePadding,
        trebleY,
        staveWidth,
      ).addClef("treble");
      const bass = new Stave(
        staffSidePadding,
        bassY,
        staveWidth,
      ).addClef("bass");
      treble.setContext(context).draw();
      bass.setContext(context).draw();
      new StaveConnector(treble, bass).setType("brace").setContext(context).draw();
      new StaveConnector(treble, bass).setType("singleLeft").setContext(context).draw();
      new StaveConnector(treble, bass).setType("singleRight").setContext(context).draw();

      const trebleInputNotes = inputNotes.filter((note) => note.staff === "treble").sort(compareTargetNotePitch);
      const bassInputNotes = inputNotes.filter((note) => note.staff === "bass").sort(compareTargetNotePitch);
      const commonNoteStartX = Math.max(treble.getNoteStartX(), bass.getNoteStartX());
      treble.setNoteStartX(commonNoteStartX);
      bass.setNoteStartX(commonNoteStartX);
      const noteEndX = Math.min(treble.getNoteEndX(), bass.getNoteEndX());
      const preferredColumnAreaWidth = Math.max(0, columns.length - 1) * RECALL_MAP_LAYOUT.preferredColumnGap;
      const noteAreaSidePadding = Math.min(
        RECALL_MAP_LAYOUT.noteAreaSidePadding,
        Math.max(
          RECALL_MAP_LAYOUT.minNoteAreaSidePadding,
          (noteEndX - commonNoteStartX - preferredColumnAreaWidth) / 2,
        ),
      );
      const noteAreaLeft = commonNoteStartX + noteAreaSidePadding;
      const noteAreaRight = noteEndX - noteAreaSidePadding;
      const centers = getEvenlySpacedCenters(columns.length, noteAreaLeft, noteAreaRight);
      if (svg) {
        addLedgerGuides(svg, centers, trebleInputNotes, treble);
        addLedgerGuides(svg, centers, bassInputNotes, bass);
      }

      const correctNotesForColumn = (column: NoteNameColumn, staff: Staff): TargetNote[] => {
        const correctIds = new Set(columnStates[column.noteName].correctNoteIds);
        return column.notes.filter((note) => note.staff === staff && correctIds.has(note.id));
      };
      formatAndDrawLayer({
        bass,
        bassTickables: columns.map((column) => makeChord(correctNotesForColumn(column, "bass"), "bass", CORRECT_COLOR)),
        centers,
        context,
        noteAreaLeft,
        noteAreaRight,
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
        noteAreaLeft,
        noteAreaRight,
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
        noteAreaLeft,
        noteAreaRight,
        treble,
        trebleTickables: columns.map((column) => makeChord(hoverNoteForColumn(column, "treble"), "treble", HOVER_COLOR)),
      });

      const placements = [
        ...getPlacements(trebleInputNotes, treble),
        ...getPlacements(bassInputNotes, bass),
      ];
      const columnGeometry = columns.map((column, index): ColumnGeometry => {
        const { left, right } = getColumnBounds(centers, index, width);
        return {
          centerX: centers[index],
          left,
          noteName: column.noteName,
          placements,
          right,
        };
      });
      geometryRef.current = { columns: columnGeometry, height, width };

      if (!svg) {
        return;
      }
      columnGeometry.forEach((geometry, index) => {
        const column = columns[index];
        const state = columnStates[column.noteName];
        const masked = isColumnMasked(column.noteName, state, activeNoteName, runCompleted);
        if (masked) {
          const mask = document.createElementNS("http://www.w3.org/2000/svg", "rect");
          mask.setAttribute("class", "staff-recall-column-mask");
          mask.setAttribute("x", String(geometry.left));
          mask.setAttribute("y", String(RECALL_MAP_LAYOUT.maskTop));
          mask.setAttribute("width", String(Math.max(1, geometry.right - geometry.left)));
          mask.setAttribute("height", String(RECALL_MAP_LAYOUT.maskBottom - RECALL_MAP_LAYOUT.maskTop));
          svg.appendChild(mask);
        } else if (activeNoteName === column.noteName) {
          const active = document.createElementNS("http://www.w3.org/2000/svg", "rect");
          active.setAttribute("class", "staff-recall-column-active");
          active.setAttribute("x", String(geometry.left + 4));
          active.setAttribute("y", String(RECALL_MAP_LAYOUT.maskTop));
          active.setAttribute("width", String(Math.max(1, geometry.right - geometry.left - 8)));
          active.setAttribute("height", String(RECALL_MAP_LAYOUT.maskBottom - RECALL_MAP_LAYOUT.maskTop));
          active.setAttribute("rx", "8");
          svg.insertBefore(active, svg.firstChild);
        }
        addStatusText({
          active: activeNoteName === column.noteName,
          centerX: geometry.centerX,
          comparisonMedianMs: comparisonMedianMsByNoteName[column.noteName],
          state,
          svg,
        });
      });
      context
        .setFont("Inter", 18 / RECALL_MAP_LAYOUT.scale, 800)
        .setFillStyle(NEUTRAL_COLOR);
      columnGeometry.forEach((geometry) => {
        drawCenteredText(context, geometry.noteName, geometry.centerX, RECALL_MAP_LAYOUT.labelY);
      });
      context
        .setFont("Inter", 12 / RECALL_MAP_LAYOUT.scale, 700)
        .setFillStyle(MUTED_COLOR);
      columnGeometry.forEach((geometry, index) => {
        drawCenteredText(context, columns[index].answerNumber, geometry.centerX, RECALL_MAP_LAYOUT.answerNumberY);
      });
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
    const x = ((clientX - bounds.left) / bounds.width) * geometry.width;
    const y = ((clientY - bounds.top) / bounds.height) * geometry.height;
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
    if (!nearest || nearest.distance > RECALL_MAP_LAYOUT.placementHitRadius) {
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
