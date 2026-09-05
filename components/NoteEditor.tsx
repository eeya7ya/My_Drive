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
import { kindFor } from "@/lib/preview";

/** What a note is saved as when nothing says otherwise. The editor offers a choice. */
const DEFAULT_EXT = "md";

/**
 * The formats the editor offers by name. Anything else a person types is kept
 * as typed — this is a shortcut, not a list of what is allowed.
 */
export const NOTE_FORMATS: { ext: string; label: string; note: string }[] = [
  { ext: "md", label: "Markdown (.md)", note: "shown formatted" },
  { ext: "txt", label: "Plain text (.txt)", note: "shown as written" },
  { ext: "csv", label: "CSV (.csv)", note: "shown as a table" },
  { ext: "json", label: "JSON (.json)", note: "shown as written" },
];

/** The extension a stored name ends in, lowercased, or "" when it has none. */
export function extensionOf(name: string): string {
  const dot = name.lastIndexOf(".");
  return dot > 0 ? name.slice(dot + 1).toLowerCase() : "";
}

/**
 * A name not already used in the folder.
 *
 * Everything off a clipboard is called "image.png", and the store treats a
 * repeated name in one folder as the next revision of what is there — right
 * for a note saving over itself, wrong for a second screenshot, which would
 * bury the first and repaint any older note pointing at that name.
 */
export function freeFileName(name: string, taken: Iterable<string>): string {
  const used = new Set(taken);
  if (!used.has(name)) return name;
  const dot = name.lastIndexOf(".");
  const base = dot > 0 ? name.slice(0, dot) : name;
  const ext = dot > 0 ? name.slice(dot) : "";
  let n = 2;
  while (used.has(`${base}-${n}${ext}`)) n++;
  return `${base}-${n}${ext}`;
}

/** Swap a name's extension, keeping everything before it. */
export function withExtension(name: string, ext: string): string {
  const dot = name.lastIndexOf(".");
  const base = dot > 0 ? name.slice(0, dot) : name;
  return `${base}.${ext}`;
}

/**
 * Only the two the editor can honestly claim to produce. Anything else the
 * author names is stored as plain text, which is what it is — the extension
 * still decides how the viewer renders it.
 */
const TYPES: Record<string, string> = {
  md: "text/markdown; charset=utf-8",
  markdown: "text/markdown; charset=utf-8",
  txt: "text/plain; charset=utf-8",
  csv: "text/csv; charset=utf-8",
  json: "application/json; charset=utf-8",
};

/**
 * The name as it will be stored: trimmed, and given an extension if it has none.
 *
 * "Has none" has to mean more than "contains no dot". A note called
 * "Meeting 3.2 actions" or "IEC 61850.8.1 notes" ends in something that is not
 * an extension, and taking it for one leaves the file unpreviewable by the app
 * that just wrote it — so only a short alphanumeric tail counts.
 */
export function noteFileName(raw: string, fallbackExt: string = DEFAULT_EXT): string {
  const name = raw.trim().replace(/[\\/]+/g, "-").replace(/\.+$/, "");
  if (!name) return defaultNoteName(fallbackExt);
  const dot = name.lastIndexOf(".");
  // A leading dot names the file rather than introducing an extension, so
  // ".env" is already complete — appending to it would rename the file on
  // save, which for an edit means a second file instead of a revision.
  if (dot === 0) return name;
  const ext = dot > 0 ? name.slice(dot + 1).toLowerCase() : "";
  if (!/^[a-z0-9]{1,8}$/.test(ext)) return `${name}.${fallbackExt}`;
  return name;
}

/**
 * What an unnamed note is called. Dated, because the alternative is that every
 * unnamed note in a folder is the same file — the second one silently becoming
 * revision two of the first is not what anyone means by "just jot this down".
 */
export function defaultNoteName(ext: string = DEFAULT_EXT): string {
  const today = new Date();
  const stamp = [
    today.getFullYear(),
    String(today.getMonth() + 1).padStart(2, "0"),
    String(today.getDate()).padStart(2, "0"),
  ].join("-");
  return `Note ${stamp}.${ext}`;
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

/**
 * An image goes in on its own line, so it is a block in the rendered note
 * rather than a picture wedged into the middle of a sentence.
 */
export function applyImage(text: string, start: number, end: number, alt: string, url: string): Edit {
  // A single newline is a soft break in Markdown, not a block boundary, so
  // sitting at the start of a line is not enough — without a blank line above
  // it the image joins the paragraph before it.
  const atStart = start === 0;
  const afterBlank = atStart || text.slice(start - 2, start) === "\n\n";
  const atLineStart = atStart || text[start - 1] === "\n";
  const before = afterBlank ? "" : atLineStart ? "\n" : "\n\n";
  const after = text[end] && text[end] !== "\n" ? "\n\n" : "\n";
  const inserted = `${before}![${alt}](${url})${after}`;
  const at = start + inserted.length;
  return { text: text.slice(0, start) + inserted + text.slice(end), start: at, end: at };
}

/**
 * Anything that is not a picture goes in as a link, in line rather than as its
 * own block — a reference to a drawing or a datasheet usually belongs inside a
 * sentence, where an image does not.
 */
export function applyAttachment(text: string, start: number, end: number, label: string, url: string): Edit {
  const inserted = `[${label}](${url})`;
  const at = start + inserted.length;
  return { text: text.slice(0, start) + inserted + text.slice(end), start: at, end: at };
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
  editing = false,
  currentName = null,
  initialName = "",
  initialText = "",
  onCancel,
  onSave,
  onInsertImage,
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
  /** True when an existing note is open, rather than a new one being written. */
  editing?: boolean;
  /**
   * The name the open note actually has, which is not always what the field
   * started with — a restored draft can start it on a different name, and
   * judging collisions by that would silence the warning exactly when the save
   * is about to land on someone else's note.
   */
  currentName?: string | null;
  initialName?: string;
  initialText?: string;
  /** Closing hands back what was typed, so the drive can keep it as a draft. */
  onCancel: (draft: { name: string; text: string }) => void;
  /** Resolves when the note is stored; throws with a message worth showing. */
  onSave: (name: string, text: string) => Promise<void>;
  /**
   * Store an image and return what the note should point at. Absent when the
   * drive cannot take one, in which case the button is not offered.
   */
  onInsertImage?: (file: File) => Promise<{ name: string; url: string }>;
}) {
  const [name, setName] = useState(initialName);
  const [text, setText] = useState(initialText);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const area = useRef<HTMLTextAreaElement>(null);
  const form = useRef<HTMLFormElement>(null);
  const [mode, setMode] = useState<"write" | "preview">("write");
  /**
   * The extension a name with none typed will take. An existing note keeps its
   * own; a new one starts at Markdown, which is a default rather than a rule —
   * the control beside the name changes it, and typing an extension wins.
   */
  const [format, setFormat] = useState(() => extensionOf(initialName) || DEFAULT_EXT);
  const [placing, setPlacing] = useState<string | null>(null);
  const picker = useRef<HTMLInputElement>(null);
  const [preview, setPreview] = useState("");
  /**
   * Where the caret should end up after a formatting button rewrites the text.
   * React re-renders between the two, so the selection has to be reapplied
   * afterwards or every button press would drop the cursor to the end.
   */
  const pending = useRef<[number, number] | null>(null);

  // For a new note any words at all are unsaved. For an edit, only changes are
  // — the note's existing text is already safely in the drive.
  const dirty = editing
    ? text !== initialText || name.trim() !== initialName.trim()
    : Boolean(text.trim()) || name.trim() !== initialName.trim();
  const empty = !text.trim();
  const finalName = noteFileName(name, format);
  const ext = extensionOf(finalName);
  const isMarkdown = ext === "md" || ext === "markdown";
  const known = NOTE_FORMATS.find((f) => f.ext === ext);

  // Saving an edit back over its own name is the point, not a collision. Any
  // other match still is, including renaming an edit onto a neighbour.
  const collides = finalName !== currentName && existingNames.some((n) => n === finalName);

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
    if (mode !== "preview" || !isMarkdown) return;
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
  }, [mode, text, isMarkdown]);

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

  /**
   * Picking a format both sets what an unextended name will take and rewrites
   * an extension already typed — otherwise the control and the name would say
   * different things and the name would quietly win.
   */
  function chooseFormat(next: string) {
    setFormat(next);
    if (name.trim()) setName(withExtension(noteFileName(name, format), next));
    if (next !== "md" && next !== "markdown") setMode("write");
  }

  function attemptCancel() {
    if (busy) return;
    onCancel({ name, text });
  }

  async function submit(ev?: React.FormEvent) {
    ev?.preventDefault();
    // Saving mid-upload would store the note without the reference and leave
    // the uploaded file in the folder with nothing pointing at it.
    if (busy || empty || placing) return;
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
   * Store a file and write a reference to it where the caret is.
   *
   * Anything can go in, not only pictures — a note about a machine wants the
   * datasheet and the drawing beside it. What differs is the reference: an
   * image is embedded so it shows in the note, and everything else is linked.
   *
   * Whether it is an image is decided by the name as well as the reported
   * type, because a browser hands over an empty type often enough — HEIC from
   * a phone, files dragged from some applications, images off the clipboard —
   * and refusing those was the bug this replaces.
   *
   * The file becomes an ordinary file in the note's folder rather than bytes
   * hidden inside the note, so it can be opened, downloaded and replaced like
   * anything else in the drive, and the note stays a plain Markdown file that
   * means the same thing in any editor.
   */
  async function placeFile(file: File) {
    if (!onInsertImage || placing) return;
    setPlacing(file.name);
    setError(null);
    try {
      const { name, url } = await onInsertImage(file);
      const isImage = file.type.startsWith("image/") || kindFor(file.name) === "image";

      // Read the caret now, and write against whatever the note says now — not
      // against the copy this function closed over before the upload. An
      // upload takes long enough to type a sentence into, and inserting into
      // the stale copy would delete it.
      const el = area.current;
      const caret = el ? el.selectionStart : Number.MAX_SAFE_INTEGER;
      const caretEnd = el ? el.selectionEnd : Number.MAX_SAFE_INTEGER;
      setText((prev) => {
        const start = Math.min(caret, prev.length);
        const end = Math.min(caretEnd, prev.length);
        const result = isImage
          ? applyImage(prev, start, end, name, url)
          : applyAttachment(prev, start, end, file.name, url);
        pending.current = [result.start, result.end];
        return result.text;
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : "The file could not be added.");
    } finally {
      setPlacing(null);
    }
  }

  /**
   * Pasting is how a screenshot actually arrives — nobody saves one to disk
   * first to pick it out of a file dialog. Any pasted file is taken, not only
   * an image; text on the clipboard is left to the textarea.
   */
  function onPaste(ev: React.ClipboardEvent<HTMLTextAreaElement>) {
    if (!onInsertImage) return;
    const file = ev.clipboardData.files[0];
    if (!file) return;
    ev.preventDefault();
    placeFile(file);
  }

  /** Dropping a file onto the text is the other way people expect to do this. */
  function onDrop(ev: React.DragEvent<HTMLTextAreaElement>) {
    if (!onInsertImage) return;
    const file = ev.dataTransfer.files[0];
    if (!file) return;
    ev.preventDefault();
    placeFile(file);
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
        aria-label={editing ? `Edit ${initialName}` : "New note"}
      >
        <span className="corner tl" />
        <span className="corner tr" />
        <span className="corner bl" />
        <span className="corner br" />

        <div style={{ display: "flex", alignItems: "baseline", gap: 10 }}>
          <div className="dialog-title">{editing ? "Edit note" : "New note"}</div>
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
          <div style={{ display: "flex", alignItems: "end", gap: 10, flexWrap: "wrap" }}>
            <div style={{ flex: "1 1 260px", minWidth: 0 }}>
              <label htmlFor="note-name">Name</label>
              <input
                id="note-name"
            className="input"
            value={name}
            placeholder={defaultNoteName(format)}
            onChange={(e) => setName(e.target.value)}
            readOnly={busy}
                autoComplete="off"
                spellCheck={false}
              />
            </div>
            <div style={{ flex: "0 0 auto" }}>
              <label htmlFor="note-format">Format</label>
              <select
                id="note-format"
                className="input"
                value={known ? known.ext : ext}
                onChange={(e) => chooseFormat(e.target.value)}
                disabled={busy}
                style={{ width: "auto", minWidth: 168 }}
              >
                {NOTE_FORMATS.map((f) => (
                  <option key={f.ext} value={f.ext}>
                    {f.label}
                  </option>
                ))}
                {/* Whatever was typed or opened, when it is not one of the
                    shortcuts — so an existing .sql or .bib note keeps its own
                    kind instead of being pushed towards Markdown. */}
                {!known && ext && <option value={ext}>.{ext}</option>}
              </select>
            </div>
          </div>
          <div
            style={{
              marginTop: 5,
              fontSize: 11,
              color: "color-mix(in srgb, var(--color-text) 50%, transparent)",
            }}
          >
            {/* What it will actually be called, since the name is normalised. */}
            Saved as {finalName}
            {known ? ` — ${known.note}` : ""}
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
            <div
              className="seg"
              role="group"
              aria-label="Write or preview"
              hidden={!isMarkdown}
            >
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
              {isMarkdown && (
                <>
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
                </>
              )}
              {onInsertImage && (
                <Tool
                  label="Attach a file"
                  hint="Attach a file — images embed, anything else links. Paste or drop one too."
                  onClick={() => picker.current?.click()}
                >
                  <Icon name="upload" size={15} />
                </Tool>
              )}
            </div>
          )}

          <input
            ref={picker}
            type="file"
            hidden
            onChange={(ev) => {
              const file = ev.target.files?.[0];
              ev.target.value = "";
              if (file) placeFile(file);
            }}
          />

          {mode === "preview" && isMarkdown ? (
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
            onPaste={onPaste}
            onDrop={onDrop}
            onDragOver={(ev) => {
              if (onInsertImage && ev.dataTransfer.types.includes("Files")) ev.preventDefault();
            }}
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
            {placing
            ? `Adding ${placing}…`
            : `${bytes.toLocaleString()} bytes · ⌘/Ctrl + Enter to save`}
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
            <button
              type="submit"
              className="btn btn-primary"
              disabled={busy || empty || Boolean(placing)}
            >
              <Icon name="file" size={14} />
              {busy ? "Saving…" : editing ? "Save revision" : "Save note"}
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
