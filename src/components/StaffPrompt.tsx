import { useEffect, useRef } from "react";
import { Formatter, StaveNote, Voice } from "vexflow";
import { formatTargetNoteLabel, noteToVexKey } from "../domain/notes";
import type { PromptNoteDuration, TargetNote } from "../domain/types";
import { PRACTICE_SINGLE_STAFF_LAYOUT } from "./staffLayoutProfiles";
import {
  alignStaveNotesToCenters,
  createStaffRenderSurface,
  drawGrandStaff,
  getEvenlySpacedCenters,
  getFixedStaffFrame,
  getGrandStaffAnchors,
  getGrandStaffNoteArea,
  getLedgerStemDirection,
} from "./staffGeometry";

interface StaffPromptProps {
  note: TargetNote;
  noteDuration: PromptNoteDuration;
  useLedgerGap: boolean;
  wrong?: boolean;
}

const NEUTRAL_COLOR = "#211c18";
const WRONG_COLOR = "#c84c3d";
function noteDurationToVexDuration(noteDuration: PromptNoteDuration): "q" | "w" {
  return noteDuration === "quarter" ? "q" : "w";
}

function noteDurationToBeats(noteDuration: PromptNoteDuration): number {
  return noteDuration === "quarter" ? 1 : 4;
}

function makePromptNote(note: TargetNote, noteDuration: PromptNoteDuration, color: string): StaveNote {
  const stemDirection = getLedgerStemDirection(note);
  const staveNote = new StaveNote({
    clef: note.staff,
    keys: [noteToVexKey(note)],
    duration: noteDurationToVexDuration(noteDuration),
    ...(stemDirection === undefined ? {} : { stemDirection }),
  });
  staveNote.setStyle({ fillStyle: color, strokeStyle: color });
  staveNote.setLedgerLineStyle({ fillStyle: color, strokeStyle: color });
  return staveNote;
}

export function StaffPrompt({
  note,
  noteDuration,
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
      const anchors = getGrandStaffAnchors(
        surface.scale,
        PRACTICE_SINGLE_STAFF_LAYOUT.vertical.centerYPx,
        useLedgerGap
          ? PRACTICE_SINGLE_STAFF_LAYOUT.vertical.ledgerGapPx
          : PRACTICE_SINGLE_STAFF_LAYOUT.vertical.gapPx,
      );
      const grandStaff = drawGrandStaff(context, frameMetrics, anchors, { brace: true });
      const { bass, treble } = grandStaff;

      const noteArea = getGrandStaffNoteArea(
        grandStaff,
        1,
        surface.scale,
        PRACTICE_SINGLE_STAFF_LAYOUT.horizontal,
      );
      const noteCenter = getEvenlySpacedCenters(1, noteArea.left, noteArea.right);
      const drawNote = (targetNote: TargetNote, color: string): void => {
        const targetStave = targetNote.staff === "treble" ? treble : bass;
        const staveNote = makePromptNote(targetNote, noteDuration, color).setStave(targetStave);
        const voice = new Voice({ numBeats: noteDurationToBeats(noteDuration), beatValue: 4 }).addTickables([staveNote]);
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
  }, [note, noteDuration, useLedgerGap, wrong]);

  return (
    <div ref={frameRef} className="staff" aria-label={`谱面 ${formatTargetNoteLabel(note)}`}>
      <div ref={rendererTargetRef} className="staff-renderer" />
    </div>
  );
}
