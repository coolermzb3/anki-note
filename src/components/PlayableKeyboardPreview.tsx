import { useCallback, useEffect, useRef, useState } from "react";
import { startPianoNote } from "../audio/piano";
import type { PianoKeyName } from "../domain/types";
import {
  ALL_PIANO_KEYS,
  NATURAL_PIANO_KEY_NAMES,
  PianoKeyboard,
  type PianoKeyInputId,
} from "./PianoKeyboard";

interface HeldPreviewNote {
  cancelled: boolean;
  keyName: PianoKeyName;
  release?: () => void;
}

interface PlayableKeyboardPreviewProps {
  scale: number;
}

function isFormControl(target: EventTarget | null): boolean {
  return target instanceof HTMLElement &&
    (target.matches("input, select, textarea, button") || target.isContentEditable);
}

export function PlayableKeyboardPreview({ scale }: PlayableKeyboardPreviewProps): JSX.Element {
  const [heldPreviewKeys, setHeldPreviewKeys] = useState<ReadonlySet<PianoKeyName>>(() => new Set());
  const heldPreviewNotesRef = useRef(new Map<PianoKeyInputId, HeldPreviewNote>());

  const syncHeldPreviewKeys = useCallback((): void => {
    setHeldPreviewKeys(new Set(Array.from(heldPreviewNotesRef.current.values(), (note) => note.keyName)));
  }, []);

  const startPreviewNote = useCallback(
    (keyName: PianoKeyName, inputId: PianoKeyInputId): void => {
      if (heldPreviewNotesRef.current.has(inputId)) {
        return;
      }
      const heldNote: HeldPreviewNote = { cancelled: false, keyName };
      heldPreviewNotesRef.current.set(inputId, heldNote);
      syncHeldPreviewKeys();
      void startPianoNote(keyName, 4)
        .then(({ release }) => {
          if (heldNote.cancelled) {
            release();
          } else {
            heldNote.release = release;
          }
        })
        .catch(() => undefined);
    },
    [syncHeldPreviewKeys],
  );

  const releasePreviewNote = useCallback(
    (_keyName: PianoKeyName, inputId: PianoKeyInputId): void => {
      const heldNote = heldPreviewNotesRef.current.get(inputId);
      if (!heldNote) {
        return;
      }
      heldNote.cancelled = true;
      heldNote.release?.();
      heldPreviewNotesRef.current.delete(inputId);
      syncHeldPreviewKeys();
    },
    [syncHeldPreviewKeys],
  );

  const releaseAllPreviewNotes = useCallback((): void => {
    for (const heldNote of heldPreviewNotesRef.current.values()) {
      heldNote.cancelled = true;
      heldNote.release?.();
    }
    heldPreviewNotesRef.current.clear();
    syncHeldPreviewKeys();
  }, [syncHeldPreviewKeys]);

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent): void {
      if (event.repeat || isFormControl(event.target)) {
        return;
      }
      const keyName = NATURAL_PIANO_KEY_NAMES[Number(event.key) - 1];
      if (!keyName) {
        return;
      }
      event.preventDefault();
      startPreviewNote(keyName, `hardware:${event.code}`);
    }

    function handleKeyUp(event: KeyboardEvent): void {
      const inputId = `hardware:${event.code}`;
      const heldNote = heldPreviewNotesRef.current.get(inputId);
      if (!heldNote) {
        return;
      }
      event.preventDefault();
      releasePreviewNote(heldNote.keyName, inputId);
    }

    function handleVisibilityChange(): void {
      if (document.visibilityState === "hidden") {
        releaseAllPreviewNotes();
      }
    }

    window.addEventListener("blur", releaseAllPreviewNotes);
    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("keyup", handleKeyUp);
    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => {
      window.removeEventListener("blur", releaseAllPreviewNotes);
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("keyup", handleKeyUp);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      releaseAllPreviewNotes();
    };
  }, [releaseAllPreviewNotes, releasePreviewNote, startPreviewNote]);

  return (
    <PianoKeyboard
      ariaLabel="可弹奏琴键预览"
      className="settings-piano-keyboard"
      enabledKeys={ALL_PIANO_KEYS}
      keyOctave={4}
      onKeyPress={startPreviewNote}
      onKeyRelease={releasePreviewNote}
      pressedKeys={heldPreviewKeys}
      scale={scale}
    />
  );
}
