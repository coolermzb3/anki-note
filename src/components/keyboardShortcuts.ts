export type GlobalEnterKeyboardEvent = Pick<
  KeyboardEvent,
  "altKey" | "ctrlKey" | "defaultPrevented" | "isComposing" | "key" | "metaKey" | "repeat" | "shiftKey"
>;

export function isInteractiveShortcutTarget(target: EventTarget | null): boolean {
  return (
    target instanceof Element &&
    Boolean(target.closest("button, a, input, select, textarea, [contenteditable='true']"))
  );
}

export function shouldHandleGlobalEnter(event: GlobalEnterKeyboardEvent, interactiveTarget: boolean): boolean {
  return (
    event.key === "Enter" &&
    !event.repeat &&
    !event.isComposing &&
    !event.defaultPrevented &&
    !event.altKey &&
    !event.ctrlKey &&
    !event.metaKey &&
    !event.shiftKey &&
    !interactiveTarget
  );
}
