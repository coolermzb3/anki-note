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
      pointerClickRef.current = false;
      const button = event.target instanceof Element ? event.target.closest("button") : null;
      if (!(button instanceof HTMLButtonElement)) {
        return;
      }
      window.setTimeout(() => {
        if (document.activeElement === button) {
          button.blur();
        }
      }, 0);
    };

    document.addEventListener("pointerdown", markPointerClick, true);
    document.addEventListener("click", blurClickedButton, true);
    return () => {
      document.removeEventListener("pointerdown", markPointerClick, true);
      document.removeEventListener("click", blurClickedButton, true);
    };
  }, []);
}
