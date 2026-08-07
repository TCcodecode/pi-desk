import { useCallback, useEffect, useRef } from "react";

type ActiveDrag = {
  startX: number;
  move: (dx: number) => void;
  previousCursor: string;
  previousUserSelect: string;
};

/**
 * Wires a horizontal drag gesture (window mousemove/mouseup) with body
 * cursor/userSelect management and unmount cleanup.
 *
 * Returns a handler for the resizer's `onMouseDown`; pass a `move(dx)`
 * callback that applies the delta (e.g. `setWidth(clamp(startWidth - dx))`).
 * Replaces the duplicated drag-resize wiring in App.tsx (right panel and
 * sidebar) and HttpWorkbench.tsx (chat panel).
 */
export function useDragResize(): (event: React.MouseEvent<HTMLElement>, move: (dx: number) => void) => void {
  const dragRef = useRef<ActiveDrag | null>(null);

  useEffect(() => {
    const onMove = (event: MouseEvent) => {
      const drag = dragRef.current;
      if (!drag) return;
      drag.move(event.clientX - drag.startX);
    };
    const onUp = () => {
      const drag = dragRef.current;
      if (!drag) return;
      dragRef.current = null;
      document.body.style.cursor = drag.previousCursor;
      document.body.style.userSelect = drag.previousUserSelect;
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
      const drag = dragRef.current;
      if (drag) {
        document.body.style.cursor = drag.previousCursor;
        document.body.style.userSelect = drag.previousUserSelect;
      }
      dragRef.current = null;
    };
  }, []);

  return useCallback((event, move) => {
    event.preventDefault();
    dragRef.current = {
      startX: event.clientX,
      move,
      previousCursor: document.body.style.cursor,
      previousUserSelect: document.body.style.userSelect,
    };
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
  }, []);
}
