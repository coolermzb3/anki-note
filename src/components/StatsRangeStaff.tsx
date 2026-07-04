import { type PointerEvent, useEffect, useMemo, useRef } from "react";
import { Formatter, GhostNote, Renderer, Stave, StaveConnector, StaveNote, Voice } from "vexflow";
import { noteToVexKey } from "../domain/notes";
import { percentile } from "../domain/stats";
import type { TargetNote } from "../domain/types";

export interface StaffHeatNote {
  note: TargetNote;
  value?: number;
}

type HeatTone = "red" | "blue";

interface StatsRangeStaffProps {
  label: string;
  notes: StaffHeatNote[];
  tone: HeatTone;
}

const NOTE_DURATION = "w";
const NOTE_SPACING_PX = 22;
const SVG_HEIGHT = 232;
const NEUTRAL_COLOR = "#211c18";
const TONE_COLORS: Record<HeatTone, { light: string; dark: string }> = {
  red: {
    light: "#d9867b",
    dark: "#ad3226",
  },
  blue: {
    light: "#7ca8ca",
    dark: "#245f92",
  },
};

function heatColor(value: number | undefined, positiveValues: number[], tone: HeatTone): string {
  if (value === undefined || value <= 0 || positiveValues.length === 0) {
    return NEUTRAL_COLOR;
  }

  const darkThreshold = percentile(positiveValues, 0.67);
  return darkThreshold !== undefined && value > darkThreshold ? TONE_COLORS[tone].dark : TONE_COLORS[tone].light;
}

function makeNote(note: TargetNote, color: string): StaveNote {
  const staveNote = new StaveNote({
    clef: note.staff,
    duration: NOTE_DURATION,
    keys: [noteToVexKey(note)],
  });
  staveNote.setStyle({ fillStyle: color, strokeStyle: color });
  staveNote.setLedgerLineStyle({ fillStyle: color, strokeStyle: color });
  return staveNote;
}

export function StatsRangeStaff({ label, notes, tone }: StatsRangeStaffProps): JSX.Element {
  const frameRef = useRef<HTMLDivElement | null>(null);
  const rendererTargetRef = useRef<HTMLDivElement | null>(null);
  const dragStateRef = useRef<{ pointerId: number; scrollLeft: number; startX: number } | null>(null);
  const renderItems = useMemo(() => {
    const positiveValues = notes
      .map((note) => note.value)
      .filter((value): value is number => value !== undefined && value > 0)
      .sort((a, b) => a - b);
    const coloredNotes = notes.map((note) => ({
      type: "note" as const,
      ...note,
      color: heatColor(note.value, positiveValues, tone),
    }));
    return coloredNotes.flatMap((note, index) =>
      index > 0 && note.note.staff !== coloredNotes[index - 1].note.staff
        ? [{ type: "gap" as const }, note]
        : [note],
    );
  }, [notes, tone]);

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
      const containerWidth = frame.clientWidth || 680;
      const width = Math.max(containerWidth, 140 + renderItems.length * NOTE_SPACING_PX);
      const height = SVG_HEIGHT;
      const renderer = new Renderer(rendererTarget, Renderer.Backends.SVG);
      renderer.resize(width, height);
      const context = renderer.getContext();
      const x = 26;
      const staveWidth = width - 52;
      const treble = new Stave(x, 18, staveWidth).addClef("treble");
      const bass = new Stave(x, 118, staveWidth).addClef("bass");
      treble.setContext(context).draw();
      bass.setContext(context).draw();
      new StaveConnector(treble, bass).setType("brace").setContext(context).draw();
      new StaveConnector(treble, bass).setType("singleLeft").setContext(context).draw();
      new StaveConnector(treble, bass).setType("singleRight").setContext(context).draw();

      if (renderItems.length === 0) {
        return;
      }

      const trebleTickables = renderItems.map((item) =>
        item.type === "note" && item.note.staff === "treble" ? makeNote(item.note, item.color) : new GhostNote(NOTE_DURATION),
      );
      const bassTickables = renderItems.map((item) =>
        item.type === "note" && item.note.staff === "bass" ? makeNote(item.note, item.color) : new GhostNote(NOTE_DURATION),
      );
      const voiceOptions = { beatValue: 4, numBeats: renderItems.length * 4 };
      const trebleVoice = new Voice(voiceOptions).addTickables(trebleTickables);
      const bassVoice = new Voice(voiceOptions).addTickables(bassTickables);
      new Formatter().joinVoices([trebleVoice, bassVoice]).format([trebleVoice, bassVoice], staveWidth - 86, {
        context,
      });
      trebleVoice.draw(context, treble);
      bassVoice.draw(context, bass);
    }

    render();
    const observer = new ResizeObserver(render);
    observer.observe(frame);
    return () => observer.disconnect();
  }, [renderItems]);

  function endDrag(event: PointerEvent<HTMLDivElement>): void {
    if (dragStateRef.current?.pointerId !== event.pointerId) {
      return;
    }
    dragStateRef.current = null;
    event.currentTarget.classList.remove("is-dragging");
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  }

  return (
    <div
      className="stats-range-staff"
      ref={frameRef}
      aria-label={label}
      onPointerCancel={endDrag}
      onPointerDown={(event) => {
        if (event.button !== 0) {
          return;
        }
        dragStateRef.current = {
          pointerId: event.pointerId,
          scrollLeft: event.currentTarget.scrollLeft,
          startX: event.clientX,
        };
        event.currentTarget.classList.add("is-dragging");
        event.currentTarget.setPointerCapture(event.pointerId);
      }}
      onPointerMove={(event) => {
        const dragState = dragStateRef.current;
        if (!dragState || dragState.pointerId !== event.pointerId) {
          return;
        }
        event.currentTarget.scrollLeft = dragState.scrollLeft - (event.clientX - dragState.startX);
        event.preventDefault();
      }}
      onPointerUp={endDrag}
    >
      <div className="stats-range-staff-renderer" ref={rendererTargetRef} />
    </div>
  );
}
