"use client";

/**
 * Writing a file rather than uploading one.
 *
 * The drive could only ever receive files that already existed somewhere else,
 * which is a poor fit for the small things a study drive accumulates — a
 * reading note, a list of settings, a paragraph to keep beside a paper. This is
 * a plain editor for those: type it here and it becomes a file in the folder
 * you were looking at.
 *
 * It deliberately knows nothing about storage. The text comes back to the drive
 * as a string and goes out through the same reserve-put-confirm path an upload
 * takes, so a note is an ordinary file from the moment it is saved — it
 * previews, downloads, renames and keeps revisions like any other, and saving
 * over one is a new revision rather than a second file.
 */

import React, { useEffect, useRef, useState } from "react";
import { Icon } from "./icons";

/** What a note is saved as when the name does not say. Markdown previews. */
const DEFAULT_EXT = "md";

/**
 * Only the two the editor can honestly claim to produce. Anything else the
 * author names is stored as plain text, which is what it is — the extension
 * still decides how the viewer renders it.
 */
const TYPES: Record<string, string> = {
  md: "text/markdown; charset=utf-8",
  markdown: "text/markdown; charset=utf-8",
  txt: "text/plain; charset=utf-8",
};

/** The name as it will be stored: trimmed, and given an extension if it has none. */
export function noteFileName(raw: string): string {
  const name = raw.trim().replace(/[\\/]+/g, "-");
  if (!name) return `Note.${DEFAULT_EXT}`;
  // A trailing dot is a typed extension the author has not finished; a name
  // with no dot at all is one they never intended to type.
  const dot = name.lastIndexOf(".");
  if (dot <= 0 || dot === name.length - 1) {
    return `${name.replace(/\.$/, "")}.${DEFAULT_EXT}`;
  }
  return name;
}

/** The content type for a stored note, from the extension it ended up with. */
export function noteContentType(name: string): string {
  const ext = name.includes(".") ? name.split(".").pop()!.toLowerCase() : "";
  return TYPES[ext] ?? "text/plain; charset=utf-8";
}

export default function NoteEditor({
  folderName,
  existingNames = [],
  initialName = "",
  initialText = "",
  onCancel,
  onSave,
}: {
  /** Where the note will land, named so the author can see it before saving. */
  folderName: string;
  /**
   * What is already in that folder. A note defaults to a generic name, so two
   * people writing one in the same folder collide far more readily than two
   * uploads do — and a collision is a new revision of the existing file, not a
   * refusal. Worth saying before the save, not after.
   */
  existingNames?: string[];
  initialName?: string;
  initialText?: string;
  onCancel: () => void;
  /** Resolves when the note is stored; throws with a message worth showing. */
  onSave: (name: string, text: string) => Promise<void>;
}) {
  const [name, setName] = useState(initialName);
  const [text, setText] = useState(initialText);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const area = useRef<HTMLTextAreaElement>(null);

  const dirty = text !== initialText || name.trim() !== initialName.trim();
  const empty = !text.trim();
  const finalName = noteFileName(name);

  // Editing an existing note is expected to replace it; only a collision the
  // author has not already been told about is worth flagging.
  const collides =
    finalName !== initialName && existingNames.some((n) => n === finalName);

  // The name has a sensible default and the text does not, so the cursor
  // belongs in the part that is actually blank.
  useEffect(() => {
    area.current?.focus();
  }, []);

  /**
   * Escape closes, but not out from under unsaved words — losing a note to a
   * stray keypress is the one failure this editor must not have.
   */
  useEffect(() => {
    const onKey = (ev: KeyboardEvent) => {
      if (ev.key !== "Escape" || busy) return;
      ev.stopPropagation();
      attemptCancel();
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  });

  function attemptCancel() {
    if (busy) return;
    if (dirty && !window.confirm("Discard this note? It has not been saved.")) return;
    onCancel();
  }

  async function submit(ev?: React.FormEvent) {
    ev?.preventDefault();
    if (busy || empty) return;
    setBusy(true);
    setError(null);
    try {
      await onSave(finalName, text);
    } catch (e) {
      setError(e instanceof Error ? e.message : "The note could not be saved.");
      setBusy(false);
    }
  }

  /**
   * Ctrl/Cmd-Enter saves from inside the textarea, where Enter has to keep
   * meaning a new line.
   */
  function onAreaKey(ev: React.KeyboardEvent<HTMLTextAreaElement>) {
    if ((ev.metaKey || ev.ctrlKey) && ev.key === "Enter") {
      ev.preventDefault();
      submit();
    }
  }

  const bytes = new TextEncoder().encode(text).length;

  return (
    <div
      className="dialog-backdrop"
      onMouseDown={(ev) => {
        if (ev.target === ev.currentTarget) attemptCancel();
      }}
    >
      <form
        className="dialog blueprint"
        style={{ width: "min(680px, 100%)", gap: "var(--space-3)" }}
        onSubmit={submit}
        role="dialog"
        aria-modal="true"
        aria-label={initialName ? `Edit ${initialName}` : "New note"}
      >
        <span className="corner tl" />
        <span className="corner tr" />
        <span className="corner bl" />
        <span className="corner br" />

        <div style={{ display: "flex", alignItems: "baseline", gap: 10 }}>
          <div className="dialog-title">{initialName ? "Edit note" : "New note"}</div>
          <div
            style={{
              fontSize: 12,
              color: "color-mix(in srgb, var(--color-text) 55%, transparent)",
            }}
          >
            in {folderName}
          </div>
        </div>

        <div className="field">
          <label htmlFor="note-name">Name</label>
          <input
            id="note-name"
            className="input"
            value={name}
            placeholder={`Note.${DEFAULT_EXT}`}
            onChange={(e) => setName(e.target.value)}
            disabled={busy}
            autoComplete="off"
            spellCheck={false}
          />
          <div
            style={{
              marginTop: 5,
              fontSize: 11,
              color: "color-mix(in srgb, var(--color-text) 50%, transparent)",
            }}
          >
            {/* What it will actually be called, since the name is normalised. */}
            Saved as {finalName}
            {finalName.toLowerCase().endsWith(".md") && " — Markdown, shown formatted"}
          </div>
          {collides && (
            <div
              role="status"
              style={{ marginTop: 6, fontSize: 12, color: "var(--color-accent-700)" }}
            >
              {folderName} already has a {finalName}. Saving keeps it and adds this
              as its next revision — rename above to start a separate note instead.
            </div>
          )}
        </div>

        <div className="field" style={{ display: "flex", flexDirection: "column" }}>
          <label htmlFor="note-text">Text</label>
          <textarea
            id="note-text"
            ref={area}
            className="input"
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={onAreaKey}
            disabled={busy}
            spellCheck
            style={{
              minHeight: 260,
              resize: "vertical",
              fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
              fontSize: 13,
              lineHeight: 1.6,
            }}
          />
        </div>

        {error && (
          <div role="alert" style={{ fontSize: 12, color: "#c0492f" }}>
            {error}
          </div>
        )}

        <div
          className="dialog-actions"
          style={{ alignItems: "center", justifyContent: "space-between" }}
        >
          <div
            style={{
              fontSize: 11,
              color: "color-mix(in srgb, var(--color-text) 50%, transparent)",
            }}
          >
            {bytes.toLocaleString()} bytes · ⌘/Ctrl + Enter to save
          </div>
          <div style={{ display: "flex", gap: "var(--space-2)" }}>
            <button
              type="button"
              className="btn btn-secondary"
              onClick={attemptCancel}
              disabled={busy}
            >
              Cancel
            </button>
            <button type="submit" className="btn btn-primary" disabled={busy || empty}>
              <Icon name="file" size={14} />
              {busy ? "Saving…" : "Save note"}
            </button>
          </div>
        </div>
      </form>
    </div>
  );
}
