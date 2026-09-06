"use client";

/**
 * A note laid out for paper, and handed to the browser to turn into a PDF.
 *
 * There is no PDF library here on purpose. Every browser already contains a
 * typesetter that paginates, hyphenates, embeds fonts and writes real PDFs with
 * selectable text — reaching for a JavaScript one would mean either rasterising
 * the page into a blurry picture of itself, or shipping several megabytes to
 * redo what is already installed. So this renders the note properly for print
 * and calls print(); the reader chooses "Save as PDF" as the destination, which
 * every desktop and mobile browser offers.
 *
 * It waits for the pictures before printing. A print() fired while an image is
 * still decoding produces a PDF with a gap where the picture should be, and
 * nothing about the result says anything went wrong.
 */

import React, { useCallback, useEffect, useRef, useState } from "react";
import { Icon } from "./icons";
import { formatDateTime } from "@/lib/types";

export default function PrintNote({
  fileId,
  fileName,
  driveName,
  versionId,
}: {
  fileId: string;
  fileName: string;
  driveName: string;
  versionId: string | null;
}) {
  const [html, setHtml] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const sheet = useRef<HTMLDivElement>(null);
  const printed = useRef(false);

  useEffect(() => {
    let stale = false;
    (async () => {
      try {
        const qs = versionId ? `?version=${encodeURIComponent(versionId)}` : "";
        const res = await fetch(`/api/files/${fileId}/raw${qs}`, { cache: "no-store" });
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          throw new Error(body?.error || `Could not read the note (${res.status})`);
        }
        const markdown = await res.text();
        const [{ marked }, mod] = await Promise.all([import("marked"), import("dompurify")]);
        const raw = await marked.parse(markdown, { async: true });
        if (!stale) setHtml(mod.default.sanitize(raw));
      } catch (e) {
        if (!stale) setError(e instanceof Error ? e.message : "Could not read the note");
      }
    })();
    return () => {
      stale = true;
    };
  }, [fileId, versionId]);

  /** Every picture decoded, or given up on, so nothing prints half-drawn. */
  const settled = useCallback(async () => {
    const images = Array.from(sheet.current?.querySelectorAll("img") ?? []);
    await Promise.all(
      images.map((img) =>
        img.complete
          ? Promise.resolve()
          : new Promise<void>((resolve) => {
              img.addEventListener("load", () => resolve(), { once: true });
              img.addEventListener("error", () => resolve(), { once: true });
            })
      )
    );
    try {
      await document.fonts.ready;
    } catch {
      // A browser without the font API still prints; it just may not have
      // finished swapping the face, which is not worth blocking on.
    }
  }, []);

  const toPdf = useCallback(async () => {
    await settled();
    window.print();
  }, [settled]);

  // Print once, unprompted, since arriving here is the request. Doing it again
  // is the button's job.
  useEffect(() => {
    if (html === null || printed.current) return;
    printed.current = true;
    toPdf();
  }, [html, toPdf]);

  return (
    <div className="print-page">
      <div className="print-bar">
        <div>
          <strong>{fileName}</strong>
          <span style={{ opacity: 0.7 }}> · choose “Save as PDF” as the destination</span>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <button className="btn btn-secondary" onClick={() => window.close()}>
            Close
          </button>
          <button className="btn btn-primary" onClick={toPdf}>
            <Icon name="download" size={14} />
            Save as PDF
          </button>
        </div>
      </div>

      <div className="print-sheet" ref={sheet}>
        <header className="print-head">
          <div className="print-title">{fileName.replace(/\.[^.]+$/, "")}</div>
          <div className="print-meta">
            {driveName} · {formatDateTime(Date.now())}
          </div>
        </header>

        {error ? (
          <p role="alert">{error}</p>
        ) : html === null ? (
          <p>Preparing the note…</p>
        ) : (
          <article className="dc-doc" dangerouslySetInnerHTML={{ __html: html }} />
        )}
      </div>
    </div>
  );
}
