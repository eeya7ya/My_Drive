"use client";

/**
 * Long-press as a stand-in for right-click.
 *
 * Every management action in this design hangs off a context menu, which a
 * touch device cannot open. Holding an item for half a second opens the same
 * menu at the finger, which is the gesture phone users already expect.
 *
 * The press must not also fire the element's click handler — otherwise holding
 * a folder would open the menu and navigate into the folder at once — so the
 * handlers expose `suppressClick` for the click handler to consult.
 */

import { useCallback, useRef } from "react";

const HOLD_MS = 500;
/** Past this much finger drift it is a scroll, not a press. */
const MOVE_TOLERANCE_PX = 10;

/** A minimal stand-in for the MouseEvent the menu builders expect. */
export function syntheticMouseEvent(x: number, y: number) {
  return {
    clientX: x,
    clientY: y,
    preventDefault() {},
    stopPropagation() {},
  } as unknown as React.MouseEvent;
}

export function useLongPress(onLongPress: (ev: React.MouseEvent) => void) {
  const timer = useRef<number | null>(null);
  const start = useRef<{ x: number; y: number } | null>(null);
  const fired = useRef(false);

  const clear = useCallback(() => {
    if (timer.current !== null) {
      window.clearTimeout(timer.current);
      timer.current = null;
    }
    start.current = null;
  }, []);

  const onTouchStart = useCallback(
    (e: React.TouchEvent) => {
      const t = e.touches[0];
      if (!t) return;
      fired.current = false;
      start.current = { x: t.clientX, y: t.clientY };
      timer.current = window.setTimeout(() => {
        fired.current = true;
        // Haptic confirmation where the platform offers it, so the menu does
        // not appear to come from nowhere.
        navigator.vibrate?.(15);
        onLongPress(syntheticMouseEvent(t.clientX, t.clientY));
      }, HOLD_MS);
    },
    [onLongPress]
  );

  const onTouchMove = useCallback(
    (e: React.TouchEvent) => {
      const t = e.touches[0];
      if (!t || !start.current) return;
      const dx = Math.abs(t.clientX - start.current.x);
      const dy = Math.abs(t.clientY - start.current.y);
      if (dx > MOVE_TOLERANCE_PX || dy > MOVE_TOLERANCE_PX) clear();
    },
    [clear]
  );

  return {
    handlers: { onTouchStart, onTouchMove, onTouchEnd: clear, onTouchCancel: clear },
    /** True when the last touch became a long-press; read it in onClick. */
    suppressClick: () => fired.current,
  };
}
