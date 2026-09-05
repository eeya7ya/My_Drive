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

/**
 * The name as it will be stored: trimmed, and given an extension if it has none.
 *
 * "Has none" has to mean more than "contains no dot". A note called
 * "Meeting 3.2 actions" or "IEC 61850.8.1 notes" ends in something that is not
 * an extension, and taking it for one leaves the file unpreviewable by the app
 * that just wrote it — so only a short alphanumeric tail counts.
 */
export function noteFileName(raw: string): string {
  const name = raw.trim().replace(/[\\/]+/g, "-").replace(/\.+$/, "");
  if (!name) return defaultNoteName();
  const dot = name.lastIndexOf(".");
  const ext = dot > 0 ? name.slice(dot + 1).toLowerCase() : "";
  if (!/^[a-z0-9]{1,8}$/.test(ext)) return `${name}.${DEFAULT_EXT}`;
  return name;
}

/**
 * What an unnamed note is called. Dated, because the alternative is that every
 * unnamed note in a folder is the same file — the second one silently becoming
 * revision two of the first is not what anyone means by "just jot this down".
 */
export function defaultNoteName(): string {
  const today = new Date();
  const stamp = [
    today.getFullYear(),
    String(today.getMonth() + 1).padStart(2, "0"),
    String(today.getDate()).padStart(2, "0"),
  ].join("-");
  return `Note ${stamp}.${DEFAULT_EXT}`;
}

/** The content type for a stored note, from the extension it ended up with. */
export function noteContentType(name: string): string {
  const ext = name.includes(".") ? name.split(".").pop()!.toLowerCase() : "";
  return TYPES[ext] ?? "text/plain; charset=utf-8";
}

/* ── formatting ────────────────────────────────────────────────────────────
   A note is Markdown, so these write Markdown rather than hiding it. What is
   stored stays something a person would have typed and can read in any editor,
   while nobody has to learn the syntax to make a heading.

   They are pure functions over (text, selection) on purpose: this is fiddly
   string surgery where an off-by-one moves someone's caret into the middle of
   a word, and pure functions can be checked without a browser.

   Everything toggles. A button that only ever adds is one you cannot undo
   without reaching for the keyboard.
   ──────────────────────────────────────────────────────────────────────── */

export interface Edit {
  text: string;
  start: number;
  end: number;
}

/** Bold, italic, inline code: a marker on both sides of the selection. */
export function applyWrap(
  text: string,
  start: number,
  end: number,
  marker: string,
  placeholder: string
): Edit {
  const chosen = text.slice(start, end);
  const width = marker.length;

  // Already wrapped inside the selection.
  if (chosen.length >= width * 2 && chosen.startsWith(marker) && chosen.endsWith(marker)) {
    const inner = chosen.slice(width, -width);
    return { text: text.slice(0, start) + inner + text.slice(end), start, end: start + inner.length };
  }
  // Already wrapped just outside it, which is what a double-click on a bold
  // word selects.
  if (start >= width && text.slice(start - width, start) === marker && text.slice(end, end + width) === marker) {
    return {
      text: text.slice(0, start - width) + chosen + text.slice(end + width),
      start: start - width,
      end: end - width,
    };
  }

  const body = chosen || placeholder;
  return {
    text: text.slice(0, start) + marker + body + marker + text.slice(end),
    start: start + width,
    end: start + width + body.length,
  };
}

/**
 * Headings, bullets, numbers and quotes are line-level, so they apply to every
 * line the selection touches — including the one the caret merely sits on,
 * which is what lets the buttons work without selecting anything first.
 *
 * `strip` is what the action removes and `has` is what counts as already
 * applied. They differ for headings: pressing Subheading on a heading should
 * change its level, not clear it, so it strips any heading but only toggles
 * off when the line is already at that same level.
 */
export function applyPrefix(
  text: string,
  start: number,
  end: number,
  make: (index: number) => string,
  strip: RegExp,
  has: RegExp = strip
): Edit {
  const from = text.lastIndexOf("\n", start - 1) + 1;
  const nextBreak = text.indexOf("\n", end);
  const to = nextBreak === -1 ? text.length : nextBreak;

  const lines = text.slice(from, to).split("\n");
  const allMarked = lines.every((line) => has.test(line));
  const rewritten = lines
    .map((line, i) => {
      const bare = line.replace(strip, "");
      return allMarked ? bare : make(i) + bare;
    })
    .join("\n");

  return {
    text: text.slice(0, from) + rewritten + text.slice(to),
    start: from,
    end: from + rewritten.length,
  };
}

export function applyHeading(text: string, start: number, end: number, level: number): Edit {
  return applyPrefix(
    text,
    start,
    end,
    () => "#".repeat(level) + " ",
    /^#{1,6}\s+/,
    new RegExp(`^#{${level}}\\s+`)
  );
}

export function applyBullets(text: string, start: number, end: number): Edit {
  return applyPrefix(text, start, end, () => "- ", /^\s*[-*+]\s+/);
}

export function applyNumbers(text: string, start: number, end: number): Edit {
  return applyPrefix(text, start, end, (i) => `${i + 1}. `, /^\s*\d+\.\s+/);
}

export function applyQuote(text: string, start: number, end: number): Edit {
  return applyPrefix(text, start, end, () => "> ", /^\s*>\s?/);
}

/** A link keeps the selected words as the label and leaves the caret on "url". */
export function applyLink(text: string, start: number, end: number): Edit {
  const label = text.slice(start, end) || "text";
  const at = start + label.length + 3;
  return {
    text: text.slice(0, start) + `[${label}](url)` + text.slice(end),
    start: at,
    end: at + 3,
  };
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
  /** Closing hands back what was typed, so the drive can keep it as a draft. */
  onCancel: (draft: { name: string; text: string }) => void;
  /** Resolves when the note is stored; throws with a message worth showing. */
  onSave: (name: string, text: string) => Promise<void>;
}) {
  const [name, setName] = useState(initialName);
  const [text, setText] = useState(initialText);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const area = useRef<HTMLTextAreaElement>(null);
  const form = useRef<HTMLFormElement>(null);
  const [mode, setMode] = useState<"write" | "preview">("write");
  const [preview, setPreview] = useState("");
  /**
   * Where the caret should end up after a formatting button rewrites the text.
   * React re-renders between the two, so the selection has to be reapplied
   * afterwards or every button press would drop the cursor to the end.
   */
  const pending = useRef<[number, number] | null>(null);

  // Any words not yet stored are worth guarding, including ones restored from
  // a draft the author dismissed a moment ago.
  const dirty = Boolean(text.trim()) || name.trim() !== initialName.trim();
  const empty = !text.trim();
  const finalName = noteFileName(name);

  // initialName is a restored draft, never an existing note being edited — the
  // drive has no edit-in-place flow — so a name matching a file in the folder
  // is always a collision worth naming, however it got into the field.
  const collides = existingNames.some((n) => n === finalName);

  // The name has a sensible default and the text does not, so the cursor
  // belongs in the part that is actually blank.
  useEffect(() => {
    area.current?.focus();
  }, []);

  useEffect(() => {
    const want = pending.current;
    if (!want || !area.current) return;
    pending.current = null;
    area.current.focus();
    area.current.setSelectionRange(want[0], want[1]);
  }, [text]);

  /**
   * The preview renders the Markdown the buttons write, so the formatting is
   * something you can see rather than syntax you have to picture. marked and
   * DOMPurify are loaded on demand — the same pair the file viewer uses, and
   * not worth carrying for a note nobody previews.
   */
  useEffect(() => {
    if (mode !== "preview") return;
    let stale = false;
    (async () => {
      const [{ marked }, mod] = await Promise.all([import("marked"), import("dompurify")]);
      const html = await marked.parse(text || "*Nothing written yet.*", { async: true });
      if (!stale) setPreview(mod.default.sanitize(html));
    })().catch(() => {
      if (!stale) setPreview("");
    });
    return () => {
      stale = true;
    };
  }, [mode, text]);

  /**
   * The browser's own ways of leaving take the note with them — a reload, a
   * closed tab, or the sidebar link behind this dialog, which is a full
   * navigation by design. The in-app confirm cannot see any of them.
   */
  useEffect(() => {
    if (!dirty) return;
    const warn = (ev: BeforeUnloadEvent) => ev.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

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

  /**
   * Keep Tab inside the dialog. aria-modal says the rest of the page is out of
   * reach, but nothing enforces that for the keyboard, and the first thing Tab
   * finds behind this is the sidebar's "All drives" link — one Enter away from
   * navigating off and taking the note with it.
   */
  function onFormKeyDown(ev: React.KeyboardEvent) {
    if (ev.key !== "Tab" || !form.current) return;
    const focusable = form.current.querySelectorAll<HTMLElement>(
      'input, textarea, button:not([disabled]), [href], [tabindex]:not([tabindex="-1"])'
    );
    if (!focusable.length) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (!ev.shiftKey && document.activeElement === last) {
      ev.preventDefault();
      first.focus();
    } else if (ev.shiftKey && document.activeElement === first) {
      ev.preventDefault();
      last.focus();
    }
  }

  function attemptCancel() {
    if (busy) return;
    onCancel({ name, text });
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

  /* ── formatting ──────────────────────────────────────────────────────────
     A note is Markdown, so these buttons write Markdown rather than hiding it.
     That keeps the file honest — what is stored is what a person would have
     typed, readable in any editor — while sparing anyone who does not know the
     syntax from having to learn it to make a heading.

     Every action toggles: pressing Bold on bold text unbolds it, and pressing
     Bullets on a list flattens it, because a button that only ever adds is a
     button you cannot undo without reaching for the keyboard.
     ─────────────────────────────────────────────────────────────────────── */

  /** Replace the current selection, and say where the caret should land. */
  function apply(result: { text: string; start: number; end: number }) {
    pending.current = [result.start, result.end];
    setText(result.text);
  }

  function at(fn: (text: string, start: number, end: number) => { text: string; start: number; end: number }) {
    const el = area.current;
    if (!el) return;
    apply(fn(text, el.selectionStart, el.selectionEnd));
  }

  /**
   * Ctrl/Cmd-Enter saves from inside the textarea, where Enter has to keep
   * meaning a new line.
   */
  function onAreaKey(ev: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (!(ev.metaKey || ev.ctrlKey)) return;
    if (ev.key === "Enter") {
      ev.preventDefault();
      submit();
    } else if (ev.key.toLowerCase() === "b") {
      ev.preventDefault();
      at((t, a, b) => applyWrap(t, a, b, "**", "bold text"));
    } else if (ev.key.toLowerCase() === "i") {
      ev.preventDefault();
      at((t, a, b) => applyWrap(t, a, b, "*", "italic text"));
    }
  }

  const bytes = new TextEncoder().encode(text).length;

  return (
    <div
      className="dialog-backdrop"
      style={{
        // Above the file viewer, and above the mobile drawer, which otherwise
        // paints over a dialog that declares no stacking of its own.
        zIndex: 95,
        // A landscape phone is shorter than this dialog. Centring it there puts
        // Save and Cancel below the fold with nothing able to scroll to them.
        alignItems: "start",
        overflowY: "auto",
      }}
      onMouseDown={(ev) => {
        // Pressing outside closes it, without asking. Nothing is lost by that:
        // the text goes back to the drive as a draft and is waiting in the
        // editor next time it is opened.
        if (ev.target === ev.currentTarget && !busy) onCancel({ name, text });
      }}
    >
      <form
        ref={form}
        className="dialog blueprint"
        style={{
          width: "min(680px, 100%)",
          gap: "var(--space-3)",
          // The design system's later rule resets .dialog's background to
          // none, so every dialog states its own — as the sign-in card and the
          // file viewer already do.
          background: "var(--color-surface)",
          margin: "auto 0",
        }}
        onSubmit={submit}
        onKeyDown={onFormKeyDown}
        role="dialog"
        aria-modal="true"
        aria-label="New note"
      >
        <span className="corner tl" />
        <span className="corner tr" />
        <span className="corner bl" />
        <span className="corner br" />

        <div style={{ display: "flex", alignItems: "baseline", gap: 10 }}>
          <div className="dialog-title">New note</div>
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
            placeholder={defaultNoteName()}
            onChange={(e) => setName(e.target.value)}
            readOnly={busy}
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
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              gap: 8,
              marginBottom: 5,
              flexWrap: "wrap",
            }}
          >
            <label htmlFor="note-text" style={{ marginBottom: 0 }}>
              Text
            </label>
            <div className="seg" role="group" aria-label="Write or preview">
              {(["write", "preview"] as const).map((m) => (
                <label key={m} className="seg-opt">
                  <input
                    type="radio"
                    name="note-mode"
                    checked={mode === m}
                    onChange={() => setMode(m)}
                  />
                  {m === "write" ? "Write" : "Preview"}
                </label>
              ))}
            </div>
          </div>

          {mode === "write" && (
            <div
              role="toolbar"
              aria-label="Formatting"
              aria-controls="note-text"
              style={{
                display: "flex",
                flexWrap: "wrap",
                gap: 3,
                padding: 4,
                marginBottom: -1,
                border: "1px solid var(--color-divider)",
                background: "var(--color-bg)",
              }}
            >
              <Tool label="Heading" hint="Heading" onClick={() => at((t, a, b) => applyHeading(t, a, b, 1))}>
                <span style={{ fontSize: 14, fontWeight: 700 }}>H1</span>
              </Tool>
              <Tool label="Subheading" hint="Subheading" onClick={() => at((t, a, b) => applyHeading(t, a, b, 2))}>
                <span style={{ fontSize: 12, fontWeight: 700 }}>H2</span>
              </Tool>
              <Tool label="Small heading" hint="Small heading" onClick={() => at((t, a, b) => applyHeading(t, a, b, 3))}>
                <span style={{ fontSize: 11, fontWeight: 700 }}>H3</span>
              </Tool>
              <Divider />
              <Tool label="Bold" hint="Bold (Ctrl/⌘ B)" onClick={() => at((t, a, b) => applyWrap(t, a, b, "**", "bold text"))}>
                <span style={{ fontWeight: 700 }}>B</span>
              </Tool>
              <Tool label="Italic" hint="Italic (Ctrl/⌘ I)" onClick={() => at((t, a, b) => applyWrap(t, a, b, "*", "italic text"))}>
                <span style={{ fontStyle: "italic", fontFamily: "serif" }}>I</span>
              </Tool>
              <Tool label="Code" hint="Code" onClick={() => at((t, a, b) => applyWrap(t, a, b, "`", "code"))}>
                <span style={{ fontFamily: "var(--font-mono)", fontSize: 12 }}>{"<>"}</span>
              </Tool>
              <Divider />
              <Tool
                label="Bulleted list"
                hint="Bulleted list"
                onClick={() => at(applyBullets)}
              >
                <Icon name="list" size={15} />
              </Tool>
              <Tool
                label="Numbered list"
                hint="Numbered list"
                onClick={() => at(applyNumbers)}
              >
                <span style={{ fontSize: 12, fontWeight: 600 }}>1.</span>
              </Tool>
              <Tool
                label="Quote"
                hint="Quote"
                onClick={() => at(applyQuote)}
              >
                <span style={{ fontSize: 15, fontWeight: 700 }}>&rdquo;</span>
              </Tool>
              <Tool label="Link" hint="Link" onClick={() => at(applyLink)}>
                <Icon name="link" size={15} />
              </Tool>
            </div>
          )}

          {mode === "preview" ? (
            <div
              className="dc-doc"
              style={{
                minHeight: 260,
                maxHeight: "45vh",
                overflow: "auto",
                padding: "14px 16px",
                border: "1px solid var(--color-divider)",
                background: "var(--color-bg)",
              }}
              dangerouslySetInnerHTML={{ __html: preview }}
            />
          ) : (
          <textarea
            id="note-text"
            ref={area}
            className="input"
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={onAreaKey}
            // readOnly rather than disabled: a disabled textarea's contents
            // cannot be selected or copied, so a save that is merely slow would
            // hold the author's only copy of their words out of reach.
            readOnly={busy}
            spellCheck
            style={{
              minHeight: 260,
              resize: "vertical",
              fontFamily: "var(--font-mono)",
              fontSize: 13,
              lineHeight: 1.6,
            }}
          />
          )}
        </div>

        {error && (
          <div role="alert" style={{ fontSize: 12, color: "var(--color-danger)" }}>
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

/**
 * One formatting button.
 *
 * type="button" is load-bearing: inside a form a bare button submits, so
 * without it every one of these would save the note instead of formatting it.
 * onMouseDown rather than onClick, preventing the default, so the textarea
 * never loses its selection to the button taking focus — which is the whole
 * input these actions work from.
 */
function Tool({
  label,
  hint,
  onClick,
  children,
}: {
  label: string;
  hint: string;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      className="btn btn-secondary"
      aria-label={label}
      title={hint}
      onMouseDown={(ev) => {
        ev.preventDefault();
        onClick();
      }}
      style={{
        minWidth: 32,
        height: 28,
        padding: "0 7px",
        borderColor: "transparent",
        lineHeight: 1,
      }}
    >
      {children}
    </button>
  );
}

function Divider() {
  return (
    <span
      aria-hidden
      style={{
        width: 1,
        alignSelf: "stretch",
        margin: "2px 3px",
        background: "var(--color-divider)",
      }}
    />
  );
}
