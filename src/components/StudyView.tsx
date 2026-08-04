import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Formatter, Renderer, StaveNote, Voice } from "vexflow";
import { playTargetNote, startTargetNote } from "../audio/piano";
import { formatTargetNoteLabel, getNotesForGroups, noteToVexKey } from "../domain/notes";
import {
  buildNoteNameColumns,
  compareTargetNotePitch,
  dedupeTargetNotePitches,
  NOTE_NAME_COLUMNS,
  type NoteNameColumn,
  type NoteNameColumnDefinition,
} from "../domain/staffRecall";
import type { AppSettings, NoteName, Staff, StaffNotationMode, StaffRecallRunRecord, TargetNote } from "../domain/types";
import { GlobalRangeControls } from "./GlobalRangeControls";
import {
  StudyDisplayControls,
  STUDY_COLUMN_ORDER_OPTIONS,
  type StudyColumnOrderId,
} from "./StudyDisplayControls";
import {
  beginHeldNoteSequence,
  findNearestAnswerPitch,
  getListeningTargetNoteName,
  getStudyPitchPoolKey,
  getUniqueStudyPitches,
  recordListeningAttempt,
  releaseHeldNoteSequence,
  selectFreeSinglePitch,
  selectListeningSelfCheckTarget,
  shouldRerollListeningTarget,
  type HeldNoteSequence,
  type ListeningAttemptState,
  type ListeningSelfCheckTarget,
  type StudyPlaybackMode,
} from "./studyListeningSelfCheck";
import { StaffRecallView } from "./StaffRecallView";
import { STUDY_STAFF_LAYOUT } from "./staffLayoutProfiles";
import {
  alignStaveNotesToCenters,
  createStaffRenderSurface,
  drawStaffSystem,
  getEvenlySpacedCenters,
  getResponsiveStaffFrame,
  logicalPx,
  staveNoteCenterX,
  type StaffRenderSurface,
} from "./staffGeometry";
import { useLocalStorageState } from "./useLocalStorageState";
import { useDelayedBusy } from "./useDelayedBusy";

type FixedStudyColumnOrderId = Exclude<StudyColumnOrderId, "random">;
interface StudyUiPreferences {
  columnOrderId: StudyColumnOrderId;
  isColumnOrderReversed: boolean;
  playbackMode: StudyPlaybackMode;
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
  playbackMode: "octaves",
  showLabels: true,
};
interface HeldKeyboardPlayback extends HeldNoteSequence {
  highlightedNoteName?: NoteName;
  kind: "answer" | "prompt";
}

interface ListeningSelfCheckSession {
  attempt: ListeningAttemptState;
  target?: ListeningSelfCheckTarget;
}

interface StudyNoteMapProps {
  columns: NoteNameColumn[];
  highlightedNoteId?: string;
  highlightedNoteNames?: ReadonlySet<NoteName>;
  staffNotationMode: StaffNotationMode;
  useLedgerGap: boolean;
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
  fixedDoNumberY: number;
  height: number;
  labelHitHeight: number;
  labelHitTop: number;
  staveWidth: number;
  noteNameY: number;
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

function isStudyPlaybackMode(value: unknown): value is StudyPlaybackMode {
  return value === "single" || value === "octaves";
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
    playbackMode: isStudyPlaybackMode(value.playbackMode) ? value.playbackMode : fallback.playbackMode,
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
  surface: StaffRenderSurface,
  columnCount: number,
): StudyMapMetrics {
  const frame = getResponsiveStaffFrame(surface, columnCount, STUDY_STAFF_LAYOUT.horizontal);
  const noteNameY = logicalPx(STUDY_STAFF_LAYOUT.labels.noteNameYPx, surface.scale);
  const fixedDoNumberY = noteNameY + logicalPx(STUDY_STAFF_LAYOUT.labels.lineGapPx, surface.scale);
  const labelHitTop = noteNameY - logicalPx(
    STUDY_STAFF_LAYOUT.labels.noteNameFontSizePx + STUDY_STAFF_LAYOUT.labelHitPaddingPx,
    surface.scale,
  );
  return {
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
  effectiveTargetNoteIds,
  note,
  onPlayNote,
  radius,
  showHitArea,
  svg,
  x,
  y,
}: {
  effectiveTargetNoteIds: ReadonlySet<TargetNote["id"]>;
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
  hotspot.setAttribute("aria-label", `播放 ${formatTargetNoteLabel(note, effectiveTargetNoteIds)}`);
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
  effectiveTargetNoteIds,
  highlightedNoteId,
  notes,
  onPlayNote,
  svg,
}: {
  chord: StaveNote;
  effectiveTargetNoteIds: ReadonlySet<TargetNote["id"]>;
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
      effectiveTargetNoteIds,
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
  staffNotationMode,
  label,
  onPlayColumn,
  onPlayNote,
  showLabels,
  useLedgerGap,
}: StudyNoteMapProps): JSX.Element {
  const frameRef = useRef<HTMLDivElement | null>(null);
  const rendererTargetRef = useRef<HTMLDivElement | null>(null);
  const effectiveTargetNoteIds = useMemo(
    () => new Set(columns.flatMap((column) => column.notes.map((note) => note.id))),
    [columns],
  );

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
      const metrics = getStudyMapMetrics(surface, columns.length);
      const { context, svg } = surface;
      const system = drawStaffSystem({
        brace: true,
        columnCount: columns.length,
        context,
        frame: { x: metrics.x, staveWidth: metrics.staveWidth },
        horizontal: STUDY_STAFF_LAYOUT.horizontal,
        mode: staffNotationMode,
        scale: surface.scale,
        useLedgerGap,
        vertical: STUDY_STAFF_LAYOUT.vertical,
      });
      const { noteArea } = system;
      const trebleTickables: StaveNote[] = [];
      const bassTickables: StaveNote[] = [];
      const voiceOptions = { beatValue: 4, numBeats: Math.max(1, columns.length) * 4 };
      let layoutTickables: StaveNote[];
      if (system.mode === "grand") {
        const { bass, treble } = system;
        trebleTickables.push(...columns.map((column) =>
          makeChord(column.trebleNotes, "treble", highlightedNoteNames, highlightedNoteId),
        ));
        bassTickables.push(...columns.map((column) =>
          makeChord(column.bassNotes, "bass", highlightedNoteNames, highlightedNoteId),
        ));
        const trebleVoice = new Voice(voiceOptions).addTickables(trebleTickables);
        const bassVoice = new Voice(voiceOptions).addTickables(bassTickables);
        treble.setNoteStartX(noteArea.left);
        bass.setNoteStartX(noteArea.left);
        treble.setWidth(Math.max(1, noteArea.right - metrics.x));
        bass.setWidth(Math.max(1, noteArea.right - metrics.x));
        new Formatter().joinVoices([trebleVoice, bassVoice]).formatToStave([trebleVoice, bassVoice], treble, {
          context,
          stave: treble,
        });
        alignStaveNotesToCenters(trebleTickables, getEvenlySpacedCenters(columns.length, noteArea.left, noteArea.right));
        trebleVoice.draw(context, treble);
        bassVoice.draw(context, bass);
        layoutTickables = trebleTickables;
      } else {
        const { staff, stave } = system;
        const tickables = columns.map((column) =>
          makeChord(staff === "treble" ? column.trebleNotes : column.bassNotes, staff, highlightedNoteNames, highlightedNoteId),
        );
        if (staff === "treble") {
          trebleTickables.push(...tickables);
        } else {
          bassTickables.push(...tickables);
        }
        const voice = new Voice(voiceOptions).addTickables(tickables);
        stave.setNoteStartX(noteArea.left);
        stave.setWidth(Math.max(1, noteArea.right - metrics.x));
        new Formatter().joinVoices([voice]).formatToStave([voice], stave, { context, stave });
        alignStaveNotesToCenters(tickables, getEvenlySpacedCenters(columns.length, noteArea.left, noteArea.right));
        voice.draw(context, stave);
        layoutTickables = tickables;
      }
      const columnLayouts = getStudyColumnLayouts(layoutTickables, surface.scale);

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
        const trebleTickable = trebleTickables[index];
        const bassTickable = bassTickables[index];
        if (trebleTickable) {
          addNoteHotspots({
            chord: trebleTickable,
            effectiveTargetNoteIds,
            highlightedNoteId,
            notes: column.trebleNotes,
            onPlayNote,
            svg,
          });
        }
        if (bassTickable) {
          addNoteHotspots({
            chord: bassTickable,
            effectiveTargetNoteIds,
            highlightedNoteId,
            notes: column.bassNotes,
            onPlayNote,
            svg,
          });
        }
      });
    }

    render();
    const observer = new ResizeObserver(render);
    observer.observe(frame);
    return () => observer.disconnect();
  }, [
    columns,
    effectiveTargetNoteIds,
    highlightedNoteId,
    highlightedNoteNames,
    onPlayColumn,
    onPlayNote,
    showLabels,
    staffNotationMode,
    useLedgerGap,
  ]);

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

function collectHighlightedNoteNames(
  heldKeys: Map<string, HeldKeyboardPlayback>,
  flashedNoteName?: NoteName,
): Set<NoteName> {
  const noteNames = new Set<NoteName>();
  heldKeys.forEach((held) => {
    if (held.highlightedNoteName) {
      noteNames.add(held.highlightedNoteName);
    }
  });
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
  const [listeningSelfCheckStarted, setListeningSelfCheckStarted] = useState(false);
  const [randomAnswerNumbers, setRandomAnswerNumbers] = useState(() => shuffleStudyAnswerNumbers());
  const columnOrderId = studyUiPreferences.columnOrderId;
  const isColumnOrderReversed = studyUiPreferences.isColumnOrderReversed;
  const playbackMode = studyUiPreferences.playbackMode;
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
  const setPlaybackMode = (nextPlaybackMode: StudyPlaybackMode): void => {
    setStudyUiPreferences((current) => ({ ...current, playbackMode: nextPlaybackMode }));
  };
  const setShowLabels = (nextShowLabels: boolean): void => {
    setStudyUiPreferences((current) => ({ ...current, showLabels: nextShowLabels }));
  };
  const columnFlashTimerRef = useRef<number | undefined>();
  const flashedColumnRef = useRef<NoteName | undefined>();
  const noteFlashTimerRef = useRef<number | undefined>();
  const heldKeysRef = useRef(new Map<string, HeldKeyboardPlayback>());
  const listeningSelfCheckRef = useRef<ListeningSelfCheckSession>({ attempt: "untouched" });
  const columnDefinitions = useMemo(
    () => getStudyColumnDefinitions(columnOrderId, isColumnOrderReversed, randomAnswerNumbers),
    [columnOrderId, isColumnOrderReversed, randomAnswerNumbers],
  );
  const staffNotationMode = settings.staffNotationMode;
  const studyNotes = useMemo(
    () => getNotesForGroups(settings.enabledGroupIds, settings.includeInterStaffLedgerSpellings, staffNotationMode),
    [settings.enabledGroupIds, settings.includeInterStaffLedgerSpellings, staffNotationMode],
  );
  const studyPitches = useMemo(() => getUniqueStudyPitches(studyNotes), [studyNotes]);
  const studyPitchPoolKey = getStudyPitchPoolKey(studyPitches);
  const columns = useMemo(() => buildNoteNameColumns(studyNotes, columnDefinitions), [columnDefinitions, studyNotes]);
  const showInterStaffLedger = studyNotes.some((note) => note.isInterStaffLedgerSpelling);

  const flashColumn = useCallback((noteName: NoteName): void => {
    window.clearTimeout(columnFlashTimerRef.current);
    flashedColumnRef.current = noteName;
    setHighlightedNoteNames(collectHighlightedNoteNames(heldKeysRef.current, noteName));
    columnFlashTimerRef.current = window.setTimeout(() => {
      if (flashedColumnRef.current !== noteName) {
        return;
      }
      flashedColumnRef.current = undefined;
      setHighlightedNoteNames(collectHighlightedNoteNames(heldKeysRef.current));
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

  const releaseHeldKey = useCallback((inputId: string): Promise<void> | undefined => {
    const held = heldKeysRef.current.get(inputId);
    if (!held) {
      return;
    }
    heldKeysRef.current.delete(inputId);
    const settled = releaseHeldNoteSequence(held);
    setHighlightedNoteNames(collectHighlightedNoteNames(heldKeysRef.current, flashedColumnRef.current));
    return settled;
  }, []);

  const releaseAllHeldKeys = useCallback((): void => {
    Array.from(heldKeysRef.current.keys()).forEach((inputId) => void releaseHeldKey(inputId));
  }, [releaseHeldKey]);

  const startHeldNotes = useCallback(
    (
      inputId: string,
      notes: readonly TargetNote[],
      kind: HeldKeyboardPlayback["kind"],
      highlightedNoteName?: NoteName,
      beforeStart: Promise<void> = Promise.resolve(),
    ): void => {
      if (heldKeysRef.current.has(inputId) || notes.length === 0) {
        return;
      }

      const held: HeldKeyboardPlayback = {
        cancelled: false,
        highlightedNoteName,
        kind,
        releases: [],
        settled: Promise.resolve(),
      };
      heldKeysRef.current.set(inputId, held);
      setHighlightedNoteNames(collectHighlightedNoteNames(heldKeysRef.current, flashedColumnRef.current));

      beginHeldNoteSequence(
        held,
        dedupeTargetNotePitches([...notes]).sort(compareTargetNotePitch),
        beforeStart,
        (note) => startTargetNote(note).catch(() => undefined),
        () =>
          STUDY_STAFF_LAYOUT.columnNoteDelayMs > 0 ? delay(STUDY_STAFF_LAYOUT.columnNoteDelayMs) : undefined,
      );
    },
    [],
  );

  const resetListeningSelfCheck = useCallback((): void => {
    listeningSelfCheckRef.current = { attempt: "untouched" };
    setListeningSelfCheckStarted(false);
  }, []);

  useEffect(() => {
    return () => {
      window.clearTimeout(columnFlashTimerRef.current);
      window.clearTimeout(noteFlashTimerRef.current);
      releaseAllHeldKeys();
    };
  }, [releaseAllHeldKeys]);

  useEffect(() => {
    releaseAllHeldKeys();
  }, [columns, releaseAllHeldKeys]);

  useEffect(() => {
    releaseAllHeldKeys();
    resetListeningSelfCheck();
  }, [playbackMode, releaseAllHeldKeys, resetListeningSelfCheck, studyPitchPoolKey]);

  useEffect(() => {
    function releaseForFocusLoss(): void {
      releaseAllHeldKeys();
    }

    function releaseForVisibilityChange(): void {
      if (document.visibilityState === "hidden") {
        releaseAllHeldKeys();
      }
    }

    window.addEventListener("blur", releaseForFocusLoss);
    document.addEventListener("visibilitychange", releaseForVisibilityChange);
    return () => {
      window.removeEventListener("blur", releaseForFocusLoss);
      document.removeEventListener("visibilitychange", releaseForVisibilityChange);
    };
  }, [releaseAllHeldKeys]);

  useEffect(() => {
    function getInputId(event: KeyboardEvent): string {
      return `keyboard:${event.code || event.key}`;
    }

    function getAnswerPlaybackNotes(noteName: NoteName): TargetNote[] {
      if (playbackMode === "octaves") {
        return studyPitches.filter((pitch) => pitch.noteName === noteName);
      }
      const target = listeningSelfCheckRef.current.target;
      const pitch =
        target?.mode === "single"
          ? findNearestAnswerPitch(noteName, target.pitch, studyPitches)
          : selectFreeSinglePitch(noteName, studyPitches);
      return pitch ? [pitch] : [];
    }

    function startListeningSelfCheck(inputId: string): void {
      const current = listeningSelfCheckRef.current;
      const needsTarget =
        !current.target ||
        current.target.mode !== playbackMode ||
        shouldRerollListeningTarget(current.attempt);
      const target = needsTarget
        ? selectListeningSelfCheckTarget(
            playbackMode,
            studyPitches,
            current.target?.mode === playbackMode ? current.target : undefined,
          )
        : current.target;
      if (!target) {
        return;
      }
      if (needsTarget) {
        listeningSelfCheckRef.current = { attempt: "untouched", target };
      }
      setListeningSelfCheckStarted(true);
      const notes =
        target.mode === "single"
          ? [target.pitch]
          : studyPitches.filter((pitch) => pitch.noteName === target.noteName);
      startHeldNotes(inputId, notes, "prompt");
    }

    function answerListeningSelfCheck(noteName: NoteName): boolean {
      const current = listeningSelfCheckRef.current;
      if (!current.target) {
        return false;
      }
      const correct = noteName === getListeningTargetNoteName(current.target);
      listeningSelfCheckRef.current = {
        ...current,
        attempt: recordListeningAttempt(current.attempt, correct),
      };
      return correct;
    }

    function releaseHeldPrompts(): Promise<void> {
      const releases = Array.from(heldKeysRef.current)
        .filter(([, held]) => held.kind === "prompt")
        .map(([inputId]) => releaseHeldKey(inputId));
      return Promise.all(releases).then(() => undefined);
    }

    function handleKeyDown(event: KeyboardEvent): void {
      if (isFormControlTarget(event.target)) {
        return;
      }
      const inputId = getInputId(event);
      if (event.key === "0") {
        if (event.altKey || event.ctrlKey || event.metaKey) {
          return;
        }
        event.preventDefault();
        if (!event.repeat) {
          startListeningSelfCheck(inputId);
        }
        return;
      }
      const column = NOTE_NAME_COLUMNS.find((candidate) => candidate.answerNumber === event.key);
      if (column) {
        event.preventDefault();
        if (!event.repeat) {
          const notes = getAnswerPlaybackNotes(column.noteName);
          if (notes.length > 0) {
            const beforeStart = answerListeningSelfCheck(column.noteName)
              ? releaseHeldPrompts()
              : Promise.resolve();
            startHeldNotes(inputId, notes, "answer", column.noteName, beforeStart);
          }
        }
      }
    }

    function handleKeyUp(event: KeyboardEvent): void {
      const inputId = getInputId(event);
      if (heldKeysRef.current.has(inputId)) {
        event.preventDefault();
        releaseHeldKey(inputId);
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("keyup", handleKeyUp);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("keyup", handleKeyUp);
    };
  }, [playbackMode, releaseHeldKey, startHeldNotes, studyPitches]);

  return (
    <>
      <StudyDisplayControls
        columnOrderId={columnOrderId}
        isColumnOrderReversed={isColumnOrderReversed}
        label="学习页设置"
        onColumnOrderChange={setColumnOrderId}
        onColumnOrderReversedChange={setIsColumnOrderReversed}
        onShowLabelsChange={setShowLabels}
        showLabels={showLabels}
      />
      <div className="study-playback-row">
        <div className="study-control-block">
          <span className="control-label">按键播放</span>
          <div className="segmented study-playback-options">
            <button
              className={playbackMode === "single" ? "active" : ""}
              onClick={() => setPlaybackMode("single")}
              type="button"
            >
              单音
            </button>
            <button
              className={playbackMode === "octaves" ? "active" : ""}
              onClick={() => setPlaybackMode("octaves")}
              type="button"
            >
              八度
            </button>
          </div>
        </div>
        <p aria-live="polite" className="study-listening-hint">
          {listeningSelfCheckStarted ? (
            <>
              按<kbd>0</kbd>听音，按其它键作答。未作答/答对后会换音
            </>
          ) : (
            <>
              按 <kbd>0</kbd> 开始听音自测
            </>
          )}
        </p>
      </div>
      <div className="study-map-frame" aria-label="学习页音位图">
        <figure className="study-figure">
          {studyNotes.length > 0 ? (
            <StudyNoteMap
              columns={columns}
              highlightedNoteId={highlightedNoteId}
              highlightedNoteNames={highlightedNoteNames}
              label="F1-G6 音符位置"
              onPlayColumn={playColumn}
              onPlayNote={playNote}
              showLabels={showLabels}
              staffNotationMode={staffNotationMode}
              useLedgerGap={showInterStaffLedger}
            />
          ) : (
            <div className="staff-notation-empty">
              请选择至少一个音域组
            </div>
          )}
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
  const { isBusyVisible: showEnteringStaffRecallStatus, run: runStaffRecallEntry } = useDelayedBusy();
  const [staffRecallRangeLocked, setStaffRecallRangeLocked] = useState(false);

  const enterStaffRecall = useCallback(async (): Promise<void> => {
    if (mode === "staff-recall") {
      return;
    }
    await runStaffRecallEntry(async () => {
      const result = await onBeforeStaffRecallStart();
      if (result.proceed) {
        setMode("staff-recall");
      }
    });
  }, [mode, onBeforeStaffRecallStart, runStaffRecallEntry]);

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
          <button
            aria-keyshortcuts={mode === "staff-recall" ? "Escape" : undefined}
            className={mode === "study" ? "active" : ""}
            onClick={enterStudy}
            type="button"
          >
            学习
            {mode === "staff-recall" ? <kbd>Esc</kbd> : null}
          </button>
          <button
            className={mode === "staff-recall" ? "active" : ""}
            disabled={showEnteringStaffRecallStatus}
            onClick={() => void enterStaffRecall()}
            type="button"
          >
            {showEnteringStaffRecallStatus ? "检查中" : "默写"}
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
