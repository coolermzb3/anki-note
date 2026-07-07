import { ChevronLeft, ChevronRight } from "lucide-react";
import { type MutableRefObject, type PointerEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Formatter, Renderer, Stave, StaveConnector, StaveNote, Voice } from "vexflow";
import { playTargetNote, startTargetNote, type SustainedPianoNote } from "../audio/piano";
import { ALL_NOTES, formatTargetNoteLabel, noteToVexKey } from "../domain/notes";
import type { NoteName, Staff, TargetNote } from "../domain/types";

const NOTE_COLUMNS_BY_KEY: Array<{ answerNumber: string; noteName: NoteName }> = [
  { answerNumber: "1", noteName: "C" },
  { answerNumber: "2", noteName: "D" },
  { answerNumber: "3", noteName: "E" },
  { answerNumber: "4", noteName: "F" },
  { answerNumber: "5", noteName: "G" },
  { answerNumber: "6", noteName: "A" },
  { answerNumber: "7", noteName: "B" },
];

const STUDY_COLUMN_ORDER_OPTIONS = [
  { id: "circle", label: "4152637", answerNumbers: ["4", "1", "5", "2", "6", "3", "7"] },
  { id: "scale", label: "1234567", answerNumbers: ["1", "2", "3", "4", "5", "6", "7"] },
  { id: "thirds", label: "1357246", answerNumbers: ["1", "3", "5", "7", "2", "4", "6"] },
] as const;

type StudyColumnOrderId = (typeof STUDY_COLUMN_ORDER_OPTIONS)[number]["id"];
type StudyColumnDefinition = (typeof NOTE_COLUMNS_BY_KEY)[number];

const SLIDES = [
  {
    id: "single-spelling",
    title: "F1-G6 音符位置",
    description: " ",
    includeLedgerVariants: false,
  },
  {
    id: "ledger-variants",
    title: "F1-G6 音符位置(含重叠区高低音谱号)",
    description: " ",
    includeLedgerVariants: true,
  },
] as const;

const NOTE_DURATION = "w";
const NEUTRAL_COLOR = "#211c18";
const MUTED_COLOR = "#766b5f";
const ACTIVE_COLOR = "#2f8f5f";
const ACTIVE_FILL = "rgba(47, 143, 95, 0.16)";
const KEY_FLASH_MS = 360;
const NOTE_FLASH_MS = 260;
const SLIDE_ANIMATION_MS = 280;
const DRAG_SWITCH_PX = 52;
const NOTE_NAME_ORDER: Record<NoteName, number> = {
  C: 0,
  D: 1,
  E: 2,
  F: 3,
  G: 4,
  A: 5,
  B: 6,
};

// 学习页五线谱排版在这里手调。
const STUDY_MAP_LAYOUT = {
  // x: 压缩判断用常量；谱号占用的保守宽度，通常先不调。
  clefReserveWidth: 72,

  // x: 压缩判断用常量；相邻列中心的目标距离，通常先不调。
  preferredColumnGap: 76,

  // x: 五线谱到画布左右边缘的空白。
  staffSidePadding: 200,
  // x: 音符区域到五线谱左右边缘的空白；剩余宽度决定音符间距。
  noteAreaSidePadding: 80,
  // x: 窄屏时音符区域到五线谱左右边缘至少保留的空白。
  minNoteAreaSidePadding: 40,

  // y: 五线谱组到画布上下边缘的空白。
  staffVerticalPadding: 120,
  // y: 高低音谱号之间的间隔，按图分别设置。
  clefGap: {
    default: 80,
    withLedgerVariants: 140,
  },
  // y: 下方 label 到高音谱号五线谱的间隔。
  labelStaffGap: 52,
  // y: 上下两行 label 之间的间隔。
  labelLineGap: 22,
  topLabelFontSize: 18,
  bottomLabelFontSize: 12,
  // x: 整列高亮框的最大宽度。
  columnHighlightMaxWidth: 74,
  // x: 整列高亮框到相邻列中心距离保留的空白。
  columnHighlightSpacingPadding: 8,

  // 音符播放间隔，单位毫秒。
  columnNoteDelayMs: 0,
};

const STAVE_RENDER_HEIGHT = 160;
const LABEL_HIT_PADDING = 10;

const COMMON_STUDY_MAP_HEIGHT =
  STUDY_MAP_LAYOUT.staffVerticalPadding * 2 +
  Math.max(STUDY_MAP_LAYOUT.clefGap.default, STUDY_MAP_LAYOUT.clefGap.withLedgerVariants) +
  STAVE_RENDER_HEIGHT;

type SlideDirection = "next" | "previous";
interface StudyTransition {
  direction: SlideDirection;
  fromIndex: number;
  toIndex: number;
}

interface HeldColumnPlayback {
  cancelled: boolean;
  noteName: NoteName;
  releases: Array<SustainedPianoNote["release"]>;
}

interface StudyColumn {
  answerNumber: string;
  bassNotes: TargetNote[];
  noteName: NoteName;
  notes: TargetNote[];
  trebleNotes: TargetNote[];
}

interface StudyNoteMapProps {
  columns: StudyColumn[];
  highlightedNoteId?: string;
  highlightedNoteNames?: ReadonlySet<NoteName>;
  includeLedgerVariants: boolean;
  label: string;
  onPlayColumn: (noteName: NoteName) => void;
  onPlayNote: (note: TargetNote) => void;
  onSwipe: (direction: "next" | "previous") => void;
}

interface StudyMapMetrics {
  bassY: number;
  bottomLabelY: number;
  height: number;
  labelHitHeight: number;
  labelHitTop: number;
  noteAreaSidePadding: number;
  staveWidth: number;
  topLabelY: number;
  trebleY: number;
  width: number;
  x: number;
}

interface StudyColumnLayout {
  centerX: number;
  highlightWidth: number;
}

function pitchOrder(note: Pick<TargetNote, "noteName" | "octave">): number {
  return note.octave * 7 + NOTE_NAME_ORDER[note.noteName];
}

function comparePitch(left: TargetNote, right: TargetNote): number {
  return pitchOrder(left) - pitchOrder(right);
}

function getStudyColumnDefinitions(orderId: StudyColumnOrderId, isReversed: boolean): StudyColumnDefinition[] {
  const order = STUDY_COLUMN_ORDER_OPTIONS.find((option) => option.id === orderId) ?? STUDY_COLUMN_ORDER_OPTIONS[0];
  const answerNumbers = isReversed ? [...order.answerNumbers].reverse() : order.answerNumbers;
  return answerNumbers.map((answerNumber) => {
    const column = NOTE_COLUMNS_BY_KEY.find((candidate) => candidate.answerNumber === answerNumber);
    if (!column) {
      throw new Error(`Unknown study column number: ${answerNumber}`);
    }
    return column;
  });
}

function getStudyColumns(includeLedgerVariants: boolean, columnDefinitions: StudyColumnDefinition[]): StudyColumn[] {
  return columnDefinitions.map((column) => {
    const notes = ALL_NOTES.filter(
      (note) => note.noteName === column.noteName && (includeLedgerVariants || !note.isLedgerVariant),
    ).sort(comparePitch);
    return {
      ...column,
      bassNotes: notes.filter((note) => note.staff === "bass"),
      notes,
      trebleNotes: notes.filter((note) => note.staff === "treble"),
    };
  });
}

function dedupePitches(notes: TargetNote[]): TargetNote[] {
  const seen = new Set<string>();
  return notes.filter((note) => {
    if (seen.has(note.pitchId)) {
      return false;
    }
    seen.add(note.pitchId);
    return true;
  });
}

function makeChord(
  notes: TargetNote[],
  staff: Staff,
  highlightedNoteNames: ReadonlySet<NoteName> | undefined,
  highlightedNoteId: string | undefined,
): StaveNote {
  const columnHighlighted = notes.some((note) => highlightedNoteNames?.has(note.noteName) ?? false);
  const chord = new StaveNote({
    clef: staff,
    duration: NOTE_DURATION,
    keys: notes.map(noteToVexKey),
  });
  const baseColor = columnHighlighted ? ACTIVE_COLOR : NEUTRAL_COLOR;
  chord.setStyle({ fillStyle: baseColor, strokeStyle: baseColor });
  chord.setLedgerLineStyle({ fillStyle: baseColor, strokeStyle: baseColor });
  if (!columnHighlighted && highlightedNoteId) {
    notes.forEach((note, index) => {
      if (note.id === highlightedNoteId) {
        chord.setKeyStyle(index, { fillStyle: ACTIVE_COLOR, strokeStyle: ACTIVE_COLOR });
      }
    });
  }
  return chord;
}

function drawCenteredText(context: ReturnType<Renderer["getContext"]>, text: string, x: number, y: number): void {
  const { width } = context.measureText(text);
  context.fillText(text, x - width / 2, y);
}

function columnCenterX(chord: StaveNote): number {
  return (chord.getNoteHeadBeginX() + chord.getNoteHeadEndX()) / 2;
}

function noteHeadCenterX(chord: StaveNote, index: number): number {
  const noteHead = chord.noteHeads[index];
  return noteHead ? noteHead.getAbsoluteX() + noteHead.getWidth() / 2 : columnCenterX(chord);
}

function noteHeadHitRadius(chord: StaveNote, index: number): number {
  return chord.noteHeads[index]?.getWidth() ?? chord.getGlyphWidth();
}

function getResponsiveHorizontalPadding(width: number, columnCount: number): { noteAreaSidePadding: number; staffSidePadding: number } {
  const preferredNoteAreaWidth =
    STUDY_MAP_LAYOUT.clefReserveWidth + Math.max(0, columnCount - 1) * STUDY_MAP_LAYOUT.preferredColumnGap;
  const staffSidePadding = Math.min(
    STUDY_MAP_LAYOUT.staffSidePadding,
    Math.max(0, (width - preferredNoteAreaWidth - STUDY_MAP_LAYOUT.noteAreaSidePadding * 2) / 2),
  );
  const staveWidth = Math.max(1, width - staffSidePadding * 2);
  const noteAreaSidePadding = Math.min(
    STUDY_MAP_LAYOUT.noteAreaSidePadding,
    Math.max(STUDY_MAP_LAYOUT.minNoteAreaSidePadding, (staveWidth - preferredNoteAreaWidth) / 2),
  );

  return { noteAreaSidePadding, staffSidePadding };
}

function getStudyMapMetrics(includeLedgerVariants: boolean, containerWidth: number, columnCount: number): StudyMapMetrics {
  const width = Math.max(1, containerWidth);
  const { noteAreaSidePadding, staffSidePadding } = getResponsiveHorizontalPadding(width, columnCount);
  const clefGap = includeLedgerVariants ? STUDY_MAP_LAYOUT.clefGap.withLedgerVariants : STUDY_MAP_LAYOUT.clefGap.default;
  const trebleY = (COMMON_STUDY_MAP_HEIGHT - clefGap - STAVE_RENDER_HEIGHT) / 2;
  const bassY = trebleY + clefGap;
  const topLabelY = trebleY - STUDY_MAP_LAYOUT.labelStaffGap - STUDY_MAP_LAYOUT.labelLineGap;
  const bottomLabelY = trebleY - STUDY_MAP_LAYOUT.labelStaffGap;
  const labelHitTop = topLabelY - STUDY_MAP_LAYOUT.topLabelFontSize - LABEL_HIT_PADDING;
  return {
    bassY,
    bottomLabelY,
    height: COMMON_STUDY_MAP_HEIGHT,
    labelHitHeight: bottomLabelY - labelHitTop + STUDY_MAP_LAYOUT.bottomLabelFontSize + LABEL_HIT_PADDING,
    labelHitTop,
    noteAreaSidePadding,
    staveWidth: Math.max(1, width - staffSidePadding * 2),
    topLabelY,
    trebleY,
    width,
    x: staffSidePadding,
  };
}

function getStudyColumnLayouts(tickables: StaveNote[]): StudyColumnLayout[] {
  const centers = tickables.map(columnCenterX);
  return centers.map((centerX, index) => {
    const neighborDistances = [
      index > 0 ? centerX - centers[index - 1] : undefined,
      index < centers.length - 1 ? centers[index + 1] - centerX : undefined,
    ].filter((distance): distance is number => distance !== undefined);
    const spacingWidth =
      (neighborDistances.length > 0
        ? Math.min(...neighborDistances) - STUDY_MAP_LAYOUT.columnHighlightSpacingPadding * 2
        : STUDY_MAP_LAYOUT.columnHighlightMaxWidth);
    return {
      centerX,
      highlightWidth: Math.max(1, Math.min(STUDY_MAP_LAYOUT.columnHighlightMaxWidth, spacingWidth)),
    };
  });
}

function alignStudyColumnsToNoteArea(tickables: StaveNote[], noteAreaLeft: number, noteAreaRight: number): void {
  if (tickables.length < 2) {
    return;
  }

  const span = Math.max(1, noteAreaRight - noteAreaLeft);
  tickables.forEach((tickable, index) => {
    const targetCenterX = noteAreaLeft + (span * index) / (tickables.length - 1);
    const context = tickable.checkTickContext();
    context.setX(context.getX() + targetCenterX - columnCenterX(tickable));
  });
}

function addColumnHighlight(svg: SVGSVGElement, layout: StudyColumnLayout, metrics: StudyMapMetrics): void {
  const highlight = document.createElementNS("http://www.w3.org/2000/svg", "rect");
  highlight.setAttribute("class", "study-column-highlight");
  highlight.setAttribute("x", String(layout.centerX - layout.highlightWidth / 2));
  highlight.setAttribute("y", String(metrics.labelHitTop));
  highlight.setAttribute("width", String(layout.highlightWidth));
  highlight.setAttribute("height", String(metrics.height - metrics.labelHitTop - STUDY_MAP_LAYOUT.staffVerticalPadding / 2));
  highlight.setAttribute("rx", "8");
  highlight.setAttribute("fill", ACTIVE_FILL);
  highlight.setAttribute("stroke", ACTIVE_COLOR);
  highlight.setAttribute("stroke-width", "1");
  svg.insertBefore(highlight, svg.firstChild);
}

function addLabelHotspot({
  layout,
  metrics,
  noteName,
  onPlayColumn,
  skipClickRef,
  svg,
}: {
  layout: StudyColumnLayout;
  metrics: StudyMapMetrics;
  noteName: NoteName;
  onPlayColumn: (noteName: NoteName) => void;
  skipClickRef: MutableRefObject<boolean>;
  svg: SVGSVGElement;
}): void {
  const hotspot = document.createElementNS("http://www.w3.org/2000/svg", "rect");
  hotspot.setAttribute("class", "study-label-hotspot");
  hotspot.setAttribute("x", String(layout.centerX - layout.highlightWidth / 2));
  hotspot.setAttribute("y", String(metrics.labelHitTop));
  hotspot.setAttribute("width", String(layout.highlightWidth));
  hotspot.setAttribute("height", String(metrics.labelHitHeight));
  hotspot.setAttribute("role", "button");
  hotspot.setAttribute("tabindex", "0");
  hotspot.setAttribute("aria-label", `播放 ${noteName} 列`);
  hotspot.addEventListener("click", (event) => {
    event.stopPropagation();
    if (!skipClickRef.current) {
      onPlayColumn(noteName);
    }
  });
  hotspot.addEventListener("keydown", (event) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      onPlayColumn(noteName);
    }
  });
  svg.appendChild(hotspot);
}

function addNoteHotspot({
  note,
  onPlayNote,
  radius,
  showHitArea,
  skipClickRef,
  svg,
  x,
  y,
}: {
  note: TargetNote;
  onPlayNote: (note: TargetNote) => void;
  radius: number;
  showHitArea: boolean;
  skipClickRef: MutableRefObject<boolean>;
  svg: SVGSVGElement;
  x: number;
  y: number;
}): void {
  const hotspot = document.createElementNS("http://www.w3.org/2000/svg", "circle");
  hotspot.setAttribute("class", showHitArea ? "study-note-hotspot active" : "study-note-hotspot");
  hotspot.setAttribute("cx", String(x));
  hotspot.setAttribute("cy", String(y));
  hotspot.setAttribute("r", String(radius));
  hotspot.setAttribute("role", "button");
  hotspot.setAttribute("tabindex", "0");
  hotspot.setAttribute("aria-label", `播放 ${formatTargetNoteLabel(note)}`);
  hotspot.addEventListener("click", (event) => {
    event.stopPropagation();
    if (!skipClickRef.current) {
      onPlayNote(note);
    }
  });
  hotspot.addEventListener("keydown", (event) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      onPlayNote(note);
    }
  });
  svg.appendChild(hotspot);
}

function addNoteHotspots({
  chord,
  highlightedNoteId,
  notes,
  onPlayNote,
  skipClickRef,
  svg,
}: {
  chord: StaveNote;
  highlightedNoteId?: string;
  notes: TargetNote[];
  onPlayNote: (note: TargetNote) => void;
  skipClickRef: MutableRefObject<boolean>;
  svg: SVGSVGElement;
}): void {
  const ys = chord.getYs();
  notes.forEach((note, index) => {
    const x = noteHeadCenterX(chord, index);
    const y = ys[index];
    if (y === undefined) {
      return;
    }
    addNoteHotspot({
      note,
      onPlayNote,
      radius: noteHeadHitRadius(chord, index),
      showHitArea: note.id === highlightedNoteId,
      skipClickRef,
      svg,
      x,
      y,
    });
  });
}

function StudyNoteMap({
  columns,
  highlightedNoteId,
  highlightedNoteNames,
  includeLedgerVariants,
  label,
  onPlayColumn,
  onPlayNote,
  onSwipe,
}: StudyNoteMapProps): JSX.Element {
  const frameRef = useRef<HTMLDivElement | null>(null);
  const rendererTargetRef = useRef<HTMLDivElement | null>(null);
  const dragStartRef = useRef<{ x: number; y: number } | null>(null);
  const skipClickRef = useRef(false);

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
      const measuredWidth = frame.getBoundingClientRect().width || frame.clientWidth || frame.parentElement?.clientWidth || 1;
      const containerWidth = Math.max(1, Math.floor(measuredWidth));
      const metrics = getStudyMapMetrics(includeLedgerVariants, containerWidth, columns.length);
      const renderer = new Renderer(rendererTarget, Renderer.Backends.SVG);
      renderer.resize(metrics.width, metrics.height);
      const context = renderer.getContext();
      const svg = rendererTarget.querySelector("svg");
      const treble = new Stave(metrics.x, metrics.trebleY, metrics.staveWidth).addClef("treble");
      const bass = new Stave(metrics.x, metrics.bassY, metrics.staveWidth).addClef("bass");

      treble.setContext(context).draw();
      bass.setContext(context).draw();
      new StaveConnector(treble, bass).setType("brace").setContext(context).draw();
      new StaveConnector(treble, bass).setType("singleLeft").setContext(context).draw();
      new StaveConnector(treble, bass).setType("singleRight").setContext(context).draw();

      const trebleTickables = columns.map((column) =>
        makeChord(column.trebleNotes, "treble", highlightedNoteNames, highlightedNoteId),
      );
      const bassTickables = columns.map((column) =>
        makeChord(column.bassNotes, "bass", highlightedNoteNames, highlightedNoteId),
      );
      const voiceOptions = { beatValue: 4, numBeats: Math.max(1, columns.length) * 4 };
      const trebleVoice = new Voice(voiceOptions).addTickables(trebleTickables);
      const bassVoice = new Voice(voiceOptions).addTickables(bassTickables);

      const noteAreaLeft = Math.max(treble.getNoteStartX(), bass.getNoteStartX()) + metrics.noteAreaSidePadding;
      const noteAreaRight = Math.min(treble.getNoteEndX(), bass.getNoteEndX()) - metrics.noteAreaSidePadding;
      treble.setNoteStartX(noteAreaLeft);
      treble.setWidth(Math.max(1, noteAreaRight - metrics.x));
      new Formatter().joinVoices([trebleVoice, bassVoice]).formatToStave([trebleVoice, bassVoice], treble, {
        context,
        stave: treble,
      });
      alignStudyColumnsToNoteArea(trebleTickables, noteAreaLeft, noteAreaRight);
      trebleVoice.draw(context, treble);
      bassVoice.draw(context, bass);
      const columnLayouts = getStudyColumnLayouts(trebleTickables);

      if (svg && highlightedNoteNames && highlightedNoteNames.size > 0) {
        columns.forEach((column, index) => {
          if (highlightedNoteNames.has(column.noteName)) {
            addColumnHighlight(svg, columnLayouts[index], metrics);
          }
        });
      }

      context.setFont("Inter", STUDY_MAP_LAYOUT.topLabelFontSize, 800).setFillStyle(NEUTRAL_COLOR);
      columns.forEach((column, index) => {
        const centerX = columnLayouts[index].centerX;
        drawCenteredText(context, column.noteName, centerX, metrics.topLabelY);
      });
      context.setFont("Inter", STUDY_MAP_LAYOUT.bottomLabelFontSize, 700).setFillStyle(MUTED_COLOR);
      columns.forEach((column, index) => {
        const centerX = columnLayouts[index].centerX;
        drawCenteredText(context, column.answerNumber, centerX, metrics.bottomLabelY);
      });

      if (!svg) {
        return;
      }
      columns.forEach((column, index) => {
        addLabelHotspot({
          layout: columnLayouts[index],
          metrics,
          noteName: column.noteName,
          onPlayColumn,
          skipClickRef,
          svg,
        });
        addNoteHotspots({
          chord: trebleTickables[index],
          highlightedNoteId,
          notes: column.trebleNotes,
          onPlayNote,
          skipClickRef,
          svg,
        });
        addNoteHotspots({
          chord: bassTickables[index],
          highlightedNoteId,
          notes: column.bassNotes,
          onPlayNote,
          skipClickRef,
          svg,
        });
      });
    }

    render();
    const observer = new ResizeObserver(render);
    observer.observe(frame);
    return () => observer.disconnect();
  }, [columns, highlightedNoteId, highlightedNoteNames, includeLedgerVariants, onPlayColumn, onPlayNote]);

  function handlePointerDown(event: PointerEvent<HTMLDivElement>): void {
    if (event.button !== 0) {
      return;
    }
    dragStartRef.current = { x: event.clientX, y: event.clientY };
  }

  function finishPointerDrag(event: PointerEvent<HTMLDivElement>): void {
    const dragStart = dragStartRef.current;
    dragStartRef.current = null;
    if (!dragStart) {
      return;
    }
    const deltaX = event.clientX - dragStart.x;
    const deltaY = event.clientY - dragStart.y;
    if (Math.abs(deltaX) < DRAG_SWITCH_PX || Math.abs(deltaX) < Math.abs(deltaY) * 1.2) {
      return;
    }
    skipClickRef.current = true;
    onSwipe(deltaX < 0 ? "next" : "previous");
    window.setTimeout(() => {
      skipClickRef.current = false;
    }, 180);
  }

  return (
    <div
      ref={frameRef}
      className="study-map"
      aria-label={label}
      onPointerCancel={() => {
        dragStartRef.current = null;
      }}
      onPointerDown={handlePointerDown}
      onPointerUp={finishPointerDrag}
    >
      <div ref={rendererTargetRef} className="study-map-renderer" />
    </div>
  );
}

function isEditableTarget(target: EventTarget | null): boolean {
  return target instanceof HTMLInputElement || target instanceof HTMLSelectElement || target instanceof HTMLTextAreaElement;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    window.setTimeout(resolve, ms);
  });
}

function collectHighlightedNoteNames(heldColumns: Map<string, HeldColumnPlayback>, flashedNoteName?: NoteName): Set<NoteName> {
  const noteNames = new Set<NoteName>();
  heldColumns.forEach((held) => noteNames.add(held.noteName));
  if (flashedNoteName) {
    noteNames.add(flashedNoteName);
  }
  return noteNames;
}

export function StudyView(): JSX.Element {
  const [activeIndex, setActiveIndex] = useState(0);
  const [columnOrderId, setColumnOrderId] = useState<StudyColumnOrderId>("circle");
  const [isColumnOrderReversed, setIsColumnOrderReversed] = useState(false);
  const [highlightedNoteNames, setHighlightedNoteNames] = useState<ReadonlySet<NoteName>>(() => new Set());
  const [highlightedNoteId, setHighlightedNoteId] = useState<string | undefined>();
  const [transition, setTransition] = useState<StudyTransition | null>(null);
  const columnFlashTimerRef = useRef<number | undefined>();
  const flashedColumnRef = useRef<NoteName | undefined>();
  const noteFlashTimerRef = useRef<number | undefined>();
  const slideTimerRef = useRef<number | undefined>();
  const heldColumnsRef = useRef(new Map<string, HeldColumnPlayback>());
  const activeSlide = SLIDES[activeIndex];
  const columnDefinitions = useMemo(
    () => getStudyColumnDefinitions(columnOrderId, isColumnOrderReversed),
    [columnOrderId, isColumnOrderReversed],
  );
  const slideColumns = useMemo(
    () => SLIDES.map((slide) => getStudyColumns(slide.includeLedgerVariants, columnDefinitions)),
    [columnDefinitions],
  );
  const columns = slideColumns[activeIndex];

  const switchSlide = useCallback((nextIndex: number, direction: SlideDirection): void => {
    if (nextIndex === activeIndex) {
      return;
    }
    window.clearTimeout(slideTimerRef.current);
    setTransition({ direction, fromIndex: activeIndex, toIndex: nextIndex });
    setActiveIndex(nextIndex);
    slideTimerRef.current = window.setTimeout(() => setTransition(null), SLIDE_ANIMATION_MS);
  }, [activeIndex]);

  const showPrevious = useCallback((): void => {
    switchSlide(activeIndex === 0 ? SLIDES.length - 1 : activeIndex - 1, "previous");
  }, [activeIndex, switchSlide]);

  const showNext = useCallback((): void => {
    switchSlide((activeIndex + 1) % SLIDES.length, "next");
  }, [activeIndex, switchSlide]);

  const flashColumn = useCallback((noteName: NoteName): void => {
    window.clearTimeout(columnFlashTimerRef.current);
    flashedColumnRef.current = noteName;
    setHighlightedNoteNames(collectHighlightedNoteNames(heldColumnsRef.current, noteName));
    columnFlashTimerRef.current = window.setTimeout(() => {
      if (flashedColumnRef.current !== noteName) {
        return;
      }
      flashedColumnRef.current = undefined;
      setHighlightedNoteNames(collectHighlightedNoteNames(heldColumnsRef.current));
    }, KEY_FLASH_MS);
  }, []);

  const flashNote = useCallback((note: TargetNote): void => {
    window.clearTimeout(noteFlashTimerRef.current);
    setHighlightedNoteId(note.id);
    noteFlashTimerRef.current = window.setTimeout(() => setHighlightedNoteId(undefined), NOTE_FLASH_MS);
  }, []);

  const playNote = useCallback(
    (note: TargetNote): void => {
      flashNote(note);
      void playTargetNote(note).catch(() => undefined);
    },
    [flashNote],
  );

  const playColumn = useCallback(
    (noteName: NoteName): void => {
      const column = columns.find((candidate) => candidate.noteName === noteName);
      if (!column) {
        return;
      }
      flashColumn(noteName);
      void (async () => {
        for (const note of dedupePitches(column.notes).sort(comparePitch)) {
          void playTargetNote(note).catch(() => undefined);
          await delay(STUDY_MAP_LAYOUT.columnNoteDelayMs);
        }
      })();
    },
    [columns, flashColumn],
  );

  const releaseHeldColumn = useCallback((key: string): void => {
    const held = heldColumnsRef.current.get(key);
    if (!held) {
      return;
    }
    held.cancelled = true;
    heldColumnsRef.current.delete(key);
    held.releases.splice(0).forEach((release) => release());
    setHighlightedNoteNames(collectHighlightedNoteNames(heldColumnsRef.current, flashedColumnRef.current));
  }, []);

  const releaseAllHeldColumns = useCallback((): void => {
    Array.from(heldColumnsRef.current.keys()).forEach(releaseHeldColumn);
  }, [releaseHeldColumn]);

  const startHeldColumn = useCallback(
    (key: string, noteName: NoteName): void => {
      if (heldColumnsRef.current.has(key)) {
        return;
      }
      const column = columns.find((candidate) => candidate.noteName === noteName);
      if (!column) {
        return;
      }

      const held: HeldColumnPlayback = { cancelled: false, noteName, releases: [] };
      heldColumnsRef.current.set(key, held);
      setHighlightedNoteNames(collectHighlightedNoteNames(heldColumnsRef.current, flashedColumnRef.current));

      void (async () => {
        for (const note of dedupePitches(column.notes).sort(comparePitch)) {
          if (held.cancelled) {
            break;
          }
          const sustained = await startTargetNote(note).catch(() => undefined);
          if (!sustained) {
            continue;
          }
          if (held.cancelled) {
            sustained.release();
            break;
          }
          held.releases.push(sustained.release);
          if (STUDY_MAP_LAYOUT.columnNoteDelayMs > 0) {
            await delay(STUDY_MAP_LAYOUT.columnNoteDelayMs);
          }
        }
      })();
    },
    [columns],
  );

  useEffect(() => {
    return () => {
      window.clearTimeout(columnFlashTimerRef.current);
      window.clearTimeout(noteFlashTimerRef.current);
      window.clearTimeout(slideTimerRef.current);
      releaseAllHeldColumns();
    };
  }, [releaseAllHeldColumns]);

  useEffect(() => {
    releaseAllHeldColumns();
  }, [activeIndex, columnDefinitions, releaseAllHeldColumns]);

  useEffect(() => {
    function releaseForFocusLoss(): void {
      releaseAllHeldColumns();
    }

    function releaseForVisibilityChange(): void {
      if (document.visibilityState === "hidden") {
        releaseAllHeldColumns();
      }
    }

    window.addEventListener("blur", releaseForFocusLoss);
    document.addEventListener("visibilitychange", releaseForVisibilityChange);
    return () => {
      window.removeEventListener("blur", releaseForFocusLoss);
      document.removeEventListener("visibilitychange", releaseForVisibilityChange);
    };
  }, [releaseAllHeldColumns]);

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent): void {
      if (isEditableTarget(event.target)) {
        return;
      }
      if (event.key === "ArrowLeft") {
        event.preventDefault();
        showPrevious();
        return;
      }
      if (event.key === "ArrowRight") {
        event.preventDefault();
        showNext();
        return;
      }
      const column = NOTE_COLUMNS_BY_KEY.find((candidate) => candidate.answerNumber === event.key);
      if (column) {
        event.preventDefault();
        if (!event.repeat) {
          startHeldColumn(event.key, column.noteName);
        }
      }
    }

    function handleKeyUp(event: KeyboardEvent): void {
      const column = NOTE_COLUMNS_BY_KEY.find((candidate) => candidate.answerNumber === event.key);
      if (column) {
        event.preventDefault();
        releaseHeldColumn(event.key);
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("keyup", handleKeyUp);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("keyup", handleKeyUp);
    };
  }, [releaseHeldColumn, showNext, showPrevious, startHeldColumn]);

  return (
    <section className="study-shell">
      <div className="study-header">
        <div className="study-title">
          <h1>学习</h1>
          <p>{activeSlide.description}</p>
        </div>
        <div className="study-controls" aria-label="学习页显示设置">
          <div className="study-control-block">
            <span className="control-label">顺序</span>
            <div className="segmented study-order-options">
              {STUDY_COLUMN_ORDER_OPTIONS.map((option) => (
                <button
                  key={option.id}
                  type="button"
                  className={columnOrderId === option.id ? "active" : ""}
                  onClick={() => setColumnOrderId(option.id)}
                >
                  {option.label}
                </button>
              ))}
            </div>
          </div>
          <div className="study-control-block">
            <span className="control-label">方向</span>
            <div className="segmented study-direction-options">
              <button
                type="button"
                className={!isColumnOrderReversed ? "active" : ""}
                onClick={() => setIsColumnOrderReversed(false)}
              >
                正序
              </button>
              <button
                type="button"
                className={isColumnOrderReversed ? "active" : ""}
                onClick={() => setIsColumnOrderReversed(true)}
              >
                倒序
              </button>
            </div>
          </div>
        </div>
      </div>
      <div className="study-carousel" aria-label="学习页音位图">
        <button className="study-arrow" aria-label="上一张" onClick={showPrevious}>
          <ChevronLeft size={22} />
        </button>
        <figure className="study-figure">
          {(transition ? [transition.fromIndex, transition.toIndex] : [activeIndex]).map((slideIndex) => {
            const slide = SLIDES[slideIndex];
            const transitionRole =
              transition === null
                ? "active"
                : slideIndex === transition.fromIndex
                  ? `exit-${transition.direction}`
                  : `enter-${transition.direction}`;
            return (
              <div
                key={`${slide.id}-${transitionRole}`}
                className={`study-slide ${transitionRole}`}
                aria-hidden={slideIndex !== activeIndex}
              >
                <figcaption>{slide.title}</figcaption>
                <StudyNoteMap
                  columns={slideColumns[slideIndex]}
                  highlightedNoteId={slideIndex === activeIndex ? highlightedNoteId : undefined}
                  highlightedNoteNames={slideIndex === activeIndex ? highlightedNoteNames : undefined}
                  includeLedgerVariants={slide.includeLedgerVariants}
                  label={slide.title}
                  onPlayColumn={playColumn}
                  onPlayNote={playNote}
                  onSwipe={(direction) => {
                    if (direction === "next") {
                      showNext();
                    } else {
                      showPrevious();
                    }
                  }}
                />
              </div>
            );
          })}
        </figure>
        <button className="study-arrow" aria-label="下一张" onClick={showNext}>
          <ChevronRight size={22} />
        </button>
      </div>
      <div className="study-dots" aria-label="学习图切换">
        {SLIDES.map((slide, index) => (
          <button
            key={slide.id}
            className={index === activeIndex ? "study-dot active" : "study-dot"}
            aria-label={slide.title}
            aria-current={index === activeIndex ? "true" : undefined}
            onClick={() => {
              if (index === activeIndex) {
                return;
              }
              switchSlide(index, index > activeIndex ? "next" : "previous");
            }}
          />
        ))}
      </div>
    </section>
  );
}
