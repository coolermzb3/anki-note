import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Formatter, Renderer, StaveNote, Voice } from "vexflow";
import { playTargetNote, startTargetNote, type SustainedPianoNote } from "../audio/piano";
import { formatTargetNoteLabel, getNotesForGroups, noteToVexKey } from "../domain/notes";
import {
  buildNoteNameColumns,
  compareTargetNotePitch,
  dedupeTargetNotePitches,
  NOTE_NAME_COLUMNS,
  type NoteNameColumn,
  type NoteNameColumnDefinition,
} from "../domain/staffRecall";
import type { AppSettings, NoteName, Staff, StaffRecallRunRecord, TargetNote } from "../domain/types";
import { GlobalRangeControls } from "./GlobalRangeControls";
import {
  StudyDisplayControls,
  STUDY_COLUMN_ORDER_OPTIONS,
  type StudyColumnOrderId,
} from "./StudyDisplayControls";
import { StaffRecallView } from "./StaffRecallView";
import { STUDY_STAFF_LAYOUT } from "./staffLayoutProfiles";
import {
  alignStaveNotesToCenters,
  createStaffRenderSurface,
  drawGrandStaff,
  getEvenlySpacedCenters,
  getGrandStaffAnchors,
  getGrandStaffNoteArea,
  getResponsiveStaffFrame,
  logicalPx,
  staveNoteCenterX,
  type StaffRenderSurface,
} from "./staffGeometry";
import { useLocalStorageState } from "./useLocalStorageState";

type FixedStudyColumnOrderId = Exclude<StudyColumnOrderId, "random">;
interface StudyUiPreferences {
  columnOrderId: StudyColumnOrderId;
  isColumnOrderReversed: boolean;
  showLabels: boolean;
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
const FIXED_STUDY_COLUMN_ANSWER_NUMBERS: Record<FixedStudyColumnOrderId, readonly string[]> = {
  circle: ["4", "1", "5", "2", "6", "3", "7"],
  scale: ["1", "2", "3", "4", "5", "6", "7"],
  thirds: ["1", "3", "5", "7", "2", "4", "6"],
};
const DEFAULT_STUDY_UI_PREFERENCES: StudyUiPreferences = {
  columnOrderId: "circle",
  isColumnOrderReversed: false,
  showLabels: true,
};
interface HeldColumnPlayback {
  cancelled: boolean;
  noteName: NoteName;
  releases: Array<SustainedPianoNote["release"]>;
}

interface StudyNoteMapProps {
  columns: NoteNameColumn[];
  highlightedNoteId?: string;
  highlightedNoteNames?: ReadonlySet<NoteName>;
  includeLedgerVariants: boolean;
  label: string;
  onPlayColumn: (noteName: NoteName) => void;
  onPlayNote: (note: TargetNote) => void;
  showLabels: boolean;
}

interface StudyMapContentProps {
  settings: AppSettings;
}

export interface StaffRecallStartPreflightResult {
  proceed: boolean;
}

interface StudyViewProps {
  onBeforeStaffRecallStart: () => Promise<StaffRecallStartPreflightResult>;
  onDataChanged: () => void | Promise<void>;
  onStaffRecallFinished?: () => void;
  onSettingsSaved: (settings: AppSettings) => void | Promise<void>;
  settings: AppSettings;
  staffRecallRuns: StaffRecallRunRecord[];
}

interface StudyMapMetrics {
  bassY: number;
  fixedDoNumberY: number;
  height: number;
  labelHitHeight: number;
  labelHitTop: number;
  staveWidth: number;
  noteNameY: number;
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
    showLabels: typeof value.showLabels === "boolean" ? value.showLabels : fallback.showLabels,
  };
}

interface StudyColumnLayout {
  centerX: number;
  highlightWidth: number;
}

function shuffleStudyAnswerNumbers(): string[] {
  const answerNumbers = NOTE_NAME_COLUMNS.map((column) => column.answerNumber);
  for (let index = answerNumbers.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(Math.random() * (index + 1));
    [answerNumbers[index], answerNumbers[swapIndex]] = [answerNumbers[swapIndex], answerNumbers[index]];
  }
  return answerNumbers;
}

function getStudyColumnDefinitions(
  orderId: StudyColumnOrderId,
  isReversed: boolean,
  randomAnswerNumbers: readonly string[],
): NoteNameColumnDefinition[] {
  const answerNumbers = orderId === "random" ? randomAnswerNumbers : FIXED_STUDY_COLUMN_ANSWER_NUMBERS[orderId];
  const orderedAnswerNumbers = isReversed ? [...answerNumbers].reverse() : answerNumbers;
  return orderedAnswerNumbers.map((answerNumber) => {
    const column = NOTE_NAME_COLUMNS.find((candidate) => candidate.answerNumber === answerNumber);
    if (!column) {
      throw new Error(`Unknown study column number: ${answerNumber}`);
    }
    return column;
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

function noteHeadCenterX(chord: StaveNote, index: number): number {
  const noteHead = chord.noteHeads[index];
  return noteHead ? noteHead.getAbsoluteX() + noteHead.getWidth() / 2 : staveNoteCenterX(chord);
}

function noteHeadHitRadius(chord: StaveNote, index: number): number {
  return chord.noteHeads[index]?.getWidth() ?? chord.getGlyphWidth();
}

function getStudyMapMetrics(
  includeLedgerVariants: boolean,
  surface: StaffRenderSurface,
  columnCount: number,
): StudyMapMetrics {
  const frame = getResponsiveStaffFrame(surface, columnCount, STUDY_STAFF_LAYOUT.horizontal);
  const clefGapPx = includeLedgerVariants
    ? STUDY_STAFF_LAYOUT.vertical.ledgerGapPx
    : STUDY_STAFF_LAYOUT.vertical.gapPx;
  const anchors = getGrandStaffAnchors(
    surface.scale,
    STUDY_STAFF_LAYOUT.vertical.centerYPx,
    clefGapPx,
  );
  const noteNameY = logicalPx(STUDY_STAFF_LAYOUT.labels.noteNameYPx, surface.scale);
  const fixedDoNumberY = noteNameY + logicalPx(STUDY_STAFF_LAYOUT.labels.lineGapPx, surface.scale);
  const labelHitTop = noteNameY - logicalPx(
    STUDY_STAFF_LAYOUT.labels.noteNameFontSizePx + STUDY_STAFF_LAYOUT.labelHitPaddingPx,
    surface.scale,
  );
  return {
    bassY: anchors.bassY,
    fixedDoNumberY,
    height: surface.height,
    labelHitHeight:
      fixedDoNumberY -
      labelHitTop +
      logicalPx(
        STUDY_STAFF_LAYOUT.labels.fixedDoNumberFontSizePx + STUDY_STAFF_LAYOUT.labelHitPaddingPx,
        surface.scale,
      ),
    labelHitTop,
    staveWidth: frame.staveWidth,
    noteNameY,
    trebleY: anchors.trebleY,
    width: surface.width,
    x: frame.x,
  };
}

function getStudyColumnLayouts(tickables: StaveNote[], scale: number): StudyColumnLayout[] {
  const centers = tickables.map(staveNoteCenterX);
  const spacingPadding = logicalPx(STUDY_STAFF_LAYOUT.columnHighlight.spacingPaddingPx, scale);
  const maxWidth = logicalPx(STUDY_STAFF_LAYOUT.columnHighlight.maxWidthPx, scale);
  return centers.map((centerX, index) => {
    const neighborDistances = [
      index > 0 ? centerX - centers[index - 1] : undefined,
      index < centers.length - 1 ? centers[index + 1] - centerX : undefined,
    ].filter((distance): distance is number => distance !== undefined);
    const spacingWidth =
      (neighborDistances.length > 0
        ? Math.min(...neighborDistances) - spacingPadding * 2
        : maxWidth);
    return {
      centerX,
      highlightWidth: Math.max(1, Math.min(maxWidth, spacingWidth)),
    };
  });
}

function addColumnHighlight(svg: SVGSVGElement, layout: StudyColumnLayout, metrics: StudyMapMetrics): void {
  const highlight = document.createElementNS("http://www.w3.org/2000/svg", "rect");
  highlight.setAttribute("class", "study-column-highlight");
  highlight.setAttribute("x", String(layout.centerX - layout.highlightWidth / 2));
  highlight.setAttribute("y", String(metrics.labelHitTop));
  highlight.setAttribute("width", String(layout.highlightWidth));
  highlight.setAttribute(
    "height",
    String(
      metrics.height -
        metrics.labelHitTop -
        logicalPx(
          STUDY_STAFF_LAYOUT.columnHighlight.bottomPaddingPx,
          STUDY_STAFF_LAYOUT.notationScale,
        ),
    ),
  );
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
  showLabels,
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
      const surface = createStaffRenderSurface(
        rendererTarget,
        containerWidth,
        STUDY_STAFF_LAYOUT.vertical.viewHeightPx,
        STUDY_STAFF_LAYOUT.notationScale,
      );
      const metrics = getStudyMapMetrics(includeLedgerVariants, surface, columns.length);
      const { context, svg } = surface;
      const grandStaff = drawGrandStaff(
        context,
        { x: metrics.x, staveWidth: metrics.staveWidth },
        { bassY: metrics.bassY, trebleY: metrics.trebleY },
        { brace: true },
      );
      const { bass, treble } = grandStaff;

      const trebleTickables = columns.map((column) =>
        makeChord(column.trebleNotes, "treble", highlightedNoteNames, highlightedNoteId),
      );
      const bassTickables = columns.map((column) =>
        makeChord(column.bassNotes, "bass", highlightedNoteNames, highlightedNoteId),
      );
      const voiceOptions = { beatValue: 4, numBeats: Math.max(1, columns.length) * 4 };
      const trebleVoice = new Voice(voiceOptions).addTickables(trebleTickables);
      const bassVoice = new Voice(voiceOptions).addTickables(bassTickables);

      const noteArea = getGrandStaffNoteArea(
        grandStaff,
        columns.length,
        surface.scale,
        STUDY_STAFF_LAYOUT.horizontal,
      );
      treble.setNoteStartX(noteArea.left);
      bass.setNoteStartX(noteArea.left);
      treble.setWidth(Math.max(1, noteArea.right - metrics.x));
      bass.setWidth(Math.max(1, noteArea.right - metrics.x));
      new Formatter().joinVoices([trebleVoice, bassVoice]).formatToStave([trebleVoice, bassVoice], treble, {
        context,
        stave: treble,
      });
      alignStaveNotesToCenters(
        trebleTickables,
        getEvenlySpacedCenters(columns.length, noteArea.left, noteArea.right),
      );
      trebleVoice.draw(context, treble);
      bassVoice.draw(context, bass);
      const columnLayouts = getStudyColumnLayouts(trebleTickables, surface.scale);

      if (svg && highlightedNoteNames && highlightedNoteNames.size > 0) {
        columns.forEach((column, index) => {
          if (highlightedNoteNames.has(column.noteName)) {
            addColumnHighlight(svg, columnLayouts[index], metrics);
          }
        });
      }

      if (showLabels) {
        context
          .setFont("Inter", logicalPx(STUDY_STAFF_LAYOUT.labels.noteNameFontSizePx, surface.scale), 800)
          .setFillStyle(NEUTRAL_COLOR);
        columns.forEach((column, index) => {
          const centerX = columnLayouts[index].centerX;
          drawCenteredText(context, column.noteName, centerX, metrics.noteNameY);
        });
        context
          .setFont("Inter", logicalPx(STUDY_STAFF_LAYOUT.labels.fixedDoNumberFontSizePx, surface.scale), 700)
          .setFillStyle(MUTED_COLOR);
        columns.forEach((column, index) => {
          const centerX = columnLayouts[index].centerX;
          drawCenteredText(context, column.answerNumber, centerX, metrics.fixedDoNumberY);
        });
      }

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
  }, [columns, highlightedNoteId, highlightedNoteNames, includeLedgerVariants, onPlayColumn, onPlayNote, showLabels]);

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

function StudyMapContent({ settings }: StudyMapContentProps): JSX.Element {
  const [studyUiPreferences, setStudyUiPreferences] = useLocalStorageState(
    STUDY_UI_PREFERENCES_KEY,
    DEFAULT_STUDY_UI_PREFERENCES,
    { parse: parseStudyUiPreferences },
  );
  const [highlightedNoteNames, setHighlightedNoteNames] = useState<ReadonlySet<NoteName>>(() => new Set());
  const [highlightedNoteId, setHighlightedNoteId] = useState<string | undefined>();
  const [randomAnswerNumbers, setRandomAnswerNumbers] = useState(() => shuffleStudyAnswerNumbers());
  const columnOrderId = studyUiPreferences.columnOrderId;
  const isColumnOrderReversed = studyUiPreferences.isColumnOrderReversed;
  const showLabels = studyUiPreferences.showLabels;
  const setColumnOrderId = (nextColumnOrderId: StudyColumnOrderId): void => {
    if (nextColumnOrderId === "random") {
      setRandomAnswerNumbers(shuffleStudyAnswerNumbers());
    }
    setStudyUiPreferences((current) => ({ ...current, columnOrderId: nextColumnOrderId }));
  };
  const setIsColumnOrderReversed = (nextIsColumnOrderReversed: boolean): void => {
    setStudyUiPreferences((current) => ({ ...current, isColumnOrderReversed: nextIsColumnOrderReversed }));
  };
  const setShowLabels = (nextShowLabels: boolean): void => {
    setStudyUiPreferences((current) => ({ ...current, showLabels: nextShowLabels }));
  };
  const columnFlashTimerRef = useRef<number | undefined>();
  const flashedColumnRef = useRef<NoteName | undefined>();
  const noteFlashTimerRef = useRef<number | undefined>();
  const heldColumnsRef = useRef(new Map<string, HeldColumnPlayback>());
  const columnDefinitions = useMemo(
    () => getStudyColumnDefinitions(columnOrderId, isColumnOrderReversed, randomAnswerNumbers),
    [columnOrderId, isColumnOrderReversed, randomAnswerNumbers],
  );
  const studyNotes = useMemo(
    () => getNotesForGroups(settings.enabledGroupIds, settings.includeLedgerVariants),
    [settings.enabledGroupIds, settings.includeLedgerVariants],
  );
  const columns = useMemo(() => buildNoteNameColumns(studyNotes, columnDefinitions), [columnDefinitions, studyNotes]);
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
        for (const note of dedupeTargetNotePitches(column.notes).sort(compareTargetNotePitch)) {
          void playTargetNote(note).catch(() => undefined);
          await delay(STUDY_STAFF_LAYOUT.columnNoteDelayMs);
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
        for (const note of dedupeTargetNotePitches(column.notes).sort(compareTargetNotePitch)) {
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
          if (STUDY_STAFF_LAYOUT.columnNoteDelayMs > 0) {
            await delay(STUDY_STAFF_LAYOUT.columnNoteDelayMs);
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
      const column = NOTE_NAME_COLUMNS.find((candidate) => candidate.answerNumber === event.key);
      if (column) {
        event.preventDefault();
        if (!event.repeat) {
          startHeldColumn(event.key, column.noteName);
        }
      }
    }

    function handleKeyUp(event: KeyboardEvent): void {
      const column = NOTE_NAME_COLUMNS.find((candidate) => candidate.answerNumber === event.key);
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
    <>
      <StudyDisplayControls
        columnOrderId={columnOrderId}
        isColumnOrderReversed={isColumnOrderReversed}
        label="学习页显示设置"
        onColumnOrderChange={setColumnOrderId}
        onColumnOrderReversedChange={setIsColumnOrderReversed}
        onShowLabelsChange={setShowLabels}
        showLabels={showLabels}
      />
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
            showLabels={showLabels}
          />
        </figure>
      </div>
    </>
  );
}

export function StudyView({
  onBeforeStaffRecallStart,
  onDataChanged,
  onSettingsSaved,
  onStaffRecallFinished,
  settings,
  staffRecallRuns,
}: StudyViewProps): JSX.Element {
  const [mode, setMode] = useState<"study" | "staff-recall">("study");
  const [enteringStaffRecall, setEnteringStaffRecall] = useState(false);
  const [staffRecallRangeLocked, setStaffRecallRangeLocked] = useState(false);

  const enterStaffRecall = useCallback(async (): Promise<void> => {
    if (mode === "staff-recall" || enteringStaffRecall) {
      return;
    }
    setEnteringStaffRecall(true);
    try {
      const result = await onBeforeStaffRecallStart();
      if (result.proceed) {
        setMode("staff-recall");
      }
    } finally {
      setEnteringStaffRecall(false);
    }
  }, [enteringStaffRecall, mode, onBeforeStaffRecallStart]);

  const enterStudy = useCallback((): void => {
    setStaffRecallRangeLocked(false);
    setMode("study");
  }, []);

  useEffect(() => {
    if (mode !== "staff-recall") {
      return;
    }
    function handleKeyDown(event: KeyboardEvent): void {
      if (event.key === "Escape") {
        event.preventDefault();
        enterStudy();
      }
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [enterStudy, mode]);

  return (
    <section className="study-shell">
      <GlobalRangeControls
        disabled={mode === "staff-recall" && staffRecallRangeLocked}
        settings={settings}
        onSettingsSaved={onSettingsSaved}
      />
      <div className="study-header">
        <h1 className="sr-only">学习</h1>
        <div className="segmented study-mode-options" aria-label="学习模式">
          <button className={mode === "study" ? "active" : ""} onClick={enterStudy} type="button">
            学习
          </button>
          <button
            className={mode === "staff-recall" ? "active" : ""}
            disabled={enteringStaffRecall}
            onClick={() => void enterStaffRecall()}
            type="button"
          >
            {enteringStaffRecall ? "检查中" : "默写"}
          </button>
        </div>
        {mode === "staff-recall" && staffRecallRangeLocked ? (
          <span className="study-range-lock-hint">完成本轮或切回学习后可调整音域</span>
        ) : null}
      </div>
      {mode === "study" ? (
        <StudyMapContent settings={settings} />
      ) : (
        <StaffRecallView
          onDataChanged={onDataChanged}
          onFinished={onStaffRecallFinished}
          onRangeLockedChange={setStaffRecallRangeLocked}
          runs={staffRecallRuns}
          settings={settings}
        />
      )}
    </section>
  );
}
