import { useEffect, useRef } from "react";
import { Formatter, StaveNote, Voice } from "vexflow";
import { formatTargetNoteLabel, noteToVexKey } from "../domain/notes";
import type { PromptNoteDuration, StaffNotationMode, TargetNote, TargetNoteId } from "../domain/types";
import { PRACTICE_SINGLE_STAFF_LAYOUT } from "./staffLayoutProfiles";
import {
  alignStaveNotesToCenters,
  createStaffRenderSurface,
  drawStaffSystem,
  getEvenlySpacedCenters,
  getFixedStaffFrame,
  getLedgerStemDirection,
} from "./staffGeometry";
import { getQuarterNoteBeats, getVexNoteDuration } from "./staffPageNotation";

interface StaffPromptProps {
  effectiveTargetNoteIds: ReadonlySet<TargetNoteId>;
  note: TargetNote;
  noteDuration: PromptNoteDuration;
  staffNotationMode: StaffNotationMode;
  useLedgerGap: boolean;
  wrong?: boolean;
}

const NEUTRAL_COLOR = "#211c18";
const WRONG_COLOR = "#c84c3d";

function makePromptNote(note: TargetNote, noteDuration: PromptNoteDuration, color: string): StaveNote {
  const stemDirection = getLedgerStemDirection(note);
  const staveNote = new StaveNote({
    clef: note.staff,
    keys: [noteToVexKey(note)],
    duration: getVexNoteDuration(noteDuration),
    ...(stemDirection === undefined ? {} : { stemDirection }),
  });
  staveNote.setStyle({ fillStyle: color, strokeStyle: color });
  staveNote.setLedgerLineStyle({ fillStyle: color, strokeStyle: color });
  return staveNote;
}

export function StaffPrompt({
  effectiveTargetNoteIds,
  note,
  noteDuration,
  staffNotationMode,
  useLedgerGap,
  wrong = false,
}: StaffPromptProps): JSX.Element {
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
      const containerWidth = frame.clientWidth || PRACTICE_SINGLE_STAFF_LAYOUT.width.minPx;
      const displayWidth = Math.max(
        PRACTICE_SINGLE_STAFF_LAYOUT.width.minPx,
        Math.min(PRACTICE_SINGLE_STAFF_LAYOUT.width.maxPx, containerWidth),
      );
      const surface = createStaffRenderSurface(
        rendererTarget,
        displayWidth,
        PRACTICE_SINGLE_STAFF_LAYOUT.vertical.viewHeightPx,
        PRACTICE_SINGLE_STAFF_LAYOUT.notationScale,
      );
      const { context } = surface;
      const frameMetrics = getFixedStaffFrame(
        surface,
        PRACTICE_SINGLE_STAFF_LAYOUT.horizontal.staffSidePaddingPx,
      );
      const system = drawStaffSystem({
        brace: true,
        columnCount: 1,
        context,
        frame: frameMetrics,
        horizontal: PRACTICE_SINGLE_STAFF_LAYOUT.horizontal,
        mode: staffNotationMode,
        scale: surface.scale,
        useLedgerGap,
        vertical: PRACTICE_SINGLE_STAFF_LAYOUT.vertical,
      });
      const targetStave = system.mode === "grand"
        ? note.staff === "treble" ? system.treble : system.bass
        : system.stave;
      const { noteArea } = system;
      const noteCenter = getEvenlySpacedCenters(1, noteArea.left, noteArea.right);
      const drawNote = (targetNote: TargetNote, color: string): void => {
        const staveNote = makePromptNote(targetNote, noteDuration, color).setStave(targetStave);
        const voice = new Voice({ numBeats: getQuarterNoteBeats(noteDuration), beatValue: 4 }).addTickables([staveNote]);
        new Formatter().joinVoices([voice]).format([voice], Math.max(1, noteArea.right - noteArea.left), { context });
        alignStaveNotesToCenters([staveNote], noteCenter);
        voice.draw(context, targetStave);
      };
      drawNote(note, wrong ? WRONG_COLOR : NEUTRAL_COLOR);
    }

    render();
    const observer = new ResizeObserver(render);
    observer.observe(frame);
    return () => observer.disconnect();
  }, [note, noteDuration, staffNotationMode, useLedgerGap, wrong]);

  return (
    <div
      ref={frameRef}
      className="staff"
      aria-label={`谱面 ${formatTargetNoteLabel(note, effectiveTargetNoteIds)}`}
    >
      <div ref={rendererTargetRef} className="staff-renderer" />
    </div>
  );
}
