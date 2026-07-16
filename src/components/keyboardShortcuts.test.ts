import { describe, expect, it } from "vitest";
import {
  shouldHandleGlobalEnter,
  type GlobalEnterKeyboardEvent,
} from "./keyboardShortcuts";

const ENTER_EVENT: GlobalEnterKeyboardEvent = {
  altKey: false,
  ctrlKey: false,
  defaultPrevented: false,
  isComposing: false,
  key: "Enter",
  metaKey: false,
  repeat: false,
  shiftKey: false,
};

describe("global Enter shortcut", () => {
  it("handles an unmodified Enter outside interactive controls", () => {
    expect(shouldHandleGlobalEnter(ENTER_EVENT, false)).toBe(true);
  });

  it("preserves interactive controls and guarded keyboard events", () => {
    expect(shouldHandleGlobalEnter(ENTER_EVENT, true)).toBe(false);
    for (const event of [
      { ...ENTER_EVENT, key: " " },
      { ...ENTER_EVENT, repeat: true },
      { ...ENTER_EVENT, isComposing: true },
      { ...ENTER_EVENT, defaultPrevented: true },
      { ...ENTER_EVENT, altKey: true },
      { ...ENTER_EVENT, ctrlKey: true },
      { ...ENTER_EVENT, metaKey: true },
      { ...ENTER_EVENT, shiftKey: true },
    ]) {
      expect(shouldHandleGlobalEnter(event, false)).toBe(false);
    }
  });
});
