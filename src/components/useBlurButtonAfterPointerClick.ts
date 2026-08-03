import { useEffect, useRef } from "react";

export function useBlurButtonAfterPointerClick(): void {
  const pointerClickRef = useRef(false);

  useEffect(() => {
    const markPointerClick = (event: PointerEvent): void => {
      if (event.button !== 0 || !event.isPrimary) {
        return;
      }
      pointerClickRef.current = true;
      window.setTimeout(() => {
        pointerClickRef.current = false;
      }, 1000);
    };

    const blurClickedButton = (event: MouseEvent): void => {
      if (!pointerClickRef.current) {
        return;
      }
      const button = event.target instanceof Element ? event.target.closest("button") : null;
      if (!(button instanceof HTMLButtonElement)) {
        return;
      }
      pointerClickRef.current = false;
      window.setTimeout(() => {
        if (document.activeElement === button) {
          button.blur();
        }
      }, 0);
    };

    const blurPointerSelectedControl = (event: Event): void => {
      if (!pointerClickRef.current || !(event.target instanceof HTMLSelectElement)) {
        return;
      }
      pointerClickRef.current = false;
      const select = event.target;
      window.setTimeout(() => select.blur(), 0);
    };

    const blurPointerAdjustedRange = (event: PointerEvent): void => {
      if (
        !pointerClickRef.current ||
        !(event.target instanceof HTMLInputElement) ||
        event.target.type !== "range"
      ) {
        return;
      }
      pointerClickRef.current = false;
      const input = event.target;
      window.setTimeout(() => input.blur(), 0);
    };

    document.addEventListener("pointerdown", markPointerClick, true);
    document.addEventListener("click", blurClickedButton, true);
    document.addEventListener("change", blurPointerSelectedControl, true);
    document.addEventListener("pointerup", blurPointerAdjustedRange, true);
    return () => {
      document.removeEventListener("pointerdown", markPointerClick, true);
      document.removeEventListener("click", blurClickedButton, true);
      document.removeEventListener("change", blurPointerSelectedControl, true);
      document.removeEventListener("pointerup", blurPointerAdjustedRange, true);
    };
  }, []);
}
