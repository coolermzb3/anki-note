import { useCallback, useEffect, useRef, useState } from "react";
import { startTargetNote, type SustainedPianoNote } from "../audio/piano";
import type { PromptNoteDuration, TargetNote } from "../domain/types";
import {
  getRemainingPlaybackToggleAction,
  type RemainingPlaybackState,
} from "./remainingNotePlayback";
import { getPausedPlaybackIntervalMs } from "./staffPageUiPreferences";

interface RemainingPlaybackRuntime {
  activeNote?: SustainedPianoNote;
  nextIndex: number;
  notes: TargetNote[];
  playAttempt: number;
  playNext: () => void;
  timeoutId?: number;
}

export function useRemainingNotePlayback({
  bpm,
  getNotes,
  noteDuration,
}: {
  bpm: number;
  getNotes: () => TargetNote[];
  noteDuration: PromptNoteDuration;
}): {
  cancel: () => void;
  state: RemainingPlaybackState;
  toggle: () => void;
} {
  const [state, setState] = useState<RemainingPlaybackState>("idle");
  const stateRef = useRef<RemainingPlaybackState>("idle");
  const runtimeRef = useRef<RemainingPlaybackRuntime | null>(null);
  const bpmRef = useRef(bpm);
  const noteDurationRef = useRef(noteDuration);

  useEffect(() => {
    bpmRef.current = bpm;
  }, [bpm]);

  useEffect(() => {
    noteDurationRef.current = noteDuration;
  }, [noteDuration]);

  const updateState = useCallback((nextState: RemainingPlaybackState): void => {
    stateRef.current = nextState;
    setState(nextState);
  }, []);

  const cancel = useCallback(
    (runtime: RemainingPlaybackRuntime | null = runtimeRef.current): void => {
      if (!runtime) {
        updateState("idle");
        return;
      }
      runtime.playAttempt += 1;
      if (runtime.timeoutId !== undefined) {
        window.clearTimeout(runtime.timeoutId);
        runtime.timeoutId = undefined;
      }
      runtime.activeNote?.release();
      runtime.activeNote = undefined;
      if (runtimeRef.current === runtime) {
        runtimeRef.current = null;
        updateState("idle");
      }
    },
    [updateState],
  );

  const start = useCallback((): void => {
    const notes = getNotes();
    if (notes.length === 0) {
      return;
    }
    const runtime: RemainingPlaybackRuntime = {
      nextIndex: 0,
      notes,
      playAttempt: 0,
      playNext: () => undefined,
    };
    const playNext = (): void => {
      if (runtimeRef.current !== runtime || stateRef.current !== "playing") {
        return;
      }
      const noteIndex = runtime.nextIndex;
      const note = runtime.notes[noteIndex];
      if (!note) {
        cancel(runtime);
        return;
      }
      const playAttempt = ++runtime.playAttempt;
      void startTargetNote(note)
        .then((activeNote) => {
          if (
            runtimeRef.current !== runtime ||
            stateRef.current !== "playing" ||
            runtime.playAttempt !== playAttempt
          ) {
            activeNote.release();
            return;
          }
          runtime.activeNote = activeNote;
          runtime.nextIndex = noteIndex + 1;
          const intervalMs = getPausedPlaybackIntervalMs(bpmRef.current, noteDurationRef.current);
          runtime.timeoutId = window.setTimeout(() => {
            if (runtimeRef.current !== runtime || runtime.playAttempt !== playAttempt) {
              return;
            }
            runtime.timeoutId = undefined;
            runtime.activeNote?.release();
            runtime.activeNote = undefined;
            if (runtime.nextIndex >= runtime.notes.length) {
              cancel(runtime);
              return;
            }
            runtime.playNext();
          }, intervalMs);
        })
        .catch(() => cancel(runtime));
    };
    runtime.playNext = playNext;
    runtimeRef.current = runtime;
    updateState("playing");
    runtime.playNext();
  }, [cancel, getNotes, updateState]);

  const toggle = useCallback((): void => {
    const runtime = runtimeRef.current;
    if (!runtime) {
      start();
      return;
    }
    const action = getRemainingPlaybackToggleAction(
      stateRef.current,
      runtime.nextIndex < runtime.notes.length,
    );
    if (action === "start") {
      start();
      return;
    }
    if (action === "resume") {
      updateState("playing");
      runtime.playNext();
      return;
    }
    if (action === "complete") {
      cancel(runtime);
      return;
    }
    runtime.playAttempt += 1;
    if (runtime.timeoutId !== undefined) {
      window.clearTimeout(runtime.timeoutId);
      runtime.timeoutId = undefined;
    }
    runtime.activeNote?.release();
    runtime.activeNote = undefined;
    updateState("paused");
  }, [cancel, start, updateState]);

  useEffect(
    () => () => {
      const runtime = runtimeRef.current;
      if (runtime?.timeoutId !== undefined) {
        window.clearTimeout(runtime.timeoutId);
      }
      runtime?.activeNote?.release();
    },
    [],
  );

  return { cancel, state, toggle };
}
