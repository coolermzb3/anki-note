import { useEffect, useMemo, useRef } from "react";
import { Formatter, Renderer, Stave, StaveConnector, StaveNote, Voice } from "vexflow";
import { noteToVexKey } from "../domain/notes";
import { positiveTertileLevel } from "../domain/stats";
import type { NoteName, Staff, TargetNote } from "../domain/types";
import { STATS_COLORS, type StatsRangeTone } from "./statsColors";

export interface StaffHeatNote {
  note: TargetNote;
  value?: number;
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
  bottomLabelY: number;
  height: number;
  noteAreaSidePadding: number;
  staveWidth: number;
  topLabelY: number;
  trebleY: number;
  width: number;
  x: number;
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
const RANGE_STAFF_GAP_PX = 130;
const RANGE_MAP_LAYOUT = {
  clefReserveWidth: 32,
  preferredColumnGap: 10,
  staffSidePadding: 2,
  noteAreaSidePadding: 18,
  minNoteAreaSidePadding: 10,
  labelTopPadding: 5,
  labelStaffGap: 27,
  labelLineGap: 15,
  lowerStaffReserve: 130,
  topLabelFontSize: 13,
  bottomLabelFontSize: 11,
};

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

function columnCenterX(chord: StaveNote): number {
  return (chord.getNoteHeadBeginX() + chord.getNoteHeadEndX()) / 2;
}

function getResponsiveHorizontalPadding(width: number, columnCount: number): { noteAreaSidePadding: number; staffSidePadding: number } {
  const preferredNoteAreaWidth =
    RANGE_MAP_LAYOUT.clefReserveWidth + Math.max(0, columnCount - 1) * RANGE_MAP_LAYOUT.preferredColumnGap;
  const staffSidePadding = Math.min(
    RANGE_MAP_LAYOUT.staffSidePadding,
    Math.max(0, (width - preferredNoteAreaWidth - RANGE_MAP_LAYOUT.noteAreaSidePadding * 2) / 2),
  );
  const staveWidth = Math.max(1, width - staffSidePadding * 2);
  const noteAreaSidePadding = Math.min(
    RANGE_MAP_LAYOUT.noteAreaSidePadding,
    Math.max(RANGE_MAP_LAYOUT.minNoteAreaSidePadding, (staveWidth - preferredNoteAreaWidth) / 2),
  );

  return { noteAreaSidePadding, staffSidePadding };
}

function getRangeMapMetrics(containerWidth: number, columnCount: number): RangeMapMetrics {
  const width = Math.max(1, containerWidth);
  const { noteAreaSidePadding, staffSidePadding } = getResponsiveHorizontalPadding(width, columnCount);
  const topLabelY = RANGE_MAP_LAYOUT.labelTopPadding + RANGE_MAP_LAYOUT.topLabelFontSize;
  const bottomLabelY = topLabelY + RANGE_MAP_LAYOUT.labelLineGap;
  const trebleY = bottomLabelY + RANGE_MAP_LAYOUT.labelStaffGap;
  const bassY = trebleY + RANGE_STAFF_GAP_PX;
  return {
    bassY,
    bottomLabelY,
    height: bassY + RANGE_MAP_LAYOUT.lowerStaffReserve,
    noteAreaSidePadding,
    staveWidth: Math.max(1, width - staffSidePadding * 2),
    topLabelY,
    trebleY,
    width,
    x: staffSidePadding,
  };
}

function alignColumnsToNoteArea(tickables: StaveNote[], noteAreaLeft: number, noteAreaRight: number): void {
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

export function StatsRangeStaff({ label, notes, tone }: StatsRangeStaffProps): JSX.Element {
  const frameRef = useRef<HTMLDivElement | null>(null);
  const rendererTargetRef = useRef<HTMLDivElement | null>(null);
  const columns = useMemo(() => getRangeColumns(notes, tone), [notes, tone]);

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
      const metrics = getRangeMapMetrics(Math.floor(measuredWidth), columns.length);
      const renderer = new Renderer(rendererTarget, Renderer.Backends.SVG);
      renderer.resize(metrics.width, metrics.height);
      const context = renderer.getContext();
      const treble = new Stave(metrics.x, metrics.trebleY, metrics.staveWidth).addClef("treble");
      const bass = new Stave(metrics.x, metrics.bassY, metrics.staveWidth).addClef("bass");

      treble.setContext(context).draw();
      bass.setContext(context).draw();
      new StaveConnector(treble, bass).setType("singleLeft").setContext(context).draw();
      new StaveConnector(treble, bass).setType("singleRight").setContext(context).draw();

      const trebleTickables = columns.map((column) => makeChord(column.trebleNotes, "treble"));
      const bassTickables = columns.map((column) => makeChord(column.bassNotes, "bass"));
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
      alignColumnsToNoteArea(trebleTickables, noteAreaLeft, noteAreaRight);
      trebleVoice.draw(context, treble);
      bassVoice.draw(context, bass);

      context.setFont("Inter", RANGE_MAP_LAYOUT.topLabelFontSize, 800).setFillStyle(STATS_COLORS.range.neutral);
      columns.forEach((column, index) => {
        drawCenteredText(context, column.noteName, columnCenterX(trebleTickables[index]), metrics.topLabelY);
      });
      context.setFont("Inter", RANGE_MAP_LAYOUT.bottomLabelFontSize, 700).setFillStyle(STATS_COLORS.range.muted);
      columns.forEach((column, index) => {
        drawCenteredText(context, column.answerNumber, columnCenterX(trebleTickables[index]), metrics.bottomLabelY);
      });
    }

    render();
    const observer = new ResizeObserver(render);
    observer.observe(frame);
    return () => observer.disconnect();
  }, [columns]);

  return (
    <div className="stats-range-staff" ref={frameRef} aria-label={label}>
      <div className="stats-range-staff-renderer" ref={rendererTargetRef} />
    </div>
  );
}
