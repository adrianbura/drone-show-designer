import { useEffect } from "react";

/**
 * NUMERIC FIELD CARET BEHAVIOUR (presentation only).
 *
 * Every numeric field in the studio shows a canonical value, very often 0.
 * Clicking such a field used to leave the caret beside that digit, so typing
 * "23" produced "230" or "023". This hook selects the existing text when a
 * number field gains focus, so the first keystroke replaces it.
 *
 * It owns NO value state and never changes what is submitted — only the
 * selection inside the field.
 */
export function useNumericFieldSelection(): void {
  useEffect(() => {
    if (typeof document === "undefined") return;

    const isNumberField = (node: EventTarget | null): node is HTMLInputElement =>
      node instanceof HTMLInputElement && node.type === "number" && !node.readOnly;

    let pending: HTMLInputElement | null = null;

    const onFocusIn = (event: FocusEvent) => {
      const target = event.target;
      if (!isNumberField(target)) return;
      pending = target;
      target.select();
    };

    // Browsers collapse the selection on the mouse-up that follows the click
    // which focused the field; restore it in that case only.
    const onMouseUp = (event: MouseEvent) => {
      const target = event.target;
      if (!isNumberField(target) || target !== pending) return;
      pending = null;
      if (target.selectionStart === target.selectionEnd) target.select();
    };

    const onFocusOut = () => {
      pending = null;
    };

    document.addEventListener("focusin", onFocusIn, true);
    document.addEventListener("mouseup", onMouseUp, true);
    document.addEventListener("focusout", onFocusOut, true);
    return () => {
      document.removeEventListener("focusin", onFocusIn, true);
      document.removeEventListener("mouseup", onMouseUp, true);
      document.removeEventListener("focusout", onFocusOut, true);
    };
  }, []);
}
