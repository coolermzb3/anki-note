import { describe, expect, it } from "vitest";
import { getPausedKeyboardAction } from "./practiceKeyboard";

describe("paused practice keyboard handling", () => {
  it("allows editing keys inside form controls", () => {
    expect(
      getPausedKeyboardAction({ code: "Digit1", isEditableTarget: true, promptDisplayMode: "staff-page" }),
    ).toBe("allow-edit");
    expect(
      getPausedKeyboardAction({ code: "Backspace", isEditableTarget: true, promptDisplayMode: "staff-page" }),
    ).toBe("allow-edit");
  });

  it("keeps Space as the paused staff-page playback shortcut", () => {
    expect(
      getPausedKeyboardAction({ code: "Space", isEditableTarget: true, promptDisplayMode: "staff-page" }),
    ).toBe("toggle-playback");
  });

  it("blocks answer keys outside editable controls", () => {
    expect(
      getPausedKeyboardAction({ code: "Digit1", isEditableTarget: false, promptDisplayMode: "staff-page" }),
    ).toBe("block");
  });
});
