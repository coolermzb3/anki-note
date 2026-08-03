import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { useLocalStorageState } from "../useLocalStorageState";

const DEFAULT_SIDEBAR_WIDTH = 320;
const MIN_SIDEBAR_WIDTH = 260;
const MAX_SIDEBAR_WIDTH = 520;

function clampSidebarWidth(value: number): number {
  return Math.min(MAX_SIDEBAR_WIDTH, Math.max(MIN_SIDEBAR_WIDTH, value));
}

function parseSidebarWidth(value: unknown, fallback: number): number {
  return typeof value === "number" ? clampSidebarWidth(value) : fallback;
}

export function useVocalSidebarResize() {
  const [sidebarWidth, setSidebarWidth] = useLocalStorageState(
    "anki-note.vocalPitch.sidebarWidth",
    DEFAULT_SIDEBAR_WIDTH,
    { parse: parseSidebarWidth },
  );
  const workspaceRef = useRef<HTMLDivElement | null>(null);
  const resizeRef = useRef<{
    frame: number | null;
    latestWidth: number;
    startWidth: number;
    startX: number;
  } | null>(null);
  const mouseCleanupRef = useRef<(() => void) | null>(null);

  useLayoutEffect(() => {
    workspaceRef.current?.style.setProperty("--vocal-sidebar-width", `${sidebarWidth}px`);
  }, [sidebarWidth]);

  useEffect(() => () => {
    mouseCleanupRef.current?.();
    const resize = resizeRef.current;
    if (resize?.frame !== null && resize?.frame !== undefined) {
      cancelAnimationFrame(resize.frame);
    }
    document.documentElement.classList.remove("vocal-sidebar-resizing");
  }, []);

  const startResize = useCallback((clientX: number) => {
    resizeRef.current = {
      frame: null,
      latestWidth: sidebarWidth,
      startWidth: sidebarWidth,
      startX: clientX,
    };
    document.documentElement.classList.add("vocal-sidebar-resizing");
  }, [sidebarWidth]);

  const moveResize = useCallback((clientX: number) => {
    const resize = resizeRef.current;
    if (!resize) return;
    resize.latestWidth = clampSidebarWidth(resize.startWidth - (clientX - resize.startX));
    if (resize.frame !== null) return;
    resize.frame = requestAnimationFrame(() => {
      const current = resizeRef.current;
      if (!current) return;
      workspaceRef.current?.style.setProperty("--vocal-sidebar-width", `${current.latestWidth}px`);
      current.frame = null;
    });
  }, []);

  const finishResize = useCallback(() => {
    const resize = resizeRef.current;
    if (!resize) return;
    if (resize.frame !== null) cancelAnimationFrame(resize.frame);
    workspaceRef.current?.style.setProperty("--vocal-sidebar-width", `${resize.latestWidth}px`);
    resizeRef.current = null;
    document.documentElement.classList.remove("vocal-sidebar-resizing");
    setSidebarWidth(resize.latestWidth);
  }, [setSidebarWidth]);

  const beginMouseResize = useCallback((event: ReactMouseEvent<HTMLDivElement>) => {
    event.preventDefault();
    startResize(event.clientX);
    const handleMove = (moveEvent: MouseEvent) => moveResize(moveEvent.clientX);
    const cleanup = () => {
      document.removeEventListener("mousemove", handleMove);
      document.removeEventListener("mouseup", handleUp);
      mouseCleanupRef.current = null;
    };
    const handleUp = () => {
      cleanup();
      finishResize();
    };
    mouseCleanupRef.current?.();
    mouseCleanupRef.current = cleanup;
    document.addEventListener("mousemove", handleMove);
    document.addEventListener("mouseup", handleUp);
  }, [finishResize, moveResize, startResize]);

  const beginTouchResize = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.pointerType !== "touch") return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    startResize(event.clientX);
  }, [startResize]);

  const moveTouchResize = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.pointerType === "touch") moveResize(event.clientX);
  }, [moveResize]);

  const finishTouchResize = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.pointerType !== "touch") return;
    finishResize();
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  }, [finishResize]);

  const resetSidebarWidth = useCallback(() => {
    workspaceRef.current?.style.setProperty("--vocal-sidebar-width", `${DEFAULT_SIDEBAR_WIDTH}px`);
    setSidebarWidth(DEFAULT_SIDEBAR_WIDTH);
  }, [setSidebarWidth]);

  return {
    beginMouseResize,
    beginTouchResize,
    finishTouchResize,
    moveTouchResize,
    resetSidebarWidth,
    workspaceRef,
  };
}
