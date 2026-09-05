"use client";

/**
 * Looking around a drawing.
 *
 * A converted DWG arrives as one SVG carrying a viewBox in the drawing's own
 * coordinates, which can span millions of units — a title block is unreadable
 * at the zoom that fits the whole sheet, and the sheet is invisible at the zoom
 * that reads the title block. So the picture is never rescaled; it is placed
 * once to fit and then moved and magnified under a fixed window, the way a
 * drawing is read on a table.
 *
 * The transform lives on a wrapper rather than on the SVG's own viewBox because
 * the browser then composites it — panning a large drawing stays smooth where
 * rewriting the viewBox would relayout every element on every frame.
 */

import React, { useCallback, useEffect, useRef, useState } from "react";
import { Icon } from "./icons";

/** Bounds on the magnification, so the drawing can never be lost off-scale. */
const MIN_SCALE = 0.02;
const MAX_SCALE = 400;

interface View {
  /** Pixels the drawing is offset from the window's top-left. */
  x: number;
  y: number;
  scale: number;
}

const FIT: View = { x: 0, y: 0, scale: 1 };

export default function DrawingCanvas({ svg }: { svg: string }) {
  const window_ = useRef<HTMLDivElement>(null);
  const [view, setView] = useState<View>(FIT);
  const drag = useRef<{ x: number; y: number; view: View } | null>(null);
  /** Live pointers, so a two-finger pinch can be told from a one-finger pan. */
  const points = useRef(new Map<number, { x: number; y: number }>());
  const pinch = useRef<{ distance: number; scale: number } | null>(null);

  const clamp = (scale: number) => Math.min(MAX_SCALE, Math.max(MIN_SCALE, scale));

  /**
   * Zoom about a fixed point, so whatever is under the cursor stays under it.
   * Zooming about the centre instead makes a drawing feel like it is sliding
   * away from you exactly when you are trying to look at something.
   */
  const zoomAbout = useCallback((clientX: number, clientY: number, factor: number) => {
    const box = window_.current?.getBoundingClientRect();
    if (!box) return;
    const px = clientX - box.left;
    const py = clientY - box.top;
    setView((v) => {
      const scale = clamp(v.scale * factor);
      const applied = scale / v.scale;
      return { scale, x: px - (px - v.x) * applied, y: py - (py - v.y) * applied };
    });
  }, []);

  const zoomBy = useCallback(
    (factor: number) => {
      const box = window_.current?.getBoundingClientRect();
      if (!box) return;
      zoomAbout(box.left + box.width / 2, box.top + box.height / 2, factor);
    },
    [zoomAbout]
  );

  const fit = useCallback(() => setView(FIT), []);

  // A new drawing starts fitted rather than wherever the last one was left.
  useEffect(() => {
    setView(FIT);
  }, [svg]);

  /**
   * Wheel is bound here rather than through React's onWheel because the listener
   * has to be non-passive to call preventDefault, and React attaches passive
   * wheel listeners — without which the page scrolls behind the drawing.
   */
  useEffect(() => {
    const el = window_.current;
    if (!el) return;
    const onWheel = (ev: WheelEvent) => {
      ev.preventDefault();
      // A trackpad reports many small deltas and a mouse a few large ones;
      // exponentiating the delta makes both feel like the same gesture.
      zoomAbout(ev.clientX, ev.clientY, Math.exp(-ev.deltaY * 0.0016));
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [zoomAbout]);

  function onPointerDown(ev: React.PointerEvent) {
    points.current.set(ev.pointerId, { x: ev.clientX, y: ev.clientY });
    if (points.current.size === 2) {
      const [a, b] = [...points.current.values()];
      pinch.current = { distance: Math.hypot(a.x - b.x, a.y - b.y), scale: view.scale };
      drag.current = null;
      return;
    }
    ev.currentTarget.setPointerCapture(ev.pointerId);
    drag.current = { x: ev.clientX, y: ev.clientY, view };
  }

  function onPointerMove(ev: React.PointerEvent) {
    if (points.current.has(ev.pointerId)) {
      points.current.set(ev.pointerId, { x: ev.clientX, y: ev.clientY });
    }

    if (pinch.current && points.current.size === 2) {
      const [a, b] = [...points.current.values()];
      const distance = Math.hypot(a.x - b.x, a.y - b.y);
      if (pinch.current.distance > 0) {
        const wanted = clamp(pinch.current.scale * (distance / pinch.current.distance));
        setView((v) => {
          const box = window_.current?.getBoundingClientRect();
          if (!box) return v;
          const px = (a.x + b.x) / 2 - box.left;
          const py = (a.y + b.y) / 2 - box.top;
          const applied = wanted / v.scale;
          return { scale: wanted, x: px - (px - v.x) * applied, y: py - (py - v.y) * applied };
        });
      }
      return;
    }

    const from = drag.current;
    if (!from) return;
    setView({
      scale: from.view.scale,
      x: from.view.x + (ev.clientX - from.x),
      y: from.view.y + (ev.clientY - from.y),
    });
  }

  function onPointerUp(ev: React.PointerEvent) {
    points.current.delete(ev.pointerId);
    if (points.current.size < 2) pinch.current = null;
    if (points.current.size === 0) drag.current = null;
    try {
      ev.currentTarget.releasePointerCapture(ev.pointerId);
    } catch {
      // Releasing a capture the browser has already dropped is not an error
      // worth surfacing to someone looking at a drawing.
    }
  }

  /** Keyboard, so the drawing is navigable without a pointer at all. */
  function onKeyDown(ev: React.KeyboardEvent) {
    const step = ev.shiftKey ? 200 : 60;
    const moves: Record<string, [number, number]> = {
      ArrowLeft: [step, 0],
      ArrowRight: [-step, 0],
      ArrowUp: [0, step],
      ArrowDown: [0, -step],
    };
    const move = moves[ev.key];
    if (move) {
      ev.preventDefault();
      setView((v) => ({ ...v, x: v.x + move[0], y: v.y + move[1] }));
      return;
    }
    if (ev.key === "+" || ev.key === "=") {
      ev.preventDefault();
      zoomBy(1.25);
    } else if (ev.key === "-" || ev.key === "_") {
      ev.preventDefault();
      zoomBy(0.8);
    } else if (ev.key === "0") {
      ev.preventDefault();
      fit();
    }
  }

  const button: React.CSSProperties = {
    width: 34,
    height: 34,
    padding: 0,
    background: "var(--color-surface)",
  };

  return (
    <div style={{ position: "relative", width: "100%", height: "100%" }}>
      <div
        ref={window_}
        role="img"
        aria-label="Drawing. Drag to pan, scroll to zoom."
        tabIndex={0}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onKeyDown={onKeyDown}
        style={{
          width: "100%",
          height: "100%",
          overflow: "hidden",
          background: "var(--color-bg)",
          cursor: drag.current ? "grabbing" : "grab",
          // The browser's own pan and pinch would fight this one.
          touchAction: "none",
        }}
      >
        <div
          style={{
            width: "100%",
            height: "100%",
            transformOrigin: "0 0",
            transform: `translate(${view.x}px, ${view.y}px) scale(${view.scale})`,
            // Drawings are line work: keep hairlines crisp rather than blurred
            // into the background as they are magnified.
            willChange: "transform",
          }}
          // The SVG is produced by the converter and sanitised before it gets
          // here; see FileViewer, which will not hand over unsanitised markup.
          dangerouslySetInnerHTML={{ __html: svg }}
        />
      </div>

      <div
        style={{
          position: "absolute",
          right: 12,
          bottom: 12,
          display: "flex",
          flexDirection: "column",
          gap: 6,
        }}
      >
        <button
          className="btn btn-secondary btn-icon"
          style={button}
          onClick={() => zoomBy(1.25)}
          aria-label="Zoom in"
          title="Zoom in"
        >
          <Icon name="plus" size={15} />
        </button>
        <button
          className="btn btn-secondary btn-icon"
          style={button}
          onClick={() => zoomBy(0.8)}
          aria-label="Zoom out"
          title="Zoom out"
        >
          {/* No minus in the icon set, and a rule reads as one at this size. */}
          <span aria-hidden style={{ display: "block", width: 13, height: 1.5, background: "currentColor" }} />
        </button>
        <button
          className="btn btn-secondary btn-icon"
          style={button}
          onClick={fit}
          aria-label="Fit the drawing to the window"
          title="Fit to window"
        >
          <Icon name="grid" size={15} />
        </button>
      </div>

      <div
        style={{
          position: "absolute",
          left: 12,
          bottom: 12,
          padding: "3px 8px",
          fontSize: 11,
          background: "var(--color-surface)",
          border: "1px solid var(--color-divider)",
          color: "color-mix(in srgb, var(--color-text) 60%, transparent)",
        }}
      >
        {Math.round(view.scale * 100)}%
      </div>
    </div>
  );
}
