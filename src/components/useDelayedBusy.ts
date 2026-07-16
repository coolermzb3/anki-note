import { useCallback, useRef, useState } from "react";

const BUSY_STATUS_DELAY_MS = 120;

interface DelayedBusy {
  isBusyVisible: boolean;
  run(action: () => Promise<void>): Promise<void>;
}

export function useDelayedBusy(): DelayedBusy {
  const runningRef = useRef(false);
  const [isBusyVisible, setIsBusyVisible] = useState(false);

  const run = useCallback(async (action: () => Promise<void>): Promise<void> => {
    if (runningRef.current) {
      return;
    }
    runningRef.current = true;
    const busyStatusTimer = window.setTimeout(() => {
      setIsBusyVisible(true);
    }, BUSY_STATUS_DELAY_MS);
    try {
      await action();
    } finally {
      window.clearTimeout(busyStatusTimer);
      setIsBusyVisible(false);
      runningRef.current = false;
    }
  }, []);

  return { isBusyVisible, run };
}
