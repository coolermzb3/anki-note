import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { WebMidi, type Input, type Listener, type NoteMessageEvent } from "webmidi";
import {
  getInitialMidiAccessStatus,
  isPianoKeyName,
  makeMidiKeyId,
  registerMidiPress,
  type MidiAccessStatus,
  type MidiNoteInput,
  type MidiNoteInputEvent,
} from "./midiInput";

const MIDI_INPUT_ID_STORAGE_KEY = "anki-note.midiInputId";

export interface MidiInputDevice {
  id: string;
  manufacturer: string;
  name: string;
}

export interface MidiInputController {
  connect: () => Promise<void>;
  errorMessage?: string;
  inputs: MidiInputDevice[];
  isConnected: boolean;
  lastNote?: MidiNoteInput;
  selectInput: (inputId: string) => void;
  selectedInput?: MidiInputDevice;
  selectedInputId?: string;
  status: MidiAccessStatus;
  subscribe: (listener: (event: MidiNoteInputEvent) => void) => () => void;
}

function readStoredInputId(): string | undefined {
  try {
    return localStorage.getItem(MIDI_INPUT_ID_STORAGE_KEY) ?? undefined;
  } catch {
    return undefined;
  }
}

function storeInputId(inputId: string): void {
  try {
    localStorage.setItem(MIDI_INPUT_ID_STORAGE_KEY, inputId);
  } catch {
    return;
  }
}

function describeMidiError(error: unknown): { message: string; status: MidiAccessStatus } {
  if (error instanceof DOMException && (error.name === "NotAllowedError" || error.name === "SecurityError")) {
    return { message: "MIDI 权限未授予，请在浏览器地址栏中允许后重试。", status: "denied" };
  }
  return {
    message: error instanceof Error ? error.message : String(error),
    status: "error",
  };
}

function toDevice(input: Input): MidiInputDevice {
  return {
    id: input.id,
    manufacturer: input.manufacturer ?? "",
    name: input.name ?? "未命名 MIDI 输入",
  };
}

function asListenerArray(listeners: Listener | Listener[]): Listener[] {
  return Array.isArray(listeners) ? listeners : [listeners];
}

export function useMidiInput(): MidiInputController {
  const isSecureMidiContext = typeof window === "undefined" || window.isSecureContext;
  const hasNativeMidiAccess = typeof navigator !== "undefined" && typeof navigator.requestMIDIAccess === "function";
  const [status, setStatus] = useState<MidiAccessStatus>(() =>
    getInitialMidiAccessStatus(isSecureMidiContext, hasNativeMidiAccess),
  );
  const [errorMessage, setErrorMessage] = useState<string>();
  const [inputs, setInputs] = useState<MidiInputDevice[]>([]);
  const [selectedInputId, setSelectedInputId] = useState<string | undefined>(readStoredInputId);
  const [lastNote, setLastNote] = useState<MidiNoteInput>();
  const selectedInputIdRef = useRef(selectedInputId);
  const initialSelectionResolvedRef = useRef(false);
  const pressedNotesRef = useRef(new Map<string, MidiNoteInput>());
  const subscribersRef = useRef(new Set<(event: MidiNoteInputEvent) => void>());
  const inputListenersRef = useRef<Listener[]>([]);
  const webMidiListenersRef = useRef<Listener[]>([]);

  selectedInputIdRef.current = selectedInputId;

  const publish = useCallback((event: MidiNoteInputEvent): void => {
    for (const listener of subscribersRef.current) {
      listener(event);
    }
  }, []);

  const resetPressedNotes = useCallback((): void => {
    if (pressedNotesRef.current.size === 0) {
      return;
    }
    pressedNotesRef.current.clear();
    publish({ type: "reset" });
  }, [publish]);

  const detachInputListeners = useCallback((): void => {
    for (const listener of inputListenersRef.current) {
      listener.remove();
    }
    inputListenersRef.current = [];
    resetPressedNotes();
  }, [resetPressedNotes]);

  const makeNote = useCallback((event: NoteMessageEvent): MidiNoteInput | undefined => {
    if (!isPianoKeyName(event.note.name)) {
      return undefined;
    }
    const channel = event.message.channel;
    const inputId = event.port.id;
    const midiNoteNumber = event.note.number;
    return {
      keyId: makeMidiKeyId(inputId, channel, midiNoteNumber),
      keyName: event.note.name,
      midiNoteNumber,
      octave: event.note.octave,
    };
  }, []);

  const handleNoteOn = useCallback((event: NoteMessageEvent): void => {
    const note = makeNote(event);
    if (!note || !registerMidiPress(pressedNotesRef.current, note.keyId, note)) {
      return;
    }
    setLastNote(note);
    publish({ note, type: "press" });
  }, [makeNote, publish]);

  const handleNoteOff = useCallback((event: NoteMessageEvent): void => {
    const note = makeNote(event);
    if (!note) {
      return;
    }
    const pressedNote = pressedNotesRef.current.get(note.keyId);
    if (!pressedNote) {
      return;
    }
    pressedNotesRef.current.delete(note.keyId);
    publish({ note: pressedNote, type: "release" });
  }, [makeNote, publish]);

  const syncSelectedInputListeners = useCallback((): void => {
    detachInputListeners();
    const input = WebMidi.inputs.find((candidate) => candidate.id === selectedInputIdRef.current);
    if (!input) {
      return;
    }
    const allNotesOffListeners = input.addListener("allnotesoff", resetPressedNotes);
    inputListenersRef.current = [
      ...asListenerArray(input.addListener("noteon", handleNoteOn)),
      ...asListenerArray(input.addListener("noteoff", handleNoteOff)),
      ...asListenerArray(allNotesOffListeners),
    ];
  }, [detachInputListeners, handleNoteOff, handleNoteOn, resetPressedNotes]);

  const refreshInputs = useCallback((resolveInitialSelection = false): void => {
    const nextInputs = WebMidi.inputs.map(toDevice);
    setInputs(nextInputs);
    if (resolveInitialSelection && !initialSelectionResolvedRef.current) {
      initialSelectionResolvedRef.current = true;
      const storedSelection = selectedInputIdRef.current;
      const nextSelection = nextInputs.some((input) => input.id === storedSelection)
        ? storedSelection
        : nextInputs[0]?.id;
      selectedInputIdRef.current = nextSelection;
      setSelectedInputId(nextSelection);
      if (nextSelection) {
        storeInputId(nextSelection);
      }
    }
    if (!nextInputs.some((input) => input.id === selectedInputIdRef.current)) {
      setLastNote(undefined);
    }
    syncSelectedInputListeners();
  }, [syncSelectedInputListeners]);

  const attachWebMidiListeners = useCallback((): void => {
    if (webMidiListenersRef.current.length > 0) {
      return;
    }
    webMidiListenersRef.current = [
      WebMidi.addListener("connected", () => refreshInputs()),
      WebMidi.addListener("disconnected", () => refreshInputs()),
    ];
  }, [refreshInputs]);

  const connect = useCallback(async (): Promise<void> => {
    if (!isSecureMidiContext) {
      setStatus("insecure-context");
      return;
    }
    if (!hasNativeMidiAccess) {
      setStatus("unsupported");
      return;
    }
    setStatus("requesting");
    setErrorMessage(undefined);
    try {
      await WebMidi.enable({ sysex: false });
      attachWebMidiListeners();
      refreshInputs(true);
      setStatus("ready");
    } catch (error) {
      const described = describeMidiError(error);
      setErrorMessage(described.message);
      setStatus(described.status);
    }
  }, [attachWebMidiListeners, hasNativeMidiAccess, isSecureMidiContext, refreshInputs]);

  const selectInput = useCallback((inputId: string): void => {
    setLastNote(undefined);
    selectedInputIdRef.current = inputId;
    setSelectedInputId(inputId);
    storeInputId(inputId);
    syncSelectedInputListeners();
  }, [syncSelectedInputListeners]);

  const subscribe = useCallback((listener: (event: MidiNoteInputEvent) => void): (() => void) => {
    subscribersRef.current.add(listener);
    return () => subscribersRef.current.delete(listener);
  }, []);

  useEffect(() => {
    if (!WebMidi.enabled) {
      return;
    }
    attachWebMidiListeners();
    refreshInputs(true);
    setStatus("ready");
  }, [attachWebMidiListeners, refreshInputs]);

  useEffect(() => () => {
    detachInputListeners();
    for (const listener of webMidiListenersRef.current) {
      listener.remove();
    }
    webMidiListenersRef.current = [];
  }, [detachInputListeners]);

  const selectedInput = inputs.find((input) => input.id === selectedInputId);
  return useMemo(() => ({
    connect,
    errorMessage,
    inputs,
    isConnected: status === "ready" && selectedInput !== undefined,
    lastNote,
    selectInput,
    selectedInput,
    selectedInputId,
    status,
    subscribe,
  }), [connect, errorMessage, inputs, lastNote, selectInput, selectedInput, selectedInputId, status, subscribe]);
}
