import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { startPianoMidi } from "../../audio/piano";
import { frequencyToMidi, formatMidiNote, midiToFrequency, type VocalPitchFrame } from "../../domain/vocalPitch";

interface PitchViewport {
  midiMin: number;
  midiSpan: number;
  timeSpan: number;
  timeStart: number;
}

interface PitchPreviewProps {
  currentPitchHz: number | null;
  currentTime: number;
  duration: number;
  followResetKey: number;
  frames: readonly VocalPitchFrame[];
  followEnabled: boolean;
  isRecording: boolean;
  onSeek: (timeSeconds: number) => void;
  referencePitchHz: number;
  variant: "offline" | "realtime";
}

const DEFAULT_KEYBOARD_WIDTH = 68;
const MAX_KEYBOARD_WIDTH = DEFAULT_KEYBOARD_WIDTH * 4;
const DEFAULT_MIDI_SPAN = 49;
const MIN_TIME_SPAN = 1;
const MIN_MIDI_SPAN = 6;
const PIANO_MIDI_MIN = 24;
const PIANO_MIDI_MAX = 108;
const PIANO_VIEW_MIN = PIANO_MIDI_MIN - 0.5;
const PIANO_VIEW_MAX = PIANO_MIDI_MAX + 0.5;
const MAX_MIDI_SPAN = PIANO_VIEW_MAX - PIANO_VIEW_MIN;
const PIANO_WHITE_MIDIS = Array.from(
  { length: PIANO_MIDI_MAX - PIANO_MIDI_MIN + 1 },
  (_, index) => PIANO_MIDI_MIN + index,
).filter((midi) => !isBlackKey(midi));

function isBlackKey(midi: number): boolean {
  return [1, 3, 6, 8, 10].includes(((Math.round(midi) % 12) + 12) % 12);
}

function nearestWhiteKey(midi: number): number {
  return PIANO_WHITE_MIDIS.reduce((nearest, candidate) =>
    Math.abs(candidate - midi) < Math.abs(nearest - midi) ? candidate : nearest,
  PIANO_MIDI_MIN);
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function initialTimeSpan(duration: number): number {
  return Math.min(30, Math.max(0.01, duration || 10));
}

function clampPitchViewport(midiMin: number, midiSpan: number): Pick<PitchViewport, "midiMin" | "midiSpan"> {
  const nextSpan = clamp(midiSpan, MIN_MIDI_SPAN, MAX_MIDI_SPAN);
  return {
    midiMin: clamp(midiMin, PIANO_VIEW_MIN, PIANO_VIEW_MAX - nextSpan),
    midiSpan: nextSpan,
  };
}

function clampTimeViewport(
  timeStart: number,
  timeSpan: number,
  duration: number,
  currentTime: number,
): Pick<PitchViewport, "timeSpan" | "timeStart"> {
  const timelineDuration = Math.max(0.01, duration, currentTime);
  const nextSpan = clamp(timeSpan, Math.min(MIN_TIME_SPAN, timelineDuration), timelineDuration);
  const maximumStart = Math.max(0, timelineDuration - nextSpan);
  return {
    timeStart: clamp(timeStart, 0, maximumStart),
    timeSpan: nextSpan,
  };
}

function useElementSize<T extends HTMLElement>() {
  const ref = useRef<T | null>(null);
  const [size, setSize] = useState({ height: 0, width: 0 });
  useEffect(() => {
    const element = ref.current;
    if (!element) {
      return undefined;
    }
    const update = () => setSize({ height: element.clientHeight, width: element.clientWidth });
    update();
    const observer = new ResizeObserver(update);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  return { ref, size };
}

export function PitchPreview({
  currentPitchHz,
  currentTime,
  duration,
  followResetKey,
  frames,
  followEnabled,
  isRecording,
  onSeek,
  referencePitchHz,
  variant,
}: PitchPreviewProps): JSX.Element {
  const { ref: shellRef, size } = useElementSize<HTMLDivElement>();
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [viewport, setViewport] = useState<PitchViewport>(() => ({
    timeStart: 0,
    timeSpan: initialTimeSpan(duration),
    midiMin: 35.5,
    midiSpan: DEFAULT_MIDI_SPAN,
  }));
  const keyboardWidth = DEFAULT_KEYBOARD_WIDTH +
    clamp(
      Math.log(MAX_MIDI_SPAN / viewport.midiSpan) / Math.log(MAX_MIDI_SPAN / MIN_MIDI_SPAN),
      0,
      1,
    ) * (MAX_KEYBOARD_WIDTH - DEFAULT_KEYBOARD_WIDTH);
  const [hoveredPitch, setHoveredPitch] = useState<{ frequencyHz: number; note: string; x: number; y: number } | null>(null);
  const dragRef = useRef<
    | { mode: "keyboard-pan"; pointerY: number; viewport: PitchViewport }
    | { mode: "pan"; pointerX: number; pointerY: number; viewport: PitchViewport }
    | { mode: "playhead"; pointerY: number; viewport: PitchViewport }
    | { mode: "pinch"; distance: number; midpointX: number; midpointY: number; viewport: PitchViewport }
    | null
  >(null);
  const touchPointersRef = useRef(new Map<number, { x: number; y: number }>());
  const heldPianoNotesRef = useRef(new Map<number, { cancelled: boolean; release?: () => void }>());
  const manualFollowSuspendedRef = useRef(false);

  const releasePianoPointer = useCallback((pointerId: number) => {
    const heldNote = heldPianoNotesRef.current.get(pointerId);
    if (!heldNote) return;
    heldNote.cancelled = true;
    heldNote.release?.();
    heldPianoNotesRef.current.delete(pointerId);
  }, []);

  const releaseAllPianoNotes = useCallback(() => {
    for (const heldNote of heldPianoNotesRef.current.values()) {
      heldNote.cancelled = true;
      heldNote.release?.();
    }
    heldPianoNotesRef.current.clear();
  }, []);

  useEffect(() => {
    const handleVisibilityChange = () => {
      if (document.visibilityState === "hidden") releaseAllPianoNotes();
    };
    window.addEventListener("blur", releaseAllPianoNotes);
    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => {
      window.removeEventListener("blur", releaseAllPianoNotes);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      releaseAllPianoNotes();
    };
  }, [releaseAllPianoNotes]);

  useEffect(() => {
    manualFollowSuspendedRef.current = false;
  }, [followResetKey]);

  useEffect(() => {
    if (!isRecording || dragRef.current) {
      return;
    }
    const timeSpan = Math.min(30, Math.max(0.01, duration));
    const timeStart = Math.max(0, duration - timeSpan);
    setViewport((current) =>
      current.timeStart === timeStart && current.timeSpan === timeSpan
        ? current
        : { ...current, timeStart, timeSpan });
  }, [duration, isRecording]);

  useEffect(() => {
    if (dragRef.current) {
      return;
    }
    if (manualFollowSuspendedRef.current) {
      return;
    }
    setViewport((current) => {
      let timeStart = current.timeStart;
      let midiMin = current.midiMin;
      const relativeTime = (currentTime - current.timeStart) / current.timeSpan;
      if (relativeTime > 0.82) {
        timeStart = currentTime - current.timeSpan * 0.72;
      } else if (relativeTime < 0.12 && currentTime >= 0) {
        timeStart = currentTime - current.timeSpan * 0.2;
      }
      if (currentPitchHz !== null) {
        const midi = frequencyToMidi(currentPitchHz, referencePitchHz);
        const relativePitch = (midi - current.midiMin) / current.midiSpan;
        if (relativePitch > 0.86) {
          midiMin = midi - current.midiSpan * 0.72;
        } else if (relativePitch < 0.14) {
          midiMin = midi - current.midiSpan * 0.28;
        }
      }
      if (timeStart === current.timeStart && midiMin === current.midiMin) {
        return current;
      }
      return {
        ...current,
        ...clampTimeViewport(timeStart, current.timeSpan, duration, currentTime),
        ...clampPitchViewport(midiMin, current.midiSpan),
      };
    });
  }, [currentPitchHz, currentTime, duration, followEnabled, referencePitchHz]);

  const xForTime = useCallback(
    (timeSeconds: number, targetViewport = viewport) =>
      keyboardWidth + ((timeSeconds - targetViewport.timeStart) / targetViewport.timeSpan) * Math.max(1, size.width - keyboardWidth),
    [keyboardWidth, size.width, viewport],
  );
  const yForMidi = useCallback(
    (midi: number, targetViewport = viewport) =>
      size.height - ((midi - targetViewport.midiMin) / targetViewport.midiSpan) * size.height,
    [size.height, viewport],
  );

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || size.width <= 0 || size.height <= 0) {
      return;
    }
    const ratio = window.devicePixelRatio || 1;
    const pixelWidth = Math.round(size.width * ratio);
    const pixelHeight = Math.round(size.height * ratio);
    const cssWidth = `${size.width}px`;
    const cssHeight = `${size.height}px`;
    if (canvas.width !== pixelWidth) canvas.width = pixelWidth;
    if (canvas.height !== pixelHeight) canvas.height = pixelHeight;
    if (canvas.style.width !== cssWidth) canvas.style.width = cssWidth;
    if (canvas.style.height !== cssHeight) canvas.style.height = cssHeight;
    const context = canvas.getContext("2d");
    if (!context) {
      return;
    }
    context.setTransform(ratio, 0, 0, ratio, 0, 0);
    context.clearRect(0, 0, size.width, size.height);
    context.fillStyle = "#fffdfa";
    context.fillRect(0, 0, size.width, size.height);

    context.fillStyle = "#fffdf9";
    context.fillRect(0, 0, keyboardWidth, size.height);
    const firstMidi = Math.max(PIANO_MIDI_MIN, Math.floor(viewport.midiMin + 0.5));
    const lastMidi = Math.min(PIANO_MIDI_MAX, Math.ceil(viewport.midiMin + viewport.midiSpan - 0.5));
    const currentMidi = currentPitchHz === null ? null : frequencyToMidi(currentPitchHz, referencePitchHz);
    for (let midi = firstMidi; midi <= lastMidi; midi += 1) {
      const top = yForMidi(midi + 0.5);
      const bottom = yForMidi(midi - 0.5);
      const rowHeight = bottom - top;
      const active = currentMidi !== null && Math.round(currentMidi) === midi;
      context.fillStyle = active ? "rgba(216, 140, 36, 0.16)" : isBlackKey(midi) ? "#f2ece3" : "#fffdfa";
      context.fillRect(keyboardWidth, top, size.width - keyboardWidth, rowHeight);
      context.strokeStyle = "rgba(188, 174, 154, 0.38)";
      context.beginPath();
      context.moveTo(keyboardWidth, bottom);
      context.lineTo(size.width, bottom);
      context.stroke();
    }

    for (let index = 0; index < PIANO_WHITE_MIDIS.length; index += 1) {
      const midi = PIANO_WHITE_MIDIS[index];
      const previousMidi = PIANO_WHITE_MIDIS[index - 1];
      const nextMidi = PIANO_WHITE_MIDIS[index + 1];
      const lowerEdge = previousMidi === undefined ? PIANO_VIEW_MIN : (previousMidi + midi) / 2;
      const upperEdge = nextMidi === undefined ? PIANO_VIEW_MAX : (midi + nextMidi) / 2;
      const top = yForMidi(upperEdge);
      const bottom = yForMidi(lowerEdge);
      if (bottom < 0 || top > size.height) {
        continue;
      }
      const active = currentMidi !== null && Math.round(currentMidi) === midi;
      context.fillStyle = active ? "#f6cf83" : "#fffdf9";
      context.strokeStyle = active ? "#c68a2f" : "#bcae9a";
      context.fillRect(0, top, keyboardWidth, bottom - top);
      context.strokeRect(0, top, keyboardWidth, bottom - top);
      if (midi % 12 === 0 && bottom - top >= 12) {
        context.fillStyle = "#675d53";
        context.font = "11px Inter, sans-serif";
        context.textAlign = "right";
        context.textBaseline = "middle";
        context.fillText(formatMidiNote(midi), keyboardWidth - 5, (top + bottom) / 2);
      }
    }

    for (let midi = PIANO_MIDI_MIN; midi <= PIANO_MIDI_MAX; midi += 1) {
      if (!isBlackKey(midi)) {
        continue;
      }
      const top = yForMidi(midi + 0.42);
      const bottom = yForMidi(midi - 0.42);
      if (bottom < 0 || top > size.height) {
        continue;
      }
      const active = currentMidi !== null && Math.round(currentMidi) === midi;
      context.fillStyle = active ? "#a96116" : "#332e2a";
      context.strokeStyle = active ? "#7c4710" : "#171411";
      context.fillRect(0, top, keyboardWidth * 0.72, bottom - top);
      context.strokeRect(0, top, keyboardWidth * 0.72, bottom - top);
    }
    context.save();
    context.beginPath();
    context.rect(keyboardWidth, 0, Math.max(0, size.width - keyboardWidth), size.height);
    context.clip();

    context.strokeStyle = variant === "realtime" ? "rgba(37, 111, 103, 0.62)" : "#256f67";
    context.lineWidth = 2;
    context.lineJoin = "round";
    context.lineCap = "round";
    context.beginPath();
    let drawing = false;
    let previousTime = -Infinity;
    for (const frame of frames) {
      if (frame.timeSeconds < viewport.timeStart - 0.2) {
        continue;
      }
      if (frame.timeSeconds > viewport.timeStart + viewport.timeSpan + 0.2) {
        break;
      }
      if (frame.frequencyHz === null || frame.timeSeconds - previousTime > 0.05) {
        drawing = false;
        previousTime = frame.timeSeconds;
        continue;
      }
      const x = xForTime(frame.timeSeconds);
      const y = yForMidi(frequencyToMidi(frame.frequencyHz, referencePitchHz));
      if (drawing) {
        context.lineTo(x, y);
      } else {
        context.moveTo(x, y);
        drawing = true;
      }
      previousTime = frame.timeSeconds;
    }
    context.stroke();

    const playheadX = xForTime(currentTime);
    if (playheadX >= keyboardWidth - 1 && playheadX <= size.width + 1) {
      context.strokeStyle = "#c84c3d";
      context.lineWidth = 1.5;
      context.beginPath();
      context.moveTo(playheadX, 0);
      context.lineTo(playheadX, size.height);
      context.stroke();
      context.fillStyle = "#c84c3d";
      context.beginPath();
      context.moveTo(playheadX - 6, 0);
      context.lineTo(playheadX + 6, 0);
      context.lineTo(playheadX, 8);
      context.closePath();
      context.fill();
    }
    context.restore();

    context.strokeStyle = "#9f917f";
    context.lineWidth = 1;
    context.beginPath();
    context.moveTo(keyboardWidth, 0);
    context.lineTo(keyboardWidth, size.height);
    context.stroke();
  }, [currentPitchHz, currentTime, frames, keyboardWidth, referencePitchHz, size, variant, viewport, xForTime, yForMidi]);

  const seekFromPointer = useCallback((clientX: number) => {
    const bounds = shellRef.current?.getBoundingClientRect();
    if (!bounds) {
      return;
    }
    const x = clientX - bounds.left;
    const time = viewport.timeStart + ((x - keyboardWidth) / Math.max(1, bounds.width - keyboardWidth)) * viewport.timeSpan;
    onSeek(clamp(time, 0, Math.max(duration, currentTime, 0)));
  }, [currentTime, duration, keyboardWidth, onSeek, shellRef, viewport]);

  const handlePointerDown = (event: React.PointerEvent<HTMLCanvasElement>) => {
    if ((event.pointerType !== "touch" && !event.isPrimary) || (event.pointerType !== "touch" && event.button !== 0 && event.button !== 2)) {
      return;
    }
    const bounds = event.currentTarget.getBoundingClientRect();
    const x = event.clientX - bounds.left;
    if (event.button === 2) {
      event.preventDefault();
      event.stopPropagation();
      event.nativeEvent.stopImmediatePropagation();
    }
    if (event.button === 0 && x <= keyboardWidth) {
      event.currentTarget.setPointerCapture(event.pointerId);
      const pitchAtPointer =
        viewport.midiMin + ((bounds.bottom - event.clientY) / Math.max(1, bounds.height)) * viewport.midiSpan;
      const roundedMidi = clamp(Math.round(pitchAtPointer), PIANO_MIDI_MIN, PIANO_MIDI_MAX);
      const midi =
        x <= keyboardWidth * 0.72 && isBlackKey(roundedMidi) && Math.abs(pitchAtPointer - roundedMidi) <= 0.42
          ? roundedMidi
          : nearestWhiteKey(pitchAtPointer);
      const pointerId = event.pointerId;
      const heldNote: { cancelled: boolean; release?: () => void } = { cancelled: false };
      heldPianoNotesRef.current.set(pointerId, heldNote);
      void startPianoMidi(midi)
        .then(({ release }) => {
          if (heldNote.cancelled) release();
          else heldNote.release = release;
        })
        .catch(() => {
          if (heldPianoNotesRef.current.get(pointerId) === heldNote) {
            heldPianoNotesRef.current.delete(pointerId);
          }
        });
      dragRef.current = { mode: "keyboard-pan", pointerY: event.clientY, viewport };
      event.currentTarget.style.cursor = "ns-resize";
      return;
    }
    event.currentTarget.setPointerCapture(event.pointerId);
    if (event.pointerType === "touch") {
      touchPointersRef.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
      if (touchPointersRef.current.size === 2) {
        const [first, second] = [...touchPointersRef.current.values()];
        dragRef.current = {
          mode: "pinch",
          distance: Math.max(1, Math.hypot(second.x - first.x, second.y - first.y)),
          midpointX: (first.x + second.x) / 2,
          midpointY: (first.y + second.y) / 2,
          viewport,
        };
        return;
      }
    }
    if (event.pointerType !== "touch" && event.button === 0) {
      dragRef.current = { mode: "playhead", pointerY: event.clientY, viewport };
      event.currentTarget.style.cursor = "ew-resize";
      seekFromPointer(event.clientX);
      return;
    }
    event.currentTarget.style.cursor = "grabbing";
    dragRef.current = { mode: "pan", pointerX: event.clientX, pointerY: event.clientY, viewport };
  };

  const handlePointerMove = (event: React.PointerEvent<HTMLCanvasElement>) => {
    if (event.pointerType === "touch" && touchPointersRef.current.has(event.pointerId)) {
      touchPointersRef.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
    }
    const drag = dragRef.current;
    if (!drag) {
      if (event.pointerType !== "touch") {
        const bounds = event.currentTarget.getBoundingClientRect();
        const x = event.clientX - bounds.left;
        const y = event.clientY - bounds.top;
        event.currentTarget.style.cursor = x <= keyboardWidth ? "ns-resize" : "crosshair";
        const midi = viewport.midiMin + ((bounds.height - y) / Math.max(1, bounds.height)) * viewport.midiSpan;
        setHoveredPitch({
          frequencyHz: midiToFrequency(midi, referencePitchHz),
          note: formatMidiNote(midi),
          x,
          y,
        });
      }
      return;
    }
    if (drag.mode === "keyboard-pan" || drag.mode === "playhead") {
      event.currentTarget.style.cursor = drag.mode === "keyboard-pan" ? "ns-resize" : "ew-resize";
      if (drag.mode === "playhead") seekFromPointer(event.clientX);
      const deltaY = event.clientY - drag.pointerY;
      if (Math.abs(deltaY) >= 1) {
        manualFollowSuspendedRef.current = true;
        setViewport((current) => ({
          ...current,
          ...clampPitchViewport(
            drag.viewport.midiMin + (deltaY / Math.max(1, size.height)) * drag.viewport.midiSpan,
            drag.viewport.midiSpan,
          ),
        }));
      }
      return;
    }
    if (drag.mode === "pinch") {
      const pointers = [...touchPointersRef.current.values()];
      if (pointers.length < 2) return;
      const [first, second] = pointers;
      const distance = Math.max(1, Math.hypot(second.x - first.x, second.y - first.y));
      const midpointX = (first.x + second.x) / 2;
      const midpointY = (first.y + second.y) / 2;
      const scale = drag.distance / distance;
      const bounds = event.currentTarget.getBoundingClientRect();
      const timeRatio = clamp((drag.midpointX - bounds.left - keyboardWidth) / Math.max(1, bounds.width - keyboardWidth), 0, 1);
      const pitchRatio = clamp((bounds.bottom - drag.midpointY) / Math.max(1, bounds.height), 0, 1);
      const timeAnchor = drag.viewport.timeStart + timeRatio * drag.viewport.timeSpan;
      const pitchAnchor = drag.viewport.midiMin + pitchRatio * drag.viewport.midiSpan;
      const maximumTimeSpan = Math.max(0.01, duration, currentTime);
      const timeSpan = clamp(
        drag.viewport.timeSpan * scale,
        Math.min(MIN_TIME_SPAN, maximumTimeSpan),
        maximumTimeSpan,
      );
      const midiSpan = clamp(drag.viewport.midiSpan * scale, MIN_MIDI_SPAN, MAX_MIDI_SPAN);
      const panTime = ((midpointX - drag.midpointX) / Math.max(1, bounds.width - keyboardWidth)) * timeSpan;
      const panPitch = ((drag.midpointY - midpointY) / Math.max(1, bounds.height)) * midiSpan;
      manualFollowSuspendedRef.current = true;
      setViewport({
        ...clampTimeViewport(timeAnchor - timeRatio * timeSpan - panTime, timeSpan, duration, currentTime),
        ...clampPitchViewport(pitchAnchor - pitchRatio * midiSpan - panPitch, midiSpan),
      });
      return;
    }
    const plotWidth = Math.max(1, size.width - keyboardWidth);
    const deltaX = event.clientX - drag.pointerX;
    const deltaY = event.clientY - drag.pointerY;
    event.currentTarget.style.cursor = "grabbing";
    manualFollowSuspendedRef.current = true;
    setViewport({
      ...drag.viewport,
      ...clampTimeViewport(
        drag.viewport.timeStart - (deltaX / plotWidth) * drag.viewport.timeSpan,
        drag.viewport.timeSpan,
        duration,
        currentTime,
      ),
      ...clampPitchViewport(
        drag.viewport.midiMin + (deltaY / Math.max(1, size.height)) * drag.viewport.midiSpan,
        drag.viewport.midiSpan,
      ),
    });
  };

  const endPointerGesture = (event: React.PointerEvent<HTMLCanvasElement>) => {
    touchPointersRef.current.delete(event.pointerId);
    releasePianoPointer(event.pointerId);
    dragRef.current = null;
    const bounds = event.currentTarget.getBoundingClientRect();
    event.currentTarget.style.cursor = event.clientX - bounds.left <= keyboardWidth ? "ns-resize" : "crosshair";
  };

  const handleWheel = (event: React.WheelEvent<HTMLCanvasElement>) => {
    event.preventDefault();
    const bounds = event.currentTarget.getBoundingClientRect();
    const x = event.clientX - bounds.left;
    const y = event.clientY - bounds.top;
    const factor = Math.exp(event.deltaY * 0.0015);
    manualFollowSuspendedRef.current = true;
    if (x <= keyboardWidth) {
      const anchor = viewport.midiMin + ((bounds.height - y) / Math.max(1, bounds.height)) * viewport.midiSpan;
      const midiSpan = clamp(viewport.midiSpan * factor, MIN_MIDI_SPAN, MAX_MIDI_SPAN);
      const midiMin = anchor - ((bounds.height - y) / Math.max(1, bounds.height)) * midiSpan;
      setViewport((current) => ({ ...current, ...clampPitchViewport(midiMin, midiSpan) }));
      return;
    }
    const anchorRatio = (x - keyboardWidth) / Math.max(1, bounds.width - keyboardWidth);
    const anchorTime = viewport.timeStart + anchorRatio * viewport.timeSpan;
    const maximumSpan = Math.max(0.01, duration, currentTime);
    const timeSpan = clamp(viewport.timeSpan * factor, Math.min(MIN_TIME_SPAN, maximumSpan), maximumSpan);
    const timeStart = anchorTime - anchorRatio * timeSpan;
    setViewport((current) => ({
      ...current,
      ...clampTimeViewport(timeStart, timeSpan, duration, currentTime),
    }));
  };

  return (
    <div className="pitch-preview">
      <div ref={shellRef} className="pitch-preview-main">
        <canvas
          ref={canvasRef}
          aria-label="基频预览图；琴键宽度随音高缩放变化，琴键区可上下拖动，左键定位播放头并纵向滚动音高，右键拖动平移"
          onAuxClick={(event) => {
            if (event.button !== 2) return;
            event.preventDefault();
            event.stopPropagation();
            event.nativeEvent.stopImmediatePropagation();
          }}
          onContextMenu={(event) => {
            event.preventDefault();
            event.stopPropagation();
            event.nativeEvent.stopImmediatePropagation();
          }}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={endPointerGesture}
          onPointerCancel={endPointerGesture}
          onLostPointerCapture={(event) => releasePianoPointer(event.pointerId)}
          onPointerLeave={(event) => {
            if (!dragRef.current) event.currentTarget.style.cursor = "crosshair";
            setHoveredPitch(null);
          }}
          onWheel={handleWheel}
        />
        {hoveredPitch ? (
          <span
            className="pitch-hover-tooltip"
            style={{ left: Math.max(keyboardWidth + 4, hoveredPitch.x + 10), top: Math.max(4, hoveredPitch.y - 28) }}
          >
            {hoveredPitch.note} · {hoveredPitch.frequencyHz.toFixed(2)} Hz
          </span>
        ) : null}
      </div>
      <PitchNavigator
        currentTime={currentTime}
        duration={Math.max(duration, currentTime, 0.01)}
        frames={frames}
        onViewportChange={(timeStart, timeSpan) => {
          manualFollowSuspendedRef.current = true;
          setViewport((current) => ({
            ...current,
            ...clampTimeViewport(timeStart, timeSpan, duration, currentTime),
          }));
        }}
        referencePitchHz={referencePitchHz}
        viewport={viewport}
      />
    </div>
  );
}

interface PitchNavigatorProps {
  currentTime: number;
  duration: number;
  frames: readonly VocalPitchFrame[];
  onViewportChange: (timeStart: number, timeSpan: number) => void;
  referencePitchHz: number;
  viewport: PitchViewport;
}

function PitchNavigator({ currentTime, duration, frames, onViewportChange, referencePitchHz, viewport }: PitchNavigatorProps) {
  const shellRef = useRef<HTMLDivElement | null>(null);
  const dragRef = useRef<{ mode: "left" | "right" | "window"; startX: number; start: number; end: number } | null>(null);
  const visibleStart = clamp(viewport.timeStart / duration, 0, 1);
  const visibleEnd = clamp((viewport.timeStart + viewport.timeSpan) / duration, visibleStart, 1);
  const pitchRange = useMemo(() => {
    let minimum = Infinity;
    let maximum = -Infinity;
    for (const frame of frames) {
      if (frame.frequencyHz === null) continue;
      const midi = frequencyToMidi(frame.frequencyHz, referencePitchHz);
      if (!Number.isFinite(midi)) continue;
      minimum = Math.min(minimum, midi);
      maximum = Math.max(maximum, midi);
    }
    if (!Number.isFinite(minimum) || !Number.isFinite(maximum)) return null;
    const padding = Math.max(1, (maximum - minimum) * 0.08);
    return { minimum: minimum - padding, span: Math.max(0.01, maximum - minimum + padding * 2) };
  }, [frames, referencePitchHz]);
  const sampledPath = useMemo(() => {
    const step = Math.max(1, Math.ceil(frames.length / 600));
    const commands: string[] = [];
    let drawing = false;
    let previousTime = -Infinity;
    for (let index = 0; index < frames.length; index += step) {
      const frame = frames[index];
      if (frame.frequencyHz === null || frame.timeSeconds - previousTime > Math.max(0.05, step * 0.02)) {
        drawing = false;
        previousTime = frame.timeSeconds;
        continue;
      }
      const x = (frame.timeSeconds / duration) * 1000;
      const midi = frequencyToMidi(frame.frequencyHz, referencePitchHz);
      const y = pitchRange ? 38 - clamp((midi - pitchRange.minimum) / pitchRange.span, 0, 1) * 34 : 21;
      commands.push(`${drawing ? "L" : "M"}${x.toFixed(1)},${y.toFixed(1)}`);
      drawing = true;
      previousTime = frame.timeSeconds;
    }
    return commands.join(" ");
  }, [duration, frames, pitchRange, referencePitchHz]);

  const applyDrag = (event: React.PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    const bounds = shellRef.current?.getBoundingClientRect();
    if (!drag || !bounds) {
      return;
    }
    const delta = (event.clientX - drag.startX) / Math.max(1, bounds.width);
    const minimumRatio = Math.min(1, MIN_TIME_SPAN / duration);
    if (drag.mode === "window") {
      const width = drag.end - drag.start;
      const start = clamp(drag.start + delta, 0, 1 - width);
      onViewportChange(start * duration, width * duration);
      return;
    }
    if (drag.mode === "left") {
      const start = clamp(drag.start + delta, 0, drag.end - minimumRatio);
      onViewportChange(start * duration, (drag.end - start) * duration);
      return;
    }
    const end = clamp(drag.end + delta, drag.start + minimumRatio, 1);
    onViewportChange(drag.start * duration, (end - drag.start) * duration);
  };

  const handleWheel = (event: React.WheelEvent<HTMLDivElement>) => {
    event.preventDefault();
    const bounds = event.currentTarget.getBoundingClientRect();
    const pointerRatio = clamp((event.clientX - bounds.left) / Math.max(1, bounds.width), 0, 1);
    const pointerTime = pointerRatio * duration;
    const minimumSpan = Math.min(MIN_TIME_SPAN, duration);
    const timeSpan = clamp(viewport.timeSpan * Math.exp(event.deltaY * 0.0015), minimumSpan, duration);
    const timeStart = clamp(pointerTime - timeSpan / 2, 0, Math.max(0, duration - timeSpan));
    onViewportChange(timeStart, timeSpan);
  };

  return (
    <div
      ref={shellRef}
      className="pitch-navigator"
      onWheel={handleWheel}
      onPointerMove={applyDrag}
      onPointerUp={(event) => {
        event.currentTarget.releasePointerCapture(event.pointerId);
        dragRef.current = null;
      }}
      onPointerCancel={() => {
        dragRef.current = null;
      }}
    >
      <svg aria-hidden="true" preserveAspectRatio="none" viewBox="0 0 1000 40">
        <path d={sampledPath} />
        <line x1={(currentTime / duration) * 1000} x2={(currentTime / duration) * 1000} y1="0" y2="40" />
      </svg>
      <div
        className="pitch-navigator-window"
        style={{ left: `${visibleStart * 100}%`, width: `${Math.max(0.5, (visibleEnd - visibleStart) * 100)}%` }}
        onPointerDown={(event) => {
          event.currentTarget.parentElement?.setPointerCapture(event.pointerId);
          dragRef.current = { mode: "window", startX: event.clientX, start: visibleStart, end: visibleEnd };
        }}
      >
        <span
          onPointerDown={(event) => {
            event.stopPropagation();
            event.currentTarget.parentElement?.parentElement?.setPointerCapture(event.pointerId);
            dragRef.current = { mode: "left", startX: event.clientX, start: visibleStart, end: visibleEnd };
          }}
        />
        <span
          onPointerDown={(event) => {
            event.stopPropagation();
            event.currentTarget.parentElement?.parentElement?.setPointerCapture(event.pointerId);
            dragRef.current = { mode: "right", startX: event.clientX, start: visibleStart, end: visibleEnd };
          }}
        />
      </div>
    </div>
  );
}
