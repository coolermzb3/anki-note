import { describe, expect, it } from "vitest";
import { getCenteredPianoPanX, getPianoKeyDefinitions, UPPER_C_PIANO_KEY_ID } from "./PianoKeyboard";
import { getPlayablePreviewOctave, getPlayablePreviewShortcutKey } from "./playableKeyboardPreviewKeys";

describe("piano keyboard layout", () => {
  it("keeps the default answer keyboard at seven white keys", () => {
    const keys = getPianoKeyDefinitions(false);

    expect(keys.filter((key) => !key.accidental).map((key) => key.label)).toEqual([
      "1",
      "2",
      "3",
      "4",
      "5",
      "6",
      "7",
    ]);
    expect(keys).toHaveLength(12);
  });

  it("adds a distinct upper C only to the extended layout", () => {
    const keys = getPianoKeyDefinitions(true);

    expect(keys).toHaveLength(13);
    expect(keys.at(-1)).toMatchObject({
      id: UPPER_C_PIANO_KEY_ID,
      keyName: "C",
      label: "8",
      left: 7,
      octaveOffset: 1,
    });
  });

  it("centers the first seven white keys while keeping the upper C visible", () => {
    expect(getCenteredPianoPanX(1000, 800, true)).toBe(150);
    expect(getCenteredPianoPanX(850, 800, true)).toBe(50);
    expect(getCenteredPianoPanX(1000, 700, false)).toBe(150);
  });
});

describe("playable keyboard preview shortcuts", () => {
  it("maps 1 through 8 onto C4 through C5", () => {
    const keys = Array.from({ length: 8 }, (_, index) => getPlayablePreviewShortcutKey(String(index + 1)));

    expect(keys.map((key) => key && `${key.keyName}${getPlayablePreviewOctave(key)}`)).toEqual([
      "C4",
      "D4",
      "E4",
      "F4",
      "G4",
      "A4",
      "B4",
      "C5",
    ]);
    expect(keys.at(-1)?.id).toBe(UPPER_C_PIANO_KEY_ID);
    expect(getPlayablePreviewShortcutKey("9")).toBeUndefined();
  });

  it("plays only the upper C in octave 5", () => {
    expect(getPlayablePreviewOctave({ id: "C", keyName: "C", octaveOffset: 0 })).toBe(4);
    expect(getPlayablePreviewOctave({ id: UPPER_C_PIANO_KEY_ID, keyName: "C", octaveOffset: 1 })).toBe(5);
  });
});
