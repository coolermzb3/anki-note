import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Formatter, Renderer, Stave, StaveConnector, StaveNote, Voice } from "vexflow";
import { playTargetNote, startTargetNote, type SustainedPianoNote } from "../audio/piano";
import { formatTargetNoteLabel, getNotesForGroups, noteToVexKey } from "../domain/notes";
import type { AppSettings, NoteName, Staff, TargetNote } from "../domain/types";
import { GlobalRangeControls } from "./GlobalRangeControls";
import { useLocalStorageState } from "./useLocalStorageState";

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
interface StudyUiPreferences {
  columnOrderId: StudyColumnOrderId;
  isColumnOrderReversed: boolean;
}

const NOTE_DURATION = "w";
const NEUTRAL_COLOR = "#211c18";
const MUTED_COLOR = "#766b5f";
const ACTIVE_COLOR = "#2f8f5f";
const ACTIVE_FILL = "rgba(47, 143, 95, 0.16)";
const TRANSPARENT_NOTE_COLOR = "rgba(0, 0, 0, 0)";
const KEY_FLASH_MS = 360;
const NOTE_FLASH_MS = 260;
const STUDY_UI_PREFERENCES_KEY = "anki-note.studyUiPreferences";
const DEFAULT_STUDY_UI_PREFERENCES: StudyUiPreferences = {
  columnOrderId: "circle",
  isColumnOrderReversed: false,
};
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

  // y: SVG 的基础上下留白，影响学习图整体高度。
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
}

interface StudyViewProps {
  settings: AppSettings;
  onSettingsSaved: (settings: AppSettings) => void | Promise<void>;
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isStudyColumnOrderId(value: unknown): value is StudyColumnOrderId {
  return (
    typeof value === "string" &&
    STUDY_COLUMN_ORDER_OPTIONS.some((option) => option.id === value)
  );
}

function parseStudyUiPreferences(value: unknown, fallback: StudyUiPreferences): StudyUiPreferences {
  if (!isRecord(value)) {
    return fallback;
  }

  return {
    columnOrderId: isStudyColumnOrderId(value.columnOrderId) ? value.columnOrderId : fallback.columnOrderId,
    isColumnOrderReversed:
      typeof value.isColumnOrderReversed === "boolean"
        ? value.isColumnOrderReversed
        : fallback.isColumnOrderReversed,
  };
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

function getStudyColumns(notes: TargetNote[], columnDefinitions: StudyColumnDefinition[]): StudyColumn[] {
  return columnDefinitions.map((column) => {
    const columnNotes = notes.filter((note) => note.noteName === column.noteName).sort(comparePitch);
    return {
      ...column,
      bassNotes: columnNotes.filter((note) => note.staff === "bass"),
      notes: columnNotes,
      trebleNotes: columnNotes.filter((note) => note.staff === "treble"),
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
  const hasNotes = notes.length > 0;
  const chord = new StaveNote({
    clef: staff,
    duration: NOTE_DURATION,
    keys: hasNotes ? notes.map(noteToVexKey) : [staff === "treble" ? "b/4" : "d/3"],
  });
  const baseColor = hasNotes ? (columnHighlighted ? ACTIVE_COLOR : NEUTRAL_COLOR) : TRANSPARENT_NOTE_COLOR;
  chord.setStyle({ fillStyle: baseColor, strokeStyle: baseColor });
  chord.setLedgerLineStyle({ fillStyle: baseColor, strokeStyle: baseColor });
  if (hasNotes && !columnHighlighted && highlightedNoteId) {
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
  svg,
}: {
  layout: StudyColumnLayout;
  metrics: StudyMapMetrics;
  noteName: NoteName;
  onPlayColumn: (noteName: NoteName) => void;
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
    onPlayColumn(noteName);
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
  svg,
  x,
  y,
}: {
  note: TargetNote;
  onPlayNote: (note: TargetNote) => void;
  radius: number;
  showHitArea: boolean;
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
    onPlayNote(note);
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
  svg,
}: {
  chord: StaveNote;
  highlightedNoteId?: string;
  notes: TargetNote[];
  onPlayNote: (note: TargetNote) => void;
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
}: StudyNoteMapProps): JSX.Element {
  const frameRef = useRef<HTMLDivElement | null>(null);
  const rendererTargetRef = useRef<HTMLDivElement | null>(null);

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
          svg,
        });
        addNoteHotspots({
          chord: trebleTickables[index],
          highlightedNoteId,
          notes: column.trebleNotes,
          onPlayNote,
          svg,
        });
        addNoteHotspots({
          chord: bassTickables[index],
          highlightedNoteId,
          notes: column.bassNotes,
          onPlayNote,
          svg,
        });
      });
    }

    render();
    const observer = new ResizeObserver(render);
    observer.observe(frame);
    return () => observer.disconnect();
  }, [columns, highlightedNoteId, highlightedNoteNames, includeLedgerVariants, onPlayColumn, onPlayNote]);

  return (
    <div ref={frameRef} className="study-map" aria-label={label}>
      <div ref={rendererTargetRef} className="study-map-renderer" />
    </div>
  );
}

function isFormControlTarget(target: EventTarget | null): boolean {
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

export function StudyView({ settings, onSettingsSaved }: StudyViewProps): JSX.Element {
  const [studyUiPreferences, setStudyUiPreferences] = useLocalStorageState(
    STUDY_UI_PREFERENCES_KEY,
    DEFAULT_STUDY_UI_PREFERENCES,
    { parse: parseStudyUiPreferences },
  );
  const [highlightedNoteNames, setHighlightedNoteNames] = useState<ReadonlySet<NoteName>>(() => new Set());
  const [highlightedNoteId, setHighlightedNoteId] = useState<string | undefined>();
  const columnOrderId = studyUiPreferences.columnOrderId;
  const isColumnOrderReversed = studyUiPreferences.isColumnOrderReversed;
  const setColumnOrderId = (nextColumnOrderId: StudyColumnOrderId): void => {
    setStudyUiPreferences((current) => ({ ...current, columnOrderId: nextColumnOrderId }));
  };
  const setIsColumnOrderReversed = (nextIsColumnOrderReversed: boolean): void => {
    setStudyUiPreferences((current) => ({ ...current, isColumnOrderReversed: nextIsColumnOrderReversed }));
  };
  const columnFlashTimerRef = useRef<number | undefined>();
  const flashedColumnRef = useRef<NoteName | undefined>();
  const noteFlashTimerRef = useRef<number | undefined>();
  const heldColumnsRef = useRef(new Map<string, HeldColumnPlayback>());
  const columnDefinitions = useMemo(
    () => getStudyColumnDefinitions(columnOrderId, isColumnOrderReversed),
    [columnOrderId, isColumnOrderReversed],
  );
  const studyNotes = useMemo(
    () => getNotesForGroups(settings.enabledGroupIds, settings.includeLedgerVariants),
    [settings.enabledGroupIds, settings.includeLedgerVariants],
  );
  const columns = useMemo(() => getStudyColumns(studyNotes, columnDefinitions), [columnDefinitions, studyNotes]);
  const showInterStaffLedger = studyNotes.some((note) => note.isLedgerVariant);

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
      releaseAllHeldColumns();
    };
  }, [releaseAllHeldColumns]);

  useEffect(() => {
    releaseAllHeldColumns();
  }, [columns, releaseAllHeldColumns]);

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
      if (isFormControlTarget(event.target)) {
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
  }, [releaseHeldColumn, startHeldColumn]);

  return (
    <section className="study-shell">
      <GlobalRangeControls settings={settings} onSettingsSaved={onSettingsSaved} />
      <div className="study-header">
        <div className="study-title">
          <h1>学习</h1>
        </div>
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
      <div className="study-map-frame" aria-label="学习页音位图">
        <figure className="study-figure">
          <StudyNoteMap
            columns={columns}
            highlightedNoteId={highlightedNoteId}
            highlightedNoteNames={highlightedNoteNames}
            includeLedgerVariants={showInterStaffLedger}
            label="F1-G6 音符位置"
            onPlayColumn={playColumn}
            onPlayNote={playNote}
          />
        </figure>
      </div>
    </section>
  );
}
