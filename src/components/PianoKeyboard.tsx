import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type FocusEvent as ReactFocusEvent,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
} from "react";
import type { NoteName, PianoKeyName } from "../domain/types";

export const NATURAL_PIANO_KEY_NAMES: readonly NoteName[] = ["C", "D", "E", "F", "G", "A", "B"];
export const PIANO_KEY_NAMES: readonly PianoKeyName[] = [
  "C",
  "C#",
  "D",
  "D#",
  "E",
  "F",
  "F#",
  "G",
  "G#",
  "A",
  "A#",
  "B",
];
export const NATURAL_PIANO_KEYS: ReadonlySet<PianoKeyName> = new Set(NATURAL_PIANO_KEY_NAMES);
export const ALL_PIANO_KEYS: ReadonlySet<PianoKeyName> = new Set(PIANO_KEY_NAMES);

export function isNaturalPianoKey(keyName: PianoKeyName): keyName is NoteName {
  return NATURAL_PIANO_KEYS.has(keyName);
}

const WHITE_KEY_WIDTH_PX = 72;

interface PianoKeyDefinition {
  keyName: PianoKeyName;
  label?: string;
  left: number;
  accidental: boolean;
}

const PIANO_KEY_DEFINITIONS: readonly PianoKeyDefinition[] = [
  { keyName: "C", label: "1", left: 0, accidental: false },
  { keyName: "C#", left: 1, accidental: true },
  { keyName: "D", label: "2", left: 1, accidental: false },
  { keyName: "D#", left: 2, accidental: true },
  { keyName: "E", label: "3", left: 2, accidental: false },
  { keyName: "F", label: "4", left: 3, accidental: false },
  { keyName: "F#", left: 4, accidental: true },
  { keyName: "G", label: "5", left: 4, accidental: false },
  { keyName: "G#", left: 5, accidental: true },
  { keyName: "A", label: "6", left: 5, accidental: false },
  { keyName: "A#", left: 6, accidental: true },
  { keyName: "B", label: "7", left: 6, accidental: false },
];

export type PianoKeyInputId = string;

interface PianoKeyFeedback {
  keyName: PianoKeyName;
  type: "wrong" | "correct";
}

interface PianoKeyboardProps {
  ariaLabel: string;
  className?: string;
  enabledKeys: ReadonlySet<PianoKeyName>;
  feedback?: PianoKeyFeedback;
  keyOctave?: number;
  onKeyPress: (keyName: PianoKeyName, inputId: PianoKeyInputId) => void;
  onKeyRelease?: (keyName: PianoKeyName, inputId: PianoKeyInputId) => void;
  pressedKeys?: ReadonlySet<PianoKeyName>;
  scale: number;
}

interface DragState {
  pointerId: number;
  startPanX: number;
  startX: number;
}

type PianoKeyboardStyle = CSSProperties & {
  "--piano-preferred-white-key-width": string;
};

function displayKeyName(keyName: PianoKeyName): string {
  return keyName.replace("#", "♯");
}

function clampPanX(value: number, viewportWidth: number, keybedWidth: number): number {
  return Math.min(0, Math.max(viewportWidth - keybedWidth, value));
}

export function PianoKeyboard({
  ariaLabel,
  className,
  enabledKeys,
  feedback,
  keyOctave,
  onKeyPress,
  onKeyRelease,
  pressedKeys,
  scale,
}: PianoKeyboardProps): JSX.Element {
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const keybedRef = useRef<HTMLDivElement | null>(null);
  const activeInputsRef = useRef(new Map<PianoKeyInputId, PianoKeyName>());
  const onKeyPressRef = useRef(onKeyPress);
  const onKeyReleaseRef = useRef(onKeyRelease);
  const dragRef = useRef<DragState | null>(null);
  const panXRef = useRef(0);
  const previousDimensionsRef = useRef({ keybedWidth: 0, overflowing: false, viewportWidth: 0 });
  const [activeInputKeys, setActiveInputKeys] = useState<ReadonlySet<PianoKeyName>>(() => new Set());
  const [dimensions, setDimensions] = useState({ keybedWidth: 0, viewportWidth: 0 });
  const [dragging, setDragging] = useState(false);
  const [panX, setPanX] = useState(0);
  const overflowing = dimensions.keybedWidth > dimensions.viewportWidth + 0.5;

  onKeyPressRef.current = onKeyPress;
  onKeyReleaseRef.current = onKeyRelease;
  panXRef.current = panX;

  const syncActiveInputKeys = useCallback((): void => {
    setActiveInputKeys(new Set(activeInputsRef.current.values()));
  }, []);

  const releaseInput = useCallback(
    (inputId: PianoKeyInputId): void => {
      const keyName = activeInputsRef.current.get(inputId);
      if (!keyName) {
        return;
      }
      activeInputsRef.current.delete(inputId);
      onKeyReleaseRef.current?.(keyName, inputId);
      syncActiveInputKeys();
    },
    [syncActiveInputKeys],
  );

  const releaseAllInputs = useCallback(
    (updateState = true): void => {
      for (const [inputId, keyName] of activeInputsRef.current) {
        onKeyReleaseRef.current?.(keyName, inputId);
      }
      activeInputsRef.current.clear();
      if (updateState) {
        syncActiveInputKeys();
      }
    },
    [syncActiveInputKeys],
  );

  const pressInput = useCallback(
    (inputId: PianoKeyInputId, keyName: PianoKeyName): void => {
      if (activeInputsRef.current.has(inputId)) {
        return;
      }
      activeInputsRef.current.set(inputId, keyName);
      onKeyPressRef.current(keyName, inputId);
      syncActiveInputKeys();
    },
    [syncActiveInputKeys],
  );

  useEffect(() => {
    const viewport = viewportRef.current;
    const keybed = keybedRef.current;
    if (!viewport || !keybed) {
      return;
    }

    const measure = (): void => {
      setDimensions({ keybedWidth: keybed.getBoundingClientRect().width, viewportWidth: viewport.clientWidth });
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(viewport);
    observer.observe(keybed);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const previous = previousDimensionsRef.current;
    if (!overflowing) {
      setPanX(0);
    } else if (!previous.overflowing || Math.abs(previous.keybedWidth - dimensions.keybedWidth) > 0.5) {
      setPanX((dimensions.viewportWidth - dimensions.keybedWidth) / 2);
    } else {
      setPanX((current) => clampPanX(current, dimensions.viewportWidth, dimensions.keybedWidth));
    }
    previousDimensionsRef.current = { ...dimensions, overflowing };
  }, [dimensions, overflowing]);

  useEffect(() => {
    function releaseForFocusLoss(): void {
      releaseAllInputs();
    }

    function releaseForVisibilityChange(): void {
      if (document.visibilityState === "hidden") {
        releaseAllInputs();
      }
    }

    window.addEventListener("blur", releaseForFocusLoss);
    document.addEventListener("visibilitychange", releaseForVisibilityChange);
    return () => {
      window.removeEventListener("blur", releaseForFocusLoss);
      document.removeEventListener("visibilitychange", releaseForVisibilityChange);
    };
  }, [releaseAllInputs]);

  useEffect(() => {
    for (const [inputId, keyName] of activeInputsRef.current) {
      if (!enabledKeys.has(keyName)) {
        releaseInput(inputId);
      }
    }
  }, [enabledKeys, releaseInput]);

  useEffect(() => {
    return () => releaseAllInputs(false);
  }, [releaseAllInputs]);

  const renderedPanX = overflowing ? panX : (dimensions.viewportWidth - dimensions.keybedWidth) / 2;
  const keyboardStyle = useMemo<PianoKeyboardStyle>(
    () => ({ "--piano-preferred-white-key-width": `${WHITE_KEY_WIDTH_PX * scale}px` }),
    [scale],
  );

  function beginDrag(event: ReactPointerEvent<HTMLDivElement>): void {
    if (event.button !== 0 || dragRef.current) {
      return;
    }
    dragRef.current = { pointerId: event.pointerId, startPanX: panXRef.current, startX: event.clientX };
    event.currentTarget.setPointerCapture(event.pointerId);
    setDragging(true);
    event.preventDefault();
  }

  function updateDrag(event: ReactPointerEvent<HTMLDivElement>): void {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) {
      return;
    }
    setPanX(clampPanX(drag.startPanX + event.clientX - drag.startX, dimensions.viewportWidth, dimensions.keybedWidth));
  }

  function endDrag(event: ReactPointerEvent<HTMLDivElement>): void {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) {
      return;
    }
    dragRef.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    setDragging(false);
  }

  function handleKeyFocus(event: ReactFocusEvent<HTMLButtonElement>): void {
    if (!overflowing) {
      return;
    }
    const left = event.currentTarget.offsetLeft;
    const right = left + event.currentTarget.offsetWidth;
    let nextPanX = panXRef.current;
    if (left + nextPanX < 0) {
      nextPanX = -left;
    } else if (right + nextPanX > dimensions.viewportWidth) {
      nextPanX = dimensions.viewportWidth - right;
    }
    setPanX(clampPanX(nextPanX, dimensions.viewportWidth, dimensions.keybedWidth));
  }

  function handleKeyPointerDown(event: ReactPointerEvent<HTMLButtonElement>, keyName: PianoKeyName): void {
    if (event.button !== 0 || !enabledKeys.has(keyName)) {
      return;
    }
    const inputId = `pointer:${event.pointerId}`;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    pressInput(inputId, keyName);
  }

  function handleKeyPointerEnd(event: ReactPointerEvent<HTMLButtonElement>): void {
    const inputId = `pointer:${event.pointerId}`;
    releaseInput(inputId);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  }

  function handleKeyDown(event: ReactKeyboardEvent<HTMLButtonElement>, keyName: PianoKeyName): void {
    if ((event.key !== " " && event.key !== "Enter") || event.repeat || !enabledKeys.has(keyName)) {
      return;
    }
    event.preventDefault();
    pressInput(`focus:${keyName}`, keyName);
  }

  function handleKeyUp(event: ReactKeyboardEvent<HTMLButtonElement>, keyName: PianoKeyName): void {
    if (event.key !== " " && event.key !== "Enter") {
      return;
    }
    event.preventDefault();
    releaseInput(`focus:${keyName}`);
  }

  return (
    <div
      aria-label={ariaLabel}
      className={[
        "piano-keyboard",
        overflowing ? "piano-keyboard-overflowing" : "",
        dragging ? "piano-keyboard-dragging" : "",
        className ?? "",
      ]
        .filter(Boolean)
        .join(" ")}
      role="group"
      style={keyboardStyle}
    >
      {overflowing ? (
        <div
          className="piano-keyboard-drag-handle"
          onPointerCancel={endDrag}
          onPointerDown={beginDrag}
          onPointerMove={updateDrag}
          onPointerUp={endDrag}
          title="左右拖动琴键"
        >
          <span aria-hidden="true">↔</span>
          左右拖动琴键
        </div>
      ) : null}
      <div className="piano-keyboard-viewport" ref={viewportRef}>
        <div
          className="piano-keyboard-keybed"
          ref={keybedRef}
          style={{ transform: `translateX(${renderedPanX}px)` }}
        >
          {PIANO_KEY_DEFINITIONS.map((definition) => {
            const enabled = enabledKeys.has(definition.keyName);
            const pressed = activeInputKeys.has(definition.keyName) || pressedKeys?.has(definition.keyName);
            const feedbackType = feedback?.keyName === definition.keyName ? feedback.type : undefined;
            const keyStyle = {
              left: `calc(var(--piano-white-key-width) * ${definition.left})`,
            };
            const pitchLabel = `${displayKeyName(definition.keyName)}${keyOctave ?? ""}`;
            return (
              <button
                aria-label={definition.label ? `${definition.label} = ${pitchLabel}` : pitchLabel}
                className={[
                  "piano-key",
                  definition.accidental ? "piano-key-black" : "piano-key-white",
                  pressed ? "piano-key-pressed" : "",
                  feedbackType ? `piano-key-${feedbackType}` : "",
                ]
                  .filter(Boolean)
                  .join(" ")}
                disabled={!enabled}
                key={definition.keyName}
                onBlur={() => releaseInput(`focus:${definition.keyName}`)}
                onFocus={handleKeyFocus}
                onKeyDown={(event) => handleKeyDown(event, definition.keyName)}
                onKeyUp={(event) => handleKeyUp(event, definition.keyName)}
                onPointerCancel={handleKeyPointerEnd}
                onPointerDown={(event) => handleKeyPointerDown(event, definition.keyName)}
                onPointerUp={handleKeyPointerEnd}
                style={keyStyle}
                type="button"
              >
                {definition.label ? <span>{definition.label}</span> : null}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
