import {
  useCallback,
  useEffect,
  useLayoutEffect,
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
export const UPPER_C_PIANO_KEY_ID = "upper-C" as const;
export type PianoKeyId = PianoKeyName | typeof UPPER_C_PIANO_KEY_ID;

interface PianoKeyDefinition {
  id: PianoKeyId;
  keyName: PianoKeyName;
  label?: string;
  left: number;
  accidental: boolean;
  octaveOffset: number;
}

const PIANO_KEY_DEFINITIONS: readonly PianoKeyDefinition[] = [
  { id: "C", keyName: "C", label: "1", left: 0, accidental: false, octaveOffset: 0 },
  { id: "C#", keyName: "C#", left: 1, accidental: true, octaveOffset: 0 },
  { id: "D", keyName: "D", label: "2", left: 1, accidental: false, octaveOffset: 0 },
  { id: "D#", keyName: "D#", left: 2, accidental: true, octaveOffset: 0 },
  { id: "E", keyName: "E", label: "3", left: 2, accidental: false, octaveOffset: 0 },
  { id: "F", keyName: "F", label: "4", left: 3, accidental: false, octaveOffset: 0 },
  { id: "F#", keyName: "F#", left: 4, accidental: true, octaveOffset: 0 },
  { id: "G", keyName: "G", label: "5", left: 4, accidental: false, octaveOffset: 0 },
  { id: "G#", keyName: "G#", left: 5, accidental: true, octaveOffset: 0 },
  { id: "A", keyName: "A", label: "6", left: 5, accidental: false, octaveOffset: 0 },
  { id: "A#", keyName: "A#", left: 6, accidental: true, octaveOffset: 0 },
  { id: "B", keyName: "B", label: "7", left: 6, accidental: false, octaveOffset: 0 },
];

const UPPER_C_KEY_DEFINITION: PianoKeyDefinition = {
  id: UPPER_C_PIANO_KEY_ID,
  keyName: "C",
  label: "8",
  left: 7,
  accidental: false,
  octaveOffset: 1,
};

export interface PianoKeyboardKey {
  id: PianoKeyId;
  keyName: PianoKeyName;
  octaveOffset: number;
}

export function getPianoKeyDefinitions(includeUpperC: boolean): readonly PianoKeyDefinition[] {
  return includeUpperC ? [...PIANO_KEY_DEFINITIONS, UPPER_C_KEY_DEFINITION] : PIANO_KEY_DEFINITIONS;
}

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
  includeUpperC?: boolean;
  keyOctave?: number;
  onKeyPress: (key: PianoKeyboardKey, inputId: PianoKeyInputId) => void;
  onKeyRelease?: (key: PianoKeyboardKey, inputId: PianoKeyInputId) => void;
  pressedKeys?: ReadonlySet<PianoKeyId>;
  scale: number;
}

interface DragState {
  pointerId: number;
  startPanX: number;
  startX: number;
}

type PianoKeyboardStyle = CSSProperties & {
  "--piano-preferred-white-key-width": string;
  "--piano-white-key-count": number;
};

function displayKeyName(keyName: PianoKeyName): string {
  return keyName.replace("#", "♯");
}

function clampPanX(value: number, viewportWidth: number, keybedWidth: number): number {
  return Math.min(0, Math.max(viewportWidth - keybedWidth, value));
}

export function getCenteredPianoPanX(viewportWidth: number, keybedWidth: number, includeUpperC: boolean): number {
  if (!includeUpperC) {
    return (viewportWidth - keybedWidth) / 2;
  }
  const sevenKeyWidth = keybedWidth * (7 / 8);
  return Math.min((viewportWidth - sevenKeyWidth) / 2, viewportWidth - keybedWidth);
}

export function PianoKeyboard({
  ariaLabel,
  className,
  enabledKeys,
  feedback,
  includeUpperC = false,
  keyOctave,
  onKeyPress,
  onKeyRelease,
  pressedKeys,
  scale,
}: PianoKeyboardProps): JSX.Element {
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const keybedRef = useRef<HTMLDivElement | null>(null);
  const activeInputsRef = useRef(new Map<PianoKeyInputId, PianoKeyboardKey>());
  const onKeyPressRef = useRef(onKeyPress);
  const onKeyReleaseRef = useRef(onKeyRelease);
  const dragRef = useRef<DragState | null>(null);
  const panXRef = useRef(0);
  const previousDimensionsRef = useRef({ keybedWidth: 0, overflowing: false, viewportWidth: 0 });
  const [activeInputKeys, setActiveInputKeys] = useState<ReadonlySet<PianoKeyId>>(() => new Set());
  const [dimensions, setDimensions] = useState({ keybedWidth: 0, viewportWidth: 0 });
  const [dragging, setDragging] = useState(false);
  const [panX, setPanX] = useState(0);
  const overflowing = dimensions.keybedWidth > dimensions.viewportWidth + 0.5;

  onKeyPressRef.current = onKeyPress;
  onKeyReleaseRef.current = onKeyRelease;
  panXRef.current = panX;

  const syncActiveInputKeys = useCallback((): void => {
    setActiveInputKeys(new Set(Array.from(activeInputsRef.current.values(), (key) => key.id)));
  }, []);

  const releaseInput = useCallback(
    (inputId: PianoKeyInputId): void => {
      const key = activeInputsRef.current.get(inputId);
      if (!key) {
        return;
      }
      activeInputsRef.current.delete(inputId);
      onKeyReleaseRef.current?.(key, inputId);
      syncActiveInputKeys();
    },
    [syncActiveInputKeys],
  );

  const releaseAllInputs = useCallback(
    (updateState = true): void => {
      for (const [inputId, key] of activeInputsRef.current) {
        onKeyReleaseRef.current?.(key, inputId);
      }
      activeInputsRef.current.clear();
      if (updateState) {
        syncActiveInputKeys();
      }
    },
    [syncActiveInputKeys],
  );

  const pressInput = useCallback(
    (inputId: PianoKeyInputId, key: PianoKeyboardKey): void => {
      if (activeInputsRef.current.has(inputId)) {
        return;
      }
      activeInputsRef.current.set(inputId, key);
      onKeyPressRef.current(key, inputId);
      syncActiveInputKeys();
    },
    [syncActiveInputKeys],
  );

  useLayoutEffect(() => {
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

  useLayoutEffect(() => {
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
    for (const [inputId, key] of activeInputsRef.current) {
      if (!enabledKeys.has(key.keyName)) {
        releaseInput(inputId);
      }
    }
  }, [enabledKeys, releaseInput]);

  useEffect(() => {
    return () => releaseAllInputs(false);
  }, [releaseAllInputs]);

  const renderedPanX = overflowing
    ? panX
    : getCenteredPianoPanX(dimensions.viewportWidth, dimensions.keybedWidth, includeUpperC);
  const keyDefinitions = getPianoKeyDefinitions(includeUpperC);
  const keyboardStyle = useMemo<PianoKeyboardStyle>(
    () => ({
      "--piano-preferred-white-key-width": `${WHITE_KEY_WIDTH_PX * scale}px`,
      "--piano-white-key-count": includeUpperC ? 8 : 7,
    }),
    [includeUpperC, scale],
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

  function handleKeyPointerDown(event: ReactPointerEvent<HTMLButtonElement>, key: PianoKeyboardKey): void {
    if (event.button !== 0 || !enabledKeys.has(key.keyName)) {
      return;
    }
    const inputId = `pointer:${event.pointerId}`;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    pressInput(inputId, key);
  }

  function handleKeyPointerEnd(event: ReactPointerEvent<HTMLButtonElement>): void {
    const inputId = `pointer:${event.pointerId}`;
    releaseInput(inputId);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  }

  function handleKeyDown(event: ReactKeyboardEvent<HTMLButtonElement>, key: PianoKeyboardKey): void {
    if ((event.key !== " " && event.key !== "Enter") || event.repeat || !enabledKeys.has(key.keyName)) {
      return;
    }
    event.preventDefault();
    pressInput(`focus:${key.id}`, key);
  }

  function handleKeyUp(event: ReactKeyboardEvent<HTMLButtonElement>, key: PianoKeyboardKey): void {
    if (event.key !== " " && event.key !== "Enter") {
      return;
    }
    event.preventDefault();
    releaseInput(`focus:${key.id}`);
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
          {keyDefinitions.map((definition) => {
            const key: PianoKeyboardKey = {
              id: definition.id,
              keyName: definition.keyName,
              octaveOffset: definition.octaveOffset,
            };
            const enabled = enabledKeys.has(definition.keyName);
            const pressed = activeInputKeys.has(definition.id) || pressedKeys?.has(definition.id);
            const feedbackType = feedback?.keyName === definition.keyName ? feedback.type : undefined;
            const keyStyle = {
              left: `calc(var(--piano-white-key-width) * ${definition.left})`,
            };
            const octave = keyOctave === undefined ? "" : keyOctave + definition.octaveOffset;
            const pitchLabel = `${displayKeyName(definition.keyName)}${octave}`;
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
                key={definition.id}
                onBlur={() => releaseInput(`focus:${definition.id}`)}
                onFocus={handleKeyFocus}
                onKeyDown={(event) => handleKeyDown(event, key)}
                onKeyUp={(event) => handleKeyUp(event, key)}
                onPointerCancel={handleKeyPointerEnd}
                onPointerDown={(event) => handleKeyPointerDown(event, key)}
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
