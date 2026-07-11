import { useCallback, useEffect, useRef, useState } from "react";
import { startPianoNote } from "../audio/piano";
import {
  ALL_PIANO_KEYS,
  PianoKeyboard,
  type PianoKeyboardKey,
  type PianoKeyId,
  type PianoKeyInputId,
} from "./PianoKeyboard";
import { getPlayablePreviewOctave, getPlayablePreviewShortcutKey } from "./playableKeyboardPreviewKeys";

interface HeldPreviewNote {
  cancelled: boolean;
  key: PianoKeyboardKey;
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
  const [heldPreviewKeys, setHeldPreviewKeys] = useState<ReadonlySet<PianoKeyId>>(() => new Set());
  const heldPreviewNotesRef = useRef(new Map<PianoKeyInputId, HeldPreviewNote>());

  const syncHeldPreviewKeys = useCallback((): void => {
    setHeldPreviewKeys(new Set(Array.from(heldPreviewNotesRef.current.values(), (note) => note.key.id)));
  }, []);

  const startPreviewNote = useCallback(
    (key: PianoKeyboardKey, inputId: PianoKeyInputId): void => {
      if (heldPreviewNotesRef.current.has(inputId)) {
        return;
      }
      const heldNote: HeldPreviewNote = { cancelled: false, key };
      heldPreviewNotesRef.current.set(inputId, heldNote);
      syncHeldPreviewKeys();
      void startPianoNote(key.keyName, getPlayablePreviewOctave(key))
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
    (_key: PianoKeyboardKey, inputId: PianoKeyInputId): void => {
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
      const key = getPlayablePreviewShortcutKey(event.key);
      if (!key) {
        return;
      }
      event.preventDefault();
      startPreviewNote(key, `hardware:${event.code}`);
    }

    function handleKeyUp(event: KeyboardEvent): void {
      const inputId = `hardware:${event.code}`;
      const heldNote = heldPreviewNotesRef.current.get(inputId);
      if (!heldNote) {
        return;
      }
      event.preventDefault();
      releasePreviewNote(heldNote.key, inputId);
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
      includeUpperC
      keyOctave={4}
      onKeyPress={startPreviewNote}
      onKeyRelease={releasePreviewNote}
      pressedKeys={heldPreviewKeys}
      scale={scale}
    />
  );
}
