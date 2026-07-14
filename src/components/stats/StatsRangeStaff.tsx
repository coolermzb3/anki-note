import { useEffect, useMemo, useRef, useState } from "react";
import { Formatter, Renderer, StaveNote, Voice } from "vexflow";
import { formatTargetNoteLabel, noteToVexKey } from "../../domain/notes";
import { positiveTertileLevel, type NoteConfusionStat } from "../../domain/stats";
import type { NoteName, Staff, StaffNotationMode, TargetNote } from "../../domain/types";
import { STATS_RANGE_STAFF_LAYOUT } from "../staffLayoutProfiles";
import {
  alignStaveNotesToCenters,
  createStaffRenderSurface,
  drawStaffSystem,
  getEvenlySpacedCenters,
  getResponsiveStaffFrame,
  logicalPx,
  staveNoteCenterX,
  type StaffRenderSurface,
} from "../staffGeometry";
import { STATS_COLORS, type StatsRangeTone } from "./statsColors";

export interface StaffHeatNote {
  confusions?: NoteConfusionStat[];
  durations?: StaffHeatDurations;
  note: TargetNote;
  value?: number;
}

export interface StaffHeatDurations {
  medianMs?: number;
  p10Ms?: number;
  p90Ms?: number;
}

interface StatsRangeStaffProps {
  label: string;
  notes: StaffHeatNote[];
  staffNotationMode: StaffNotationMode;
  tone: StatsRangeTone;
}

interface ColoredStaffHeatNote extends StaffHeatNote {
  color: string;
}

interface RangeColumn {
  answerNumber: string;
  bassNotes: ColoredStaffHeatNote[];
  noteName: NoteName;
  trebleNotes: ColoredStaffHeatNote[];
}

interface RangeMapMetrics {
  fixedDoNumberY: number;
  height: number;
  staveWidth: number;
  noteNameY: number;
  width: number;
  x: number;
}

interface NoteTooltipRow {
  label: string;
  labelColor?: string;
  value: string;
  valueColor?: string;
}

interface NoteTooltipState {
  emptyText: string;
  label: string;
  left: number;
  rows: NoteTooltipRow[];
  subtitle: string;
  top: number;
}

const NOTE_DURATION = "w";
const RANGE_COLUMNS: Array<{ answerNumber: string; noteName: NoteName }> = [
  { answerNumber: "1", noteName: "C" },
  { answerNumber: "2", noteName: "D" },
  { answerNumber: "3", noteName: "E" },
  { answerNumber: "4", noteName: "F" },
  { answerNumber: "5", noteName: "G" },
  { answerNumber: "6", noteName: "A" },
  { answerNumber: "7", noteName: "B" },
];
const NOTE_NAME_ORDER: Record<NoteName, number> = {
  C: 0,
  D: 1,
  E: 2,
  F: 3,
  G: 4,
  A: 5,
  B: 6,
};
const NOTE_TOOLTIP_WIDTH = 180;
const NOTE_TOOLTIP_HEIGHT = 116;
const NOTE_TOOLTIP_OFFSET = 10;
function pitchOrder(note: Pick<TargetNote, "noteName" | "octave">): number {
  return note.octave * 7 + NOTE_NAME_ORDER[note.noteName];
}

function comparePitch(left: StaffHeatNote, right: StaffHeatNote): number {
  return pitchOrder(left.note) - pitchOrder(right.note);
}

function heatColor(value: number | undefined, positiveValues: number[], tone: StatsRangeTone): string {
  if (value === undefined || value <= 0 || positiveValues.length === 0) {
    return STATS_COLORS.range.neutral;
  }

  return STATS_COLORS.range.tone[tone][positiveTertileLevel(value, positiveValues)];
}

function getRangeColumns(notes: StaffHeatNote[], tone: StatsRangeTone): RangeColumn[] {
  const positiveValues = notes
    .map((note) => note.value)
    .filter((value): value is number => value !== undefined && value > 0)
    .sort((a, b) => a - b);
  const coloredNotes = notes.map((note) => ({
    ...note,
    color: heatColor(note.value, positiveValues, tone),
  }));

  return RANGE_COLUMNS.map((column) => {
    const columnNotes = coloredNotes.filter((note) => note.note.noteName === column.noteName).sort(comparePitch);
    return {
      ...column,
      bassNotes: columnNotes.filter((note) => note.note.staff === "bass"),
      trebleNotes: columnNotes.filter((note) => note.note.staff === "treble"),
    };
  });
}

function makeChord(notes: ColoredStaffHeatNote[], staff: Staff): StaveNote {
  const hasNotes = notes.length > 0;
  const chord = new StaveNote({
    clef: staff,
    duration: NOTE_DURATION,
    keys: hasNotes ? notes.map((note) => noteToVexKey(note.note)) : [staff === "treble" ? "b/4" : "d/3"],
  });
  const baseColor = hasNotes ? STATS_COLORS.range.neutral : STATS_COLORS.range.transparentNote;
  chord.setStyle({ fillStyle: baseColor, strokeStyle: baseColor });
  chord.setLedgerLineStyle({ fillStyle: baseColor, strokeStyle: baseColor });
  notes.forEach((note, index) => {
    chord.setKeyStyle(index, { fillStyle: note.color, strokeStyle: note.color });
  });
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

function formatTooltipSeconds(ms: number | undefined): string {
  return ms === undefined ? "-" : `${(ms / 1000).toFixed(1)}s`;
}

function addNoteTooltipHotspots(
  svg: SVGSVGElement,
  chord: StaveNote,
  notes: ColoredStaffHeatNote[],
  effectiveTargetNoteIds: ReadonlySet<TargetNote["id"]>,
  onHover: (note: ColoredStaffHeatNote, event: PointerEvent) => void,
  onLeave: () => void,
): void {
  const ys = chord.getYs();
  notes.forEach((note, index) => {
    if ((note.confusions === undefined && note.durations === undefined) || ys[index] === undefined) {
      return;
    }
    const hotspot = document.createElementNS("http://www.w3.org/2000/svg", "circle");
    hotspot.setAttribute("class", "stats-range-note-hotspot");
    hotspot.setAttribute("cx", String(noteHeadCenterX(chord, index)));
    hotspot.setAttribute("cy", String(ys[index]));
    hotspot.setAttribute("r", String(Math.max(7, chord.noteHeads[index]?.getWidth() ?? chord.getGlyphWidth())));
    hotspot.setAttribute("aria-label", `查看 ${formatTargetNoteLabel(note.note, effectiveTargetNoteIds)} 统计`);
    hotspot.addEventListener("pointerenter", (event) => onHover(note, event));
    hotspot.addEventListener("pointerleave", onLeave);
    svg.appendChild(hotspot);
  });
}

function getRangeMapMetrics(
  surface: StaffRenderSurface,
  columnCount: number,
): RangeMapMetrics {
  const frame = getResponsiveStaffFrame(surface, columnCount, STATS_RANGE_STAFF_LAYOUT.horizontal);
  const noteNameY = logicalPx(STATS_RANGE_STAFF_LAYOUT.labels.noteNameYPx, surface.scale);
  return {
    fixedDoNumberY: noteNameY + logicalPx(STATS_RANGE_STAFF_LAYOUT.labels.lineGapPx, surface.scale),
    height: surface.height,
    staveWidth: frame.staveWidth,
    noteNameY,
    width: surface.width,
    x: frame.x,
  };
}

export function StatsRangeStaff({ label, notes, staffNotationMode, tone }: StatsRangeStaffProps): JSX.Element {
  const frameRef = useRef<HTMLDivElement | null>(null);
  const rendererTargetRef = useRef<HTMLDivElement | null>(null);
  const [noteTooltip, setNoteTooltip] = useState<NoteTooltipState | undefined>();
  const columns = useMemo(() => getRangeColumns(notes, tone), [notes, tone]);
  const useLedgerGap = staffNotationMode === "grand" && notes.some((item) => item.note.isInterStaffLedgerSpelling);
  const effectiveTargetNoteIds = useMemo(() => new Set(notes.map((item) => item.note.id)), [notes]);

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
      const surface = createStaffRenderSurface(
        rendererTarget,
        Math.floor(measuredWidth),
        STATS_RANGE_STAFF_LAYOUT.vertical.viewHeightPx,
        STATS_RANGE_STAFF_LAYOUT.notationScale,
      );
      const metrics = getRangeMapMetrics(surface, columns.length);
      const { context, svg } = surface;
      const system = drawStaffSystem({
        columnCount: columns.length,
        context,
        frame: { x: metrics.x, staveWidth: metrics.staveWidth },
        horizontal: STATS_RANGE_STAFF_LAYOUT.horizontal,
        mode: staffNotationMode,
        scale: surface.scale,
        useLedgerGap,
        vertical: STATS_RANGE_STAFF_LAYOUT.vertical,
      });
      const { noteArea } = system;
      const voiceOptions = { beatValue: 4, numBeats: Math.max(1, columns.length) * 4 };
      const trebleTickables: StaveNote[] = [];
      const bassTickables: StaveNote[] = [];
      let layoutTickables: StaveNote[];
      if (system.mode === "grand") {
        const { bass, treble } = system;
        trebleTickables.push(...columns.map((column) => makeChord(column.trebleNotes, "treble")));
        bassTickables.push(...columns.map((column) => makeChord(column.bassNotes, "bass")));
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
          makeChord(staff === "treble" ? column.trebleNotes : column.bassNotes, staff),
        );
        (staff === "treble" ? trebleTickables : bassTickables).push(...tickables);
        const voice = new Voice(voiceOptions).addTickables(tickables);
        stave.setNoteStartX(noteArea.left);
        stave.setWidth(Math.max(1, noteArea.right - metrics.x));
        new Formatter().joinVoices([voice]).formatToStave([voice], stave, { context, stave });
        alignStaveNotesToCenters(tickables, getEvenlySpacedCenters(columns.length, noteArea.left, noteArea.right));
        voice.draw(context, stave);
        layoutTickables = tickables;
      }

      context
        .setFont("Inter", logicalPx(STATS_RANGE_STAFF_LAYOUT.labels.noteNameFontSizePx, surface.scale), 800)
        .setFillStyle(STATS_COLORS.range.neutral);
      columns.forEach((column, index) => {
        drawCenteredText(context, column.noteName, staveNoteCenterX(layoutTickables[index]), metrics.noteNameY);
      });
      context
        .setFont("Inter", logicalPx(STATS_RANGE_STAFF_LAYOUT.labels.fixedDoNumberFontSizePx, surface.scale), 700)
        .setFillStyle(STATS_COLORS.range.muted);
      columns.forEach((column, index) => {
        drawCenteredText(context, column.answerNumber, staveNoteCenterX(layoutTickables[index]), metrics.fixedDoNumberY);
      });

      if (!svg) {
        return;
      }
      const showNoteTooltip = (note: ColoredStaffHeatNote, event: PointerEvent): void => {
        const bounds = frame.getBoundingClientRect();
        const cursorLeft = event.clientX - bounds.left;
        const cursorTop = event.clientY - bounds.top;
        const left = Math.max(
          6,
          Math.min(cursorLeft + NOTE_TOOLTIP_OFFSET, bounds.width - NOTE_TOOLTIP_WIDTH - 6),
        );
        const preferredTop = cursorTop + NOTE_TOOLTIP_OFFSET;
        const top = preferredTop + NOTE_TOOLTIP_HEIGHT <= bounds.height
          ? preferredTop
          : Math.max(6, cursorTop - NOTE_TOOLTIP_HEIGHT - NOTE_TOOLTIP_OFFSET);
        const durationRows = note.durations
          ? [
              {
                label: "P10",
                labelColor: STATS_COLORS.recognitionChart.p10,
                value: formatTooltipSeconds(note.durations.p10Ms),
                valueColor: STATS_COLORS.recognitionChart.p10,
              },
              {
                label: "中位",
                labelColor: STATS_COLORS.recognitionChart.median,
                value: formatTooltipSeconds(note.durations.medianMs),
                valueColor: STATS_COLORS.recognitionChart.median,
              },
              {
                label: "P90",
                labelColor: STATS_COLORS.recognitionChart.p90,
                value: formatTooltipSeconds(note.durations.p90Ms),
                valueColor: STATS_COLORS.recognitionChart.p90,
              },
            ]
          : [];
        const confusionRows = (note.confusions ?? []).map((confusion) => ({
          label: confusion.noteName,
          labelColor: STATS_COLORS.recognitionChart.p90,
          value: `${confusion.count}次`,
        }));
        const hasDurations = note.durations && Object.values(note.durations).some((value) => value !== undefined);
        setNoteTooltip({
          emptyText: note.durations ? "暂无时长记录" : "暂无混淆记录",
          label: formatTargetNoteLabel(note.note, effectiveTargetNoteIds),
          left,
          rows: hasDurations ? durationRows : confusionRows,
          subtitle: note.durations ? "识别时长" : "常见混淆",
          top,
        });
      };
      const hideNoteTooltip = (): void => setNoteTooltip(undefined);
      columns.forEach((column, index) => {
        const trebleTickable = trebleTickables[index];
        const bassTickable = bassTickables[index];
        if (trebleTickable) {
          addNoteTooltipHotspots(
            svg,
            trebleTickable,
            column.trebleNotes,
            effectiveTargetNoteIds,
            showNoteTooltip,
            hideNoteTooltip,
          );
        }
        if (bassTickable) {
          addNoteTooltipHotspots(
            svg,
            bassTickable,
            column.bassNotes,
            effectiveTargetNoteIds,
            showNoteTooltip,
            hideNoteTooltip,
          );
        }
      });
    }

    render();
    const observer = new ResizeObserver(render);
    observer.observe(frame);
    return () => observer.disconnect();
  }, [columns, effectiveTargetNoteIds, staffNotationMode, useLedgerGap]);

  return (
    <div
      className="stats-range-staff"
      ref={frameRef}
      aria-label={label}
      onPointerLeave={() => setNoteTooltip(undefined)}
    >
      <div className="stats-range-staff-renderer" ref={rendererTargetRef} />
      {noteTooltip ? (
        <aside
          className="stats-range-note-tooltip"
          role="tooltip"
          style={{ left: noteTooltip.left, top: noteTooltip.top }}
        >
          <div className="stats-range-note-tooltip-title">
            <strong>{noteTooltip.label}</strong>
            <span>{noteTooltip.subtitle}</span>
          </div>
          {noteTooltip.rows.length > 0 ? (
            <ol>
              {noteTooltip.rows.map((row) => (
                <li key={row.label}>
                  <b style={{ color: row.labelColor }}>{row.label}</b>
                  <span style={{ color: row.valueColor }}>{row.value}</span>
                </li>
              ))}
            </ol>
          ) : (
            <p>{noteTooltip.emptyText}</p>
          )}
        </aside>
      ) : null}
    </div>
  );
}
