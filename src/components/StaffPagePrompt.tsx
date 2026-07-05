import { useEffect, useMemo, useRef } from "react";
import { Formatter, GhostNote, Renderer, Stave, StaveConnector, StaveNote, Stem, Voice } from "vexflow";
import { noteToVexKey } from "../domain/notes";
import type { PromptNoteDuration, TargetNote } from "../domain/types";

interface StaffPagePromptProps {
  notes: TargetNote[];
  completedCount: number;
  noteDuration: PromptNoteDuration;
  wrongIndex?: number;
}

const NOTES_PER_ROW = 16;
const ROW_HEIGHT = 172;
const BOTTOM_PADDING = 30;
const NEUTRAL_COLOR = "#211c18";
const COMPLETE_COLOR = "#2f8f5f";
const WRONG_COLOR = "#c84c3d";
const BARLINE_INTERVAL = 4;
const BARLINE_COLOR = "#211c18";
const NOTE_NAME_ORDER = {
  C: 0,
  D: 1,
  E: 2,
  F: 3,
  G: 4,
  A: 5,
  B: 6,
} as const;

function pitchOrder(note: Pick<TargetNote, "noteName" | "octave">): number {
  return note.octave * 7 + NOTE_NAME_ORDER[note.noteName];
}

const STAFF_PITCH_BOUNDS = {
  treble: {
    lowest: pitchOrder({ noteName: "E", octave: 4 }),
    highest: pitchOrder({ noteName: "F", octave: 5 }),
  },
  bass: {
    lowest: pitchOrder({ noteName: "G", octave: 2 }),
    highest: pitchOrder({ noteName: "A", octave: 3 }),
  },
} as const;

function chunkNotes(notes: TargetNote[]): TargetNote[][] {
  const rows: TargetNote[][] = [];
  for (let index = 0; index < notes.length; index += NOTES_PER_ROW) {
    rows.push(notes.slice(index, index + NOTES_PER_ROW));
  }
  return rows;
}

function noteDurationToVexDuration(noteDuration: PromptNoteDuration): "q" | "w" {
  return noteDuration === "quarter" ? "q" : "w";
}

function noteDurationToBeats(noteDuration: PromptNoteDuration): number {
  return noteDuration === "quarter" ? 1 : 4;
}

function ledgerStemDirection(note: TargetNote): typeof Stem.UP | typeof Stem.DOWN | undefined {
  const order = pitchOrder(note);
  const bounds = STAFF_PITCH_BOUNDS[note.staff];
  if (order < bounds.lowest) {
    return Stem.UP;
  }
  if (order > bounds.highest) {
    return Stem.DOWN;
  }
  return undefined;
}

function makeStaveNote(note: TargetNote, color: string, noteDuration: PromptNoteDuration): StaveNote {
  const stemDirection = ledgerStemDirection(note);
  const staveNote = new StaveNote({
    clef: note.staff,
    duration: noteDurationToVexDuration(noteDuration),
    keys: [noteToVexKey(note)],
    ...(stemDirection === undefined ? {} : { stemDirection }),
  });
  staveNote.setStyle({ fillStyle: color, strokeStyle: color });
  staveNote.setLedgerLineStyle({ fillStyle: color, strokeStyle: color });
  return staveNote;
}

function colorForIndex(index: number, completedCount: number, wrongIndex: number | undefined): string {
  if (index === wrongIndex) {
    return WRONG_COLOR;
  }
  if (index < completedCount) {
    return COMPLETE_COLOR;
  }
  return NEUTRAL_COLOR;
}

function addBarline(svg: SVGSVGElement, x: number, y1: number, y2: number): void {
  const line = document.createElementNS("http://www.w3.org/2000/svg", "line");
  line.setAttribute("class", "staff-page-barline");
  line.setAttribute("x1", x.toFixed(2));
  line.setAttribute("x2", x.toFixed(2));
  line.setAttribute("y1", y1.toFixed(2));
  line.setAttribute("y2", y2.toFixed(2));
  line.setAttribute("stroke", BARLINE_COLOR);
  line.setAttribute("stroke-width", "1.6");
  line.setAttribute("shape-rendering", "crispEdges");
  svg.appendChild(line);
}

export function StaffPagePrompt({
  notes,
  completedCount,
  noteDuration,
  wrongIndex,
}: StaffPagePromptProps): JSX.Element {
  const frameRef = useRef<HTMLDivElement | null>(null);
  const rendererTargetRef = useRef<HTMLDivElement | null>(null);
  const rows = useMemo(() => chunkNotes(notes), [notes]);

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
      const rowCount = Math.max(1, rows.length);
      const containerWidth = frame.clientWidth || 920;
      const width = Math.max(720, Math.min(980, containerWidth));
      const height = rowCount * ROW_HEIGHT + BOTTOM_PADDING;
      const renderer = new Renderer(rendererTarget, Renderer.Backends.SVG);
      renderer.resize(width, height);
      const context = renderer.getContext();
      const svg = rendererTarget.querySelector("svg");
      const x = 24;
      const staveWidth = width - 48;

      rows.forEach((rowNotes, rowIndex) => {
        const y = 14 + rowIndex * ROW_HEIGHT;
        const treble = new Stave(x, y, staveWidth).addClef("treble");
        const bass = new Stave(x, y + 80, staveWidth).addClef("bass");
        treble.setContext(context).draw();
        bass.setContext(context).draw();
        new StaveConnector(treble, bass).setType("brace").setContext(context).draw();
        new StaveConnector(treble, bass).setType("singleLeft").setContext(context).draw();
        new StaveConnector(treble, bass).setType("singleRight").setContext(context).draw();

        const rowStartIndex = rowIndex * NOTES_PER_ROW;
        const rowSlots = Array.from({ length: NOTES_PER_ROW }, (_, slotIndex) => rowNotes[slotIndex]);
        const vexDuration = noteDurationToVexDuration(noteDuration);
        const trebleTickables = rowSlots.map((note, slotIndex) =>
          note?.staff === "treble"
            ? makeStaveNote(note, colorForIndex(rowStartIndex + slotIndex, completedCount, wrongIndex), noteDuration)
            : new GhostNote(vexDuration),
        );
        const bassTickables = rowSlots.map((note, slotIndex) =>
          note?.staff === "bass"
            ? makeStaveNote(note, colorForIndex(rowStartIndex + slotIndex, completedCount, wrongIndex), noteDuration)
            : new GhostNote(vexDuration),
        );
        const voiceOptions = { beatValue: 4, numBeats: NOTES_PER_ROW * noteDurationToBeats(noteDuration) };
        const trebleVoice = new Voice(voiceOptions).addTickables(trebleTickables);
        const bassVoice = new Voice(voiceOptions).addTickables(bassTickables);
        new Formatter().joinVoices([trebleVoice, bassVoice]).format([trebleVoice, bassVoice], staveWidth - 90, {
          context,
        });
        trebleVoice.draw(context, treble);
        bassVoice.draw(context, bass);

        if (!svg) {
          return;
        }
        for (
          let boundaryIndex = BARLINE_INTERVAL;
          boundaryIndex <= rowNotes.length && boundaryIndex < NOTES_PER_ROW;
          boundaryIndex += BARLINE_INTERVAL
        ) {
          const previousTickable = trebleTickables[boundaryIndex - 1];
          const nextTickable = trebleTickables[boundaryIndex];
          const barlineX = (previousTickable.getAbsoluteX() + nextTickable.getAbsoluteX()) / 2;
          addBarline(svg, barlineX, treble.getYForLine(0), bass.getYForLine(4));
        }
      });
    }

    render();
    const observer = new ResizeObserver(render);
    observer.observe(frame);
    return () => observer.disconnect();
  }, [completedCount, noteDuration, rows, wrongIndex]);

  return (
    <div ref={frameRef} className="staff-page" aria-label="谱页">
      <div ref={rendererTargetRef} className="staff-page-renderer" />
    </div>
  );
}
