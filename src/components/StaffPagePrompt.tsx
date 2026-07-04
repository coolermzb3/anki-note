import { useEffect, useMemo, useRef } from "react";
import { Formatter, GhostNote, Renderer, Stave, StaveConnector, StaveNote, Voice } from "vexflow";
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
const NEUTRAL_COLOR = "#211c18";
const COMPLETE_COLOR = "#2f8f5f";
const WRONG_COLOR = "#c84c3d";
const BARLINE_INTERVAL = 4;
const BARLINE_COLOR = "#211c18";

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

function makeStaveNote(note: TargetNote, color: string, noteDuration: PromptNoteDuration): StaveNote {
  const staveNote = new StaveNote({
    clef: note.staff,
    duration: noteDurationToVexDuration(noteDuration),
    keys: [noteToVexKey(note)],
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
      const height = rowCount * ROW_HEIGHT + 18;
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
