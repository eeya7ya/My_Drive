"use client";

/**
 * In-app file viewer — the drive opens things instead of downloading them.
 *
 * Security: .md and .docx become HTML, and an uploaded file is untrusted input.
 * Rendering it raw in this origin would let a crafted document run script and
 * take the admin's session cookie, so everything generated goes through
 * DOMPurify first. SVGs render through <img>, which never executes their
 * script, rather than being inlined.
 *
 * Weight: mammoth and SheetJS are large and most files need neither, so both
 * are dynamically imported the first time a .docx or spreadsheet is opened.
 */

import React, { useCallback, useEffect, useRef, useState } from "react";
import { Icon } from "./icons";
import { DriveFile } from "@/lib/types";
import { kindFor, isMediaKind, whyNoPreview, PreviewKind } from "@/lib/preview";

interface Props {
  file: DriveFile;
  versionId?: string | null;
  versionLabel?: string | null;
  onClose: () => void;
  onDownload: () => void;
}

export default function FileViewer({
  file,
  versionId,
  versionLabel,
  onClose,
  onDownload,
}: Props) {
  const kind: PreviewKind = kindFor(file.name);
  const [html, setHtml] = useState<string | null>(null);
  const [text, setText] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const cancelled = useRef(false);

  const qs = versionId ? `?version=${encodeURIComponent(versionId)}` : "";
  const viewUrl = `/api/files/${file.id}/view${qs}`;
  const rawUrl = `/api/files/${file.id}/raw${qs}`;

  // Escape closes, matching every other viewer people use.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    // The page behind must not scroll while the overlay is up.
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [onClose]);

  const load = useCallback(async () => {
    if (isMediaKind(kind) || kind === "none") return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(rawUrl);
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body?.error || `Could not read the file (${res.status})`);
      }

      const [{ marked }, DOMPurifyMod] = await Promise.all([
        import("marked"),
        import("dompurify"),
      ]);
      const DOMPurify = DOMPurifyMod.default;

      if (kind === "text") {
        const t = await res.text();
        if (!cancelled.current) setText(t);
      } else if (kind === "markdown") {
        const md = await res.text();
        const raw = await marked.parse(md, { async: true });
        if (!cancelled.current) setHtml(DOMPurify.sanitize(raw));
      } else if (kind === "docx") {
        const mammoth = await import("mammoth");
        const buf = await res.arrayBuffer();
        const out = await mammoth.convertToHtml({ arrayBuffer: buf });
        if (!cancelled.current) setHtml(DOMPurify.sanitize(out.value));
      } else if (kind === "sheet") {
        const XLSX = await import("xlsx");
        const buf = await res.arrayBuffer();
        const wb = XLSX.read(buf, { type: "array" });
        const parts = wb.SheetNames.map((n) => {
          const table = XLSX.utils.sheet_to_html(wb.Sheets[n], { id: `s-${n}` });
          return `<h4 class="sheet-name">${n}</h4>${table}`;
        });
        if (!cancelled.current) setHtml(DOMPurify.sanitize(parts.join("")));
      }
    } catch (e) {
      if (!cancelled.current) {
        setError(e instanceof Error ? e.message : "Could not open this file");
      }
    } finally {
      if (!cancelled.current) setLoading(false);
    }
  }, [kind, rawUrl]);

  useEffect(() => {
    cancelled.current = false;
    load();
    return () => {
      cancelled.current = true;
    };
  }, [load]);

  const frame: React.CSSProperties = {
    width: "100%",
    height: "100%",
    border: "none",
    background: "var(--color-bg)",
  };

  function body() {
    if (kind === "none") {
      return (
        <Empty
          title="No preview for this file"
          detail={whyNoPreview(file.name)}
          onDownload={onDownload}
        />
      );
    }
    if (loading) {
      return (
        <div style={{ display: "grid", placeItems: "center", height: "100%", opacity: 0.6 }}>
          Opening {file.name}…
        </div>
      );
    }
    if (error) {
      return <Empty title="Could not open this file" detail={error} onDownload={onDownload} />;
    }

    switch (kind) {
      case "image":
        return (
          <div style={{ display: "grid", placeItems: "center", height: "100%", padding: 20 }}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={viewUrl}
              alt={file.name}
              style={{ maxWidth: "100%", maxHeight: "100%", objectFit: "contain" }}
            />
          </div>
        );
      case "video":
        return (
          <div style={{ display: "grid", placeItems: "center", height: "100%", padding: 20 }}>
            <video src={viewUrl} controls style={{ maxWidth: "100%", maxHeight: "100%" }} />
          </div>
        );
      case "audio":
        return (
          <div style={{ display: "grid", placeItems: "center", height: "100%", padding: 40 }}>
            <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 18 }}>
              <Icon name="file" size={40} style={{ color: "var(--color-accent)", opacity: 0.75 }} />
              <audio src={viewUrl} controls style={{ width: 420, maxWidth: "100%" }} />
            </div>
          </div>
        );
      case "pdf":
        // The browser's own PDF viewer, from a different origin, so the
        // document is sandboxed away from this app's cookies.
        return <iframe src={viewUrl} style={frame} title={file.name} />;
      case "text":
        return (
          <pre
            style={{
              margin: 0,
              padding: "22px 26px",
              height: "100%",
              overflow: "auto",
              fontSize: 13,
              lineHeight: 1.6,
              fontFamily:
                "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",
              whiteSpace: "pre-wrap",
              wordBreak: "break-word",
            }}
          >
            {text}
          </pre>
        );
      case "markdown":
      case "docx":
      case "sheet":
        return (
          <div
            className="dc-doc"
            style={{ height: "100%", overflow: "auto", padding: "26px 30px" }}
            dangerouslySetInnerHTML={{ __html: html ?? "" }}
          />
        );
      default:
        return null;
    }
  }

  return (
    <div
      onClick={onClose}
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 90,
        background: "color-mix(in srgb, #1d1f20 62%, transparent)",
        display: "grid",
        placeItems: "center",
        padding: 28,
        animation: "pop .12s ease-out both",
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: "min(1180px, 100%)",
          height: "min(880px, 100%)",
          display: "flex",
          flexDirection: "column",
          background: "var(--color-surface)",
          border: "1px solid var(--color-divider)",
          borderTop: "2px solid var(--color-accent)",
          boxShadow: "var(--shadow-lg)",
        }}
      >
        <header
          style={{
            display: "flex",
            alignItems: "center",
            gap: 12,
            padding: "13px 16px",
            borderBottom: "1px solid var(--color-divider)",
            flex: "none",
          }}
        >
          <span style={{ display: "inline-flex", color: "var(--color-accent-700)" }}>
            <Icon name="file" size={17} />
          </span>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div
              style={{
                fontFamily: "var(--font-heading)",
                fontWeight: 600,
                fontSize: 17,
                whiteSpace: "nowrap",
                overflow: "hidden",
                textOverflow: "ellipsis",
              }}
            >
              {file.name}
            </div>
            <div style={{ fontSize: 11, opacity: 0.55, marginTop: 1 }}>
              {file.size} · {file.uploadedAt}
            </div>
          </div>
          <span className="tag tag-accent" style={{ fontSize: 10 }}>
            {versionLabel ?? `REV ${file.version}`}
          </span>
          <button className="btn btn-secondary" onClick={onDownload}>
            <Icon name="download" size={14} />
            Download
          </button>
          <button className="btn btn-secondary btn-icon" onClick={onClose} title="Close (Esc)">
            <Icon name="close" size={15} />
          </button>
        </header>

        <div style={{ flex: 1, minHeight: 0, background: "var(--color-bg)" }}>
          {body()}
        </div>
      </div>
    </div>
  );
}

function Empty({
  title,
  detail,
  onDownload,
}: {
  title: string;
  detail: string;
  onDownload: () => void;
}) {
  return (
    <div style={{ display: "grid", placeItems: "center", height: "100%", padding: 40 }}>
      <div
        style={{
          textAlign: "center",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          gap: 14,
          maxWidth: 420,
          padding: "40px 48px",
          border: "1px dashed var(--color-divider)",
          background: "var(--color-surface)",
        }}
      >
        <Icon name="file" size={36} style={{ color: "var(--color-accent)", opacity: 0.7 }} />
        <div style={{ fontFamily: "var(--font-heading)", fontWeight: 600, fontSize: 19 }}>
          {title}
        </div>
        <div style={{ fontSize: 13, opacity: 0.65, lineHeight: 1.5 }}>{detail}</div>
        <button className="btn btn-primary" onClick={onDownload} style={{ marginTop: 4 }}>
          <Icon name="download" size={14} />
          Download
        </button>
      </div>
    </div>
  );
}
