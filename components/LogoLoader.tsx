"use client";

/**
 * The drive's loading screen, in two places.
 *
 * Opening a drive: the tree is fetched in the browser, so the first paint used
 * to be the whole shell with nothing in it — an empty folder tree, "0 items",
 * a storage bar at zero. That read as an empty drive rather than one still on
 * its way, so the shell now sits under this until the payload has landed and
 * the address bar has been resolved against it. It is server-rendered with the
 * page, so it is on screen from the first byte; CSS runs it before any of the
 * JavaScript has.
 *
 * Uploading: the same screen as an `overlay`, the drive dimmed behind it, with
 * the file's name and a bar for how much of the batch has gone.
 *
 * The animation is the mark itself: its path is drawn from the top down and
 * each circle rings as the line reaches it. The ring positions are the
 * circles' centres in espark-mark-*.png (480 × 1002), as percentages of the
 * box, so they stay on the circles at any size.
 */

import React, { useEffect, useState } from "react";

/** Circle centres in the mark, top to bottom, with the moment the line reaches each. */
const NODES = [
  { left: "18.3%", top: "9.2%", delay: ".13s" },
  { left: "81.7%", top: "35%", delay: ".5s" },
  { left: "24%", top: "60.7%", delay: ".87s" },
  { left: "50.8%", top: "90.9%", delay: "1.31s" },
];

/** Long enough for the .dc-loader-out fade in globals.css to finish. */
const EXIT_MS = 450;

export default function LogoLoader({
  done,
  title,
  label,
  progress = null,
  overlay = false,
}: {
  /** False while the wait lasts; true fades the screen out. */
  done: boolean;
  /** The large line: the drive's name, or the file going up. */
  title: string;
  /** The small letterspaced line beneath it. */
  label: string;
  /** 0 to 1 adds a percentage and a bar under the words; null, neither. */
  progress?: number | null;
  /** Dim the page behind instead of hiding it. */
  overlay?: boolean;
}) {
  // Kept mounted through the fade, then dropped, so what is beneath is
  // revealed rather than swapped in. A loader that starts out done (an upload
  // not yet begun) is never rendered at all, and comes back when it is
  // needed again.
  const [gone, setGone] = useState(done);
  if (!done && gone) setGone(false);

  useEffect(() => {
    if (!done) return;
    const t = setTimeout(() => setGone(true), EXIT_MS);
    return () => clearTimeout(t);
  }, [done]);

  if (gone) return null;

  return (
    <div
      className={
        "dc-loader" + (overlay ? " dc-loader-overlay" : "") + (done ? " dc-loader-out" : "")
      }
      role="status"
      aria-live="polite"
      aria-busy={!done}
    >
      <div className="dc-loader-mark" aria-hidden="true">
        {/* The faint copy is the path still to come; the full one is drawn over it. */}
        {(["ghost", "fill"] as const).map((layer) => (
          <div key={layer} className={`dc-loader-${layer}`}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img className="brand-bright" src="/assets/espark-mark-bright.png" alt="" fetchPriority="high" />
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img className="brand-dark" src="/assets/espark-mark-dark.png" alt="" />
          </div>
        ))}
        {NODES.map((n) => (
          <span
            key={n.top}
            className="dc-loader-ring"
            style={{ left: n.left, top: n.top, animationDelay: n.delay }}
          />
        ))}
      </div>
      <div style={{ textAlign: "center", maxWidth: "min(84vw, 420px)" }}>
        <div
          style={{
            fontFamily: "var(--font-heading)",
            fontWeight: 600,
            fontSize: 19,
            lineHeight: 1.1,
            letterSpacing: ".02em",
            whiteSpace: "nowrap",
            overflow: "hidden",
            textOverflow: "ellipsis",
          }}
        >
          {title}
        </div>
        <div className="dc-loader-label">
          {label}
          {/* Seen, not announced: a screen reader would otherwise read out
              every percent as it ticks over. */}
          {progress !== null && <span aria-hidden="true"> · {Math.round(progress * 100)}%</span>}
        </div>
        {progress !== null && (
          <div className="dc-loader-bar">
            <span style={{ width: `${Math.round(progress * 100)}%` }} />
          </div>
        )}
      </div>
    </div>
  );
}
