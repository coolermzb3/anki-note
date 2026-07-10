import { useEffect, useMemo, useRef, useState } from "react";
import { Formatter, Renderer, StaveNote, Voice } from "vexflow";
import { formatTargetNoteLabel, noteToVexKey } from "../domain/notes";
import { positiveTertileLevel, type NoteConfusionStat } from "../domain/stats";
import type { NoteName, Staff, TargetNote } from "../domain/types";
import { STATS_RANGE_STAFF_LAYOUT } from "./staffLayoutProfiles";
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
  bassY: number;
  fixedDoNumberY: number;
  height: number;
  staveWidth: number;
  noteNameY: number;
  trebleY: number;
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
    hotspot.setAttribute("aria-label", `查看 ${formatTargetNoteLabel(note.note)} 统计`);
    hotspot.addEventListener("pointerenter", (event) => onHover(note, event));
    hotspot.addEventListener("pointerleave", onLeave);
    svg.appendChild(hotspot);
  });
}

function getRangeMapMetrics(surface: StaffRenderSurface, columnCount: number, useLedgerGap: boolean): RangeMapMetrics {
  const frame = getResponsiveStaffFrame(surface, columnCount, STATS_RANGE_STAFF_LAYOUT.horizontal);
  const anchors = getGrandStaffAnchors(
    surface.scale,
    STATS_RANGE_STAFF_LAYOUT.vertical.centerYPx,
    useLedgerGap
      ? STATS_RANGE_STAFF_LAYOUT.vertical.ledgerGapPx
      : STATS_RANGE_STAFF_LAYOUT.vertical.gapPx,
  );
  const noteNameY = logicalPx(STATS_RANGE_STAFF_LAYOUT.labels.noteNameYPx, surface.scale);
  return {
    bassY: anchors.bassY,
    fixedDoNumberY: noteNameY + logicalPx(STATS_RANGE_STAFF_LAYOUT.labels.lineGapPx, surface.scale),
    height: surface.height,
    staveWidth: frame.staveWidth,
    noteNameY,
    trebleY: anchors.trebleY,
    width: surface.width,
    x: frame.x,
  };
}

export function StatsRangeStaff({ label, notes, tone }: StatsRangeStaffProps): JSX.Element {
  const frameRef = useRef<HTMLDivElement | null>(null);
  const rendererTargetRef = useRef<HTMLDivElement | null>(null);
  const [noteTooltip, setNoteTooltip] = useState<NoteTooltipState | undefined>();
  const columns = useMemo(() => getRangeColumns(notes, tone), [notes, tone]);
  const useLedgerGap = notes.some((item) => item.note.isLedgerVariant);

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
      const metrics = getRangeMapMetrics(surface, columns.length, useLedgerGap);
      const { context, svg } = surface;
      const grandStaff = drawGrandStaff(
        context,
        { x: metrics.x, staveWidth: metrics.staveWidth },
        { bassY: metrics.bassY, trebleY: metrics.trebleY },
      );
      const { bass, treble } = grandStaff;

      const trebleTickables = columns.map((column) => makeChord(column.trebleNotes, "treble"));
      const bassTickables = columns.map((column) => makeChord(column.bassNotes, "bass"));
      const voiceOptions = { beatValue: 4, numBeats: Math.max(1, columns.length) * 4 };
      const trebleVoice = new Voice(voiceOptions).addTickables(trebleTickables);
      const bassVoice = new Voice(voiceOptions).addTickables(bassTickables);

      const noteArea = getGrandStaffNoteArea(
        grandStaff,
        columns.length,
        surface.scale,
        STATS_RANGE_STAFF_LAYOUT.horizontal,
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

      context
        .setFont("Inter", logicalPx(STATS_RANGE_STAFF_LAYOUT.labels.noteNameFontSizePx, surface.scale), 800)
        .setFillStyle(STATS_COLORS.range.neutral);
      columns.forEach((column, index) => {
        drawCenteredText(context, column.noteName, staveNoteCenterX(trebleTickables[index]), metrics.noteNameY);
      });
      context
        .setFont("Inter", logicalPx(STATS_RANGE_STAFF_LAYOUT.labels.fixedDoNumberFontSizePx, surface.scale), 700)
        .setFillStyle(STATS_COLORS.range.muted);
      columns.forEach((column, index) => {
        drawCenteredText(context, column.answerNumber, staveNoteCenterX(trebleTickables[index]), metrics.fixedDoNumberY);
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
          label: formatTargetNoteLabel(note.note),
          left,
          rows: hasDurations ? durationRows : confusionRows,
          subtitle: note.durations ? "识别时长" : "常见混淆",
          top,
        });
      };
      const hideNoteTooltip = (): void => setNoteTooltip(undefined);
      columns.forEach((column, index) => {
        addNoteTooltipHotspots(svg, trebleTickables[index], column.trebleNotes, showNoteTooltip, hideNoteTooltip);
        addNoteTooltipHotspots(svg, bassTickables[index], column.bassNotes, showNoteTooltip, hideNoteTooltip);
      });
    }

    render();
    const observer = new ResizeObserver(render);
    observer.observe(frame);
    return () => observer.disconnect();
  }, [columns, useLedgerGap]);

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
