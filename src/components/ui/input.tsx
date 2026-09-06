import * as React from "react";

import { cn } from "@/lib/utils";

const Input = React.forwardRef<HTMLInputElement, React.ComponentProps<"input">>(
  ({ className, type, onFocus, onMouseUp, ...props }, ref) => {
    // Numeric fields always show a canonical value (often 0). Clicking such a
    // field used to leave the caret next to that digit, so typing 23 produced
    // 230 / 023. Selecting the existing value on focus makes the first
    // keystroke REPLACE it, which is what an operator expects. No value state
    // is owned here — this only changes the caret selection.
    const selectOnFocus = React.useCallback(
      (event: React.FocusEvent<HTMLInputElement>) => {
        if (type === "number") event.currentTarget.select();
        onFocus?.(event);
      },
      [onFocus, type],
    );
    // Browsers collapse the selection on mouse-up after focus; keep it when the
    // click is what focused the field.
    const keepSelection = React.useCallback(
      (event: React.MouseEvent<HTMLInputElement>) => {
        if (
          type === "number" &&
          event.currentTarget.selectionStart === event.currentTarget.selectionEnd &&
          event.currentTarget.dataset["justFocused"] === "true"
        ) {
          event.currentTarget.select();
        }
        if (type === "number") delete event.currentTarget.dataset["justFocused"];
        onMouseUp?.(event);
      },
      [onMouseUp, type],
    );
    return (
      <input
        type={type}
        className={cn(
          "flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-base shadow-sm transition-colors file:border-0 file:bg-transparent file:text-sm file:font-medium file:text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50 md:text-sm",
          className,
        )}
        ref={ref}
        onFocus={(event) => {
          if (type === "number") event.currentTarget.dataset["justFocused"] = "true";
          selectOnFocus(event);
        }}
        onMouseUp={keepSelection}
        {...props}
      />
    );
  },
);
Input.displayName = "Input";

export { Input };
