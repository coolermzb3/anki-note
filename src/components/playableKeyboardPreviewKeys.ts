import type { Octave } from "../domain/types";
import { getPianoKeyDefinitions, type PianoKeyboardKey } from "./PianoKeyboard";

const PLAYABLE_PREVIEW_SHORTCUT_KEYS = new Map(
  getPianoKeyDefinitions(true).flatMap((definition) =>
    definition.label
      ? [[
          definition.label,
          { id: definition.id, keyName: definition.keyName, octaveOffset: definition.octaveOffset },
        ] as const]
      : [],
  ),
);

export function getPlayablePreviewShortcutKey(key: string): PianoKeyboardKey | undefined {
  return PLAYABLE_PREVIEW_SHORTCUT_KEYS.get(key);
}

export function getPlayablePreviewOctave(key: PianoKeyboardKey): Octave {
  return (4 + key.octaveOffset) as Octave;
}
