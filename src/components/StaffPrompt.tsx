import { useEffect, useRef } from "react";
import { Formatter, Renderer, Stave, StaveConnector, StaveNote, Voice } from "vexflow";
import { noteToVexKey } from "../domain/notes";
import type { TargetNote } from "../domain/types";

interface StaffPromptProps {
  note: TargetNote;
  compact?: boolean;
}

export function StaffPrompt({ note, compact = false }: StaffPromptProps): JSX.Element {
  const containerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) {
      return;
    }

    function render(): void {
      if (!container) {
        return;
      }
      container.innerHTML = "";
      const containerWidth = container.clientWidth || (compact ? 220 : 620);
      const width = Math.max(compact ? 220 : 360, Math.min(compact ? 320 : 720, containerWidth));
      const height = compact ? 150 : 250;
      const renderer = new Renderer(container, Renderer.Backends.SVG);
      renderer.resize(width, height);
      const context = renderer.getContext();
      const staveWidth = width - (compact ? 34 : 56);
      const x = compact ? 18 : 28;
      const trebleY = compact ? 14 : 24;
      const bassY = compact ? 82 : 138;
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
        duration: "w",
      });
      const voice = new Voice({ numBeats: 4, beatValue: 4 }).addTickables([staveNote]);
      new Formatter().joinVoices([voice]).format([voice], staveWidth - (compact ? 96 : 150), { context });
      voice.draw(context, targetStave);
    }

    render();
    const observer = new ResizeObserver(render);
    observer.observe(container);
    return () => observer.disconnect();
  }, [compact, note]);

  return <div ref={containerRef} className={compact ? "staff staff-compact" : "staff"} aria-label={`谱面 ${note.id}`} />;
}
