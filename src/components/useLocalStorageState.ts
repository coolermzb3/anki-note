import { useEffect, useState, type Dispatch, type SetStateAction } from "react";

interface LocalStorageStateOptions<T> {
  parse?: (value: unknown, fallback: T) => T;
  serialize?: (value: T) => unknown;
}

function readLocalStorageState<T>(
  key: string,
  fallback: T,
  parse: ((value: unknown, fallback: T) => T) | undefined,
): T {
  if (typeof window === "undefined") {
    return fallback;
  }

  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) {
      return fallback;
    }
    const parsed: unknown = JSON.parse(raw);
    return parse ? parse(parsed, fallback) : (parsed as T);
  } catch {
    return fallback;
  }
}

function writeLocalStorageState<T>(
  key: string,
  value: T,
  serialize: ((value: T) => unknown) | undefined,
): void {
  if (typeof window === "undefined") {
    return;
  }

  try {
    window.localStorage.setItem(key, JSON.stringify(serialize ? serialize(value) : value));
  } catch {
    // UI preferences should not block the page when browser storage is unavailable.
  }
}

export function useLocalStorageState<T>(
  key: string,
  fallback: T,
  options: LocalStorageStateOptions<T> = {},
): [T, Dispatch<SetStateAction<T>>] {
  const { parse, serialize } = options;
  const [state, setState] = useState(() => readLocalStorageState(key, fallback, parse));

  useEffect(() => {
    setState(readLocalStorageState(key, fallback, parse));
  }, [fallback, key, parse]);

  useEffect(() => {
    writeLocalStorageState(key, state, serialize);
  }, [key, serialize, state]);

  return [state, setState];
}
