import { useEffect, useRef } from "react";
import { Formatter, Renderer, Stave, StaveConnector, StaveNote, Voice } from "vexflow";
import { formatTargetNoteLabel, noteToVexKey } from "../domain/notes";
import type { PromptNoteDuration, TargetNote } from "../domain/types";

interface StaffPromptProps {
  note: TargetNote;
  compact?: boolean;
  noteDuration: PromptNoteDuration;
}

function noteDurationToVexDuration(noteDuration: PromptNoteDuration): "q" | "w" {
  return noteDuration === "quarter" ? "q" : "w";
}

function noteDurationToBeats(noteDuration: PromptNoteDuration): number {
  return noteDuration === "quarter" ? 1 : 4;
}

export function StaffPrompt({ note, compact = false, noteDuration }: StaffPromptProps): JSX.Element {
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
      const containerWidth = frame.clientWidth || (compact ? 192 : 620);
      const width = Math.max(compact ? 192 : 360, Math.min(compact ? 226 : 720, containerWidth));
      const height = compact ? 116 : 250;
      const renderer = new Renderer(rendererTarget, Renderer.Backends.SVG);
      renderer.resize(width, height);
      const context = renderer.getContext();
      const staveWidth = width - (compact ? 24 : 56);
      const x = compact ? 12 : 28;
      const trebleY = compact ? -6 : 24;
      const bassY = compact ? 50 : 138;
      const treble = new Stave(x, trebleY, staveWidth).addClef("treble");
      const bass = new Stave(x, bassY, staveWidth).addClef("bass");
      treble.setContext(context).draw();
      bass.setContext(context).draw();
      new StaveConnector(treble, bass).setType("brace").setContext(context).draw();
      new StaveConnector(treble, bass).setType("singleLeft").setContext(context).draw();
      new StaveConnector(treble, bass).setType("singleRight").setContext(context).draw();

      const targetStave = note.staff === "treble" ? treble : bass;
      const staveNote = new StaveNote({
        clef: note.staff,
        keys: [noteToVexKey(note)],
        duration: noteDurationToVexDuration(noteDuration),
      });
      const voice = new Voice({ numBeats: noteDurationToBeats(noteDuration), beatValue: 4 }).addTickables([staveNote]);
      new Formatter().joinVoices([voice]).format([voice], staveWidth - (compact ? 74 : 150), { context });
      voice.draw(context, targetStave);
      if (compact) {
        const svg = rendererTarget.querySelector("svg");
        const bounds = svg?.getBBox();
        if (svg && bounds && bounds.width > 0 && bounds.height > 0) {
          const horizontalPadding = 8;
          const verticalPadding = 10;
          const viewBoxWidth = Math.max(width, bounds.width + horizontalPadding * 2);
          const viewBoxHeight = Math.max(112, bounds.height + verticalPadding * 2);
          const viewBoxX = bounds.x + bounds.width / 2 - viewBoxWidth / 2;
          const viewBoxY = bounds.y + bounds.height / 2 - viewBoxHeight / 2;
          svg.setAttribute(
            "viewBox",
            `${viewBoxX} ${viewBoxY} ${viewBoxWidth} ${viewBoxHeight}`,
          );
          svg.setAttribute("preserveAspectRatio", "xMidYMid meet");
          svg.style.overflow = "hidden";
          svg.removeAttribute("height");
          svg.removeAttribute("width");
        }
      }
    }

    render();
    const observer = new ResizeObserver(render);
    observer.observe(frame);
    return () => observer.disconnect();
  }, [compact, note, noteDuration]);

  return (
    <div ref={frameRef} className={compact ? "staff staff-compact" : "staff"} aria-label={`谱面 ${formatTargetNoteLabel(note)}`}>
      <div ref={rendererTargetRef} className="staff-renderer" />
    </div>
  );
}
