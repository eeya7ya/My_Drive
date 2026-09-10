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

/**
 * How wide an embedded picture is allowed to be, and how large it may end up.
 *
 * A phone camera hands over four thousand pixels of width for something that
 * will be read at seven hundred, and base64 adds a third again on top — so a
 * photo pasted straight in would put several megabytes into a note that has to
 * be loaded, edited and saved as one string. Anything wider is scaled down.
 */
const MAX_IMAGE_WIDTH = 1600;
const MAX_EMBED_BYTES = 4 * 1024 * 1024;

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
 * Anything that already reads as a horizontal rule, whatever it was typed as.
 *
 * Deliberately wider than what the button writes: people separate sections
 * with a long run of dashes typed by hand, and pressing the button on one of
 * those should take it away rather than stack a second rule underneath it.
 */
const RULE_LINE = /^\s*(?:-{3,}|\*{3,}|_{3,})\s*$/;

/**
 * A line across the note, between one section and the next.
 *
 * This is the thing people were typing by hand as a row of twenty dashes. It
 * is written as `---`, which is the same rule in Markdown and renders as a
 * real line in the preview and in the PDF report, rather than as a row of
 * dashes that happens to look like one.
 *
 * The blank line above it is not decoration. A row of dashes directly under a
 * paragraph is Markdown's other meaning for those characters — it turns the
 * line above into a heading — so a rule with nothing between it and the
 * previous sentence silently reformats that sentence.
 *
 * Pressing it on a rule removes it, taking the blank line it came with, so the
 * paragraphs either side end up exactly as they were.
 */
export function applyRule(text: string, start: number, end: number): Edit {
  // Alone among these, a rule goes in after what is selected rather than over
  // it. Everything else here replaces the selection with a formatted version
  // of itself; a line has no text of its own, so replacing a selection with
  // one would simply delete the words — including the words the last button
  // press left selected, which is how it would usually happen.
  const at = Math.max(start, end);
  const from = text.lastIndexOf("\n", at - 1) + 1;
  const nextBreak = text.indexOf("\n", at);
  const to = nextBreak === -1 ? text.length : nextBreak;

  if (RULE_LINE.test(text.slice(from, to))) {
    let head = from;
    let tail = to;
    if (text.slice(tail, tail + 2) === "\n\n") tail += 2;
    else if (text[tail] === "\n") tail += 1;
    // With nothing after it, the blank line above is the one it came with.
    if (tail >= text.length && text.slice(head - 2, head) === "\n\n") head -= 2;
    return { text: text.slice(0, head) + text.slice(tail), start: head, end: head };
  }

  const atStart = at === 0;
  const afterBlank = atStart || text.slice(at - 2, at) === "\n\n";
  const atLineStart = atStart || text[at - 1] === "\n";
  const before = afterBlank ? "" : atLineStart ? "\n" : "\n\n";
  // A rule people are about to write under wants an empty line to write on,
  // which is one newline when the note already carries on with another.
  const after = text[at] === "\n" ? "\n" : "\n\n";
  const inserted = `${before}---${after}`;
  const caret = at + inserted.length;
  return { text: text.slice(0, at) + inserted + text.slice(at), start: caret, end: caret };
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
 * Embed a picture in the note itself.
 *
 * The bytes go in as a data URI, so the note is one self-contained file: it
 * carries its own pictures when it is downloaded, mailed or printed, and the
 * folder it lives in is not littered with the screenshots that belong to it.
 *
 * The URI is written as a reference definition at the foot of the note rather
 * than inline, because a quarter-megabyte of base64 in the middle of a sentence
 * makes the note unreadable in the one place it most needs to be readable —
 * the editor. What sits in the text is `![alt][img-1]`.
 */
export function applyEmbeddedImage(
  text: string,
  start: number,
  end: number,
  alt: string,
  dataUrl: string
): Edit {
  // Reference ids are numbered past whatever the note already uses, so an
  // embed never captures a picture that is already there.
  let next = 1;
  for (const m of text.matchAll(/^\[img-(\d+)\]:/gm)) {
    next = Math.max(next, Number(m[1]) + 1);
  }
  const ref = `img-${next}`;

  const placed = applyImage(text, start, end, alt, "");
  // applyImage writes `![alt]()`; the reference form replaces the empty target.
  const inline = placed.text.replace(`![${alt}]()`, `![${alt}][${ref}]`);
  const shift = inline.length - placed.text.length;

  const separator = inline.endsWith("\n\n") ? "" : inline.endsWith("\n") ? "\n" : "\n\n";
  return {
    text: `${inline}${separator}[${ref}]: ${dataUrl}\n`,
    start: placed.start + shift,
    end: placed.end + shift,
  };
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

/* ── the floating panel ────────────────────────────────────────────────────
   The editor used to be a modal: a sheet of dark over the whole app, closed by
   a click anywhere outside it. That is the wrong shape for what a note here
   actually is — something written *about* what is on screen, with the drawing
   or the datasheet it describes a folder away — because every trip to go and
   look something up closed the note.

   So it is a window instead. It floats over the drive, the drive keeps working
   underneath it, and it stays open until it is closed. What follows are the
   sums that keep it on screen: pure, so the awkward cases — a browser window
   smaller than the panel, a panel dragged half off the edge, a phone — can be
   reasoned about and tested without one.
   ──────────────────────────────────────────────────────────────────────── */

/** How near the edge of the window the panel is allowed to sit. */
const EDGE = 12;
/** Small enough to tuck into a corner, large enough to still be an editor. */
const MIN_WIDTH = 300;
const MIN_HEIGHT = 300;
/** What it opens as, before anyone moves it. */
const OPEN_WIDTH = 560;
const OPEN_HEIGHT = 620;

/** Where the panel is and how big, in pixels from the top left of the window. */
export interface NoteBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** A box, plus the two states that are not about size. */
export interface NoteFrame extends NoteBox {
  /** Rolled up to its title bar: out of the way, still open, still holding the words. */
  collapsed: boolean;
  /** Filled out to the window, for writing something long. */
  full: boolean;
}

export interface Viewport {
  width: number;
  height: number;
}

/**
 * Keep a panel on screen.
 *
 * Size is settled before position, which is what lets the panel grow when it
 * is already against the bottom right corner: widening it pulls its left edge
 * inwards rather than pushing its right edge out of the window. Everything is
 * floored at the minimum, so a browser window shorter than the panel leaves an
 * editor that overflows the screen rather than one squashed to nothing.
 */
export function clampBox(box: NoteBox, view: Viewport): NoteBox {
  const width = Math.min(Math.max(box.width, MIN_WIDTH), Math.max(view.width - EDGE * 2, MIN_WIDTH));
  const height = Math.min(Math.max(box.height, MIN_HEIGHT), Math.max(view.height - EDGE * 2, MIN_HEIGHT));
  return {
    width,
    height,
    x: Math.min(Math.max(box.x, EDGE), Math.max(view.width - width - EDGE, EDGE)),
    y: Math.min(Math.max(box.y, EDGE), Math.max(view.height - height - EDGE, EDGE)),
  };
}

/** Where a panel opens: the bottom right corner, as a compose window does. */
export function openBox(view: Viewport): NoteBox {
  return clampBox(
    {
      x: view.width - OPEN_WIDTH - EDGE,
      y: view.height - OPEN_HEIGHT - EDGE,
      width: OPEN_WIDTH,
      height: OPEN_HEIGHT,
    },
    view
  );
}

/** The whole window bar a margin, which is what "fill the window" means. */
export function filledBox(view: Viewport): NoteBox {
  const width = Math.min(view.width - EDGE * 2, 1040);
  return clampBox(
    { x: (view.width - width) / 2, y: EDGE, width, height: view.height - EDGE * 2 },
    view
  );
}

/** The window as the panel needs to know it. Sized for a server render that never happens. */
function viewportNow(): Viewport {
  if (typeof window === "undefined") return { width: 1280, height: 800 };
  return { width: window.innerWidth, height: window.innerHeight };
}

/**
 * Below this the panel is docked along the bottom of the screen by CSS: a
 * phone has no room to put a window beside anything, and nothing to drag it
 * with. Kept in step with the same query in globals.css.
 */
const DOCKED = "(max-width: 640px)";

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
  frame,
  onFrameChange,
  onDraftChange,
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
  /**
   * Where the panel was left last time. Somebody who has moved the editor out
   * of the way of the tree has said where they want it; opening the next note
   * back in the corner would make them say it again.
   */
  frame?: NoteFrame | null;
  onFrameChange?: (frame: NoteFrame) => void;
  /**
   * The words as they are typed, so the drive is holding a copy of them.
   *
   * The panel no longer blocks the app, so the buttons that open another note
   * are live while one is being written. They can only hand this editor a
   * different note to show — which throws away everything in it — if what was
   * in it has already been handed out. This is how.
   */
  onDraftChange?: (draft: { name: string; text: string }) => void;
}) {
  const [name, setName] = useState(initialName);
  const [text, setText] = useState(initialText);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const area = useRef<HTMLTextAreaElement>(null);
  const [mode, setMode] = useState<"write" | "preview">("write");
  /** The panel itself: where it sits, whether it is rolled up or filled out. */
  const [box, setBox] = useState<NoteBox>(() =>
    frame ? clampBox(frame, viewportNow()) : openBox(viewportNow())
  );
  const [collapsed, setCollapsed] = useState(Boolean(frame?.collapsed));
  const [full, setFull] = useState(Boolean(frame?.full));
  /** True while the CSS above has the panel docked along the bottom of a phone. */
  const [docked, setDocked] = useState(
    () => typeof window !== "undefined" && window.matchMedia(DOCKED).matches
  );
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
  /** Where the panel was before it filled the window, so it can go back. */
  const restore = useRef<NoteBox | null>(null);

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

  /*
   * Two things the modal did are deliberately gone.
   *
   * Escape used to close the editor, from anywhere on the page and before
   * anything else could see the key. A window that stays open until it is
   * closed cannot also vanish on a keystroke aimed at the menu behind it — and
   * with the file viewer now openable underneath, that Escape was being taken
   * from the thing the reader meant it for. The X in the title bar closes.
   *
   * Tab used to be held inside the form, because aria-modal claimed the rest
   * of the page was out of reach. It no longer is: the drive behind this is
   * live, and reaching it with the keyboard is the point.
   */

  /** Hand out what is typed and where the panel sits, without re-rendering on it. */
  const latest = useRef({ onFrameChange, onDraftChange });
  useEffect(() => {
    latest.current = { onFrameChange, onDraftChange };
  });

  useEffect(() => {
    latest.current.onDraftChange?.({ name, text });
  }, [name, text]);

  useEffect(() => {
    latest.current.onFrameChange?.({ ...box, collapsed, full });
  }, [box, collapsed, full]);

  /**
   * A window that is narrower than it was must not leave the panel off the
   * side of it — including the phone case, where the panel stops being a
   * window at all and docks along the bottom.
   */
  useEffect(() => {
    // A panel that was filling the window fills the new one; every other panel
    // is left where it is and merely pulled back inside.
    const onResize = () =>
      setBox((b) => (full ? filledBox(viewportNow()) : clampBox(b, viewportNow())));
    const media = window.matchMedia(DOCKED);
    const onMedia = () => setDocked(media.matches);
    window.addEventListener("resize", onResize);
    media.addEventListener("change", onMedia);
    return () => {
      window.removeEventListener("resize", onResize);
      media.removeEventListener("change", onMedia);
    };
  }, [full]);

  /**
   * Move the panel, or resize it, for as long as the pointer is held.
   *
   * The pointer is captured so a hand that outruns the panel — which is what
   * happens on the first fast drag — keeps moving it instead of dropping it
   * over whatever it crossed. Both gestures work from the box the drag started
   * on plus the total distance travelled, rather than accumulating deltas, so
   * a clamp against the edge of the window is not a step the panel then has to
   * catch up from.
   */
  function startDrag(ev: React.PointerEvent, mode: "move" | "size") {
    // A window filling the screen has nowhere to go, and a docked one is the
    // shape of the phone it is docked to.
    if (docked || full || ev.button !== 0) return;
    // A press on one of the title bar's buttons is a press of that button.
    if ((ev.target as HTMLElement).closest("button")) return;
    ev.preventDefault();

    const handle = ev.currentTarget as HTMLElement;
    const from = box;
    const originX = ev.clientX;
    const originY = ev.clientY;
    handle.setPointerCapture(ev.pointerId);

    const onMove = (e: PointerEvent) => {
      const dx = e.clientX - originX;
      const dy = e.clientY - originY;
      setBox(
        clampBox(
          mode === "move"
            ? { ...from, x: from.x + dx, y: from.y + dy }
            : { ...from, width: from.width + dx, height: from.height + dy },
          viewportNow()
        )
      );
    };
    const onDone = () => {
      handle.releasePointerCapture(ev.pointerId);
      handle.removeEventListener("pointermove", onMove);
      handle.removeEventListener("pointerup", onDone);
      handle.removeEventListener("pointercancel", onDone);
    };
    handle.addEventListener("pointermove", onMove);
    handle.addEventListener("pointerup", onDone);
    handle.addEventListener("pointercancel", onDone);
  }

  /** Fill the window, or go back to where the panel was before it did. */
  function toggleFull() {
    const view = viewportNow();
    if (full) {
      setBox(clampBox(restore.current ?? openBox(view), view));
    } else {
      restore.current = box;
      setBox(filledBox(view));
    }
    setFull(!full);
    // Rolled up and filling the window at once is not a state worth having.
    setCollapsed(false);
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
  /**
   * Shrink an oversized picture before it goes into the note, and hand back a
   * data URI. PNG is kept as PNG so a screenshot's text stays sharp; anything
   * else is re-encoded as JPEG, where a photograph belongs anyway.
   */
  async function toDataUrl(file: File): Promise<string> {
    const original = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.onerror = () => reject(new Error("The image could not be read."));
      reader.readAsDataURL(file);
    });

    const image = await new Promise<HTMLImageElement | null>((resolve) => {
      const el = new Image();
      el.onload = () => resolve(el);
      // A format the browser cannot decode is embedded as it came; the note
      // still carries it, and whatever can open it still can.
      el.onerror = () => resolve(null);
      el.src = original;
    });
    if (!image || image.width <= MAX_IMAGE_WIDTH) return original;

    const scale = MAX_IMAGE_WIDTH / image.width;
    const canvas = document.createElement("canvas");
    canvas.width = MAX_IMAGE_WIDTH;
    canvas.height = Math.round(image.height * scale);
    const ctx = canvas.getContext("2d");
    if (!ctx) return original;
    ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
    const type = file.type === "image/png" ? "image/png" : "image/jpeg";
    const shrunk = canvas.toDataURL(type, 0.85);
    return shrunk.length < original.length ? shrunk : original;
  }

  async function placeFile(file: File) {
    if (placing) return;
    const isImage = file.type.startsWith("image/") || kindFor(file.name) === "image";
    if (!isImage && !onInsertImage) return;

    setPlacing(file.name);
    setError(null);
    try {
      // A picture goes into the note itself and never touches the drive, which
      // is why the folder around a note stays free of its screenshots. Anything
      // else cannot usefully be embedded, so it is stored and linked.
      const alt = file.name.replace(/\.[^.]+$/, "");
      let dataUrl = "";
      let link = { name: alt, url: "" };
      if (isImage) {
        dataUrl = await toDataUrl(file);
        if (dataUrl.length > MAX_EMBED_BYTES) {
          throw new Error(
            "That image is too large to keep inside the note. Upload it to the folder instead and link to it."
          );
        }
      } else {
        link = await onInsertImage!(file);
      }

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
          ? applyEmbeddedImage(prev, start, end, alt, dataUrl)
          : applyAttachment(prev, start, end, file.name, link.url);
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
    const file = ev.clipboardData.files[0];
    if (!file) return;
    ev.preventDefault();
    placeFile(file);
  }

  /** Dropping a file onto the text is the other way people expect to do this. */
  function onDrop(ev: React.DragEvent<HTMLTextAreaElement>) {
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
    <form
      className={`dc-note blueprint${collapsed ? " dc-note-shut" : ""}`}
      style={{
        position: "fixed",
        left: box.x,
        top: box.y,
        width: box.width,
        // Rolled up, the panel is exactly as tall as its title bar.
        height: collapsed ? "auto" : box.height,
        display: "flex",
        flexDirection: "column",
        // Above the file viewer and the mobile drawer, so a note can be written
        // about the drawing it is open on rather than instead of it.
        zIndex: 95,
        background: "var(--color-surface)",
        boxShadow: "var(--shadow-lg)",
      }}
      onSubmit={submit}
      role="dialog"
      aria-label={editing ? `Edit ${initialName}` : "New note"}
    >
      <span className="corner tl" />
      <span className="corner tr" />
      <span className="corner bl" />
      <span className="corner br" />

      {/* The title bar is the handle: everything that is not a button in it
          moves the panel, and a double click rolls it up. */}
      <div
        onPointerDown={(ev) => startDrag(ev, "move")}
        onDoubleClick={(ev) => {
          if ((ev.target as HTMLElement).closest("button")) return;
          setCollapsed((was) => !was);
        }}
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          padding: "7px 7px 7px var(--space-4)",
          borderBottom: collapsed ? "none" : "1px solid var(--color-divider)",
          background: "color-mix(in srgb, var(--color-text) 5%, transparent)",
          cursor: docked || full ? "default" : "move",
          // Only while it is a handle: docked, a touch here should scroll the
          // page as it would anywhere else.
          touchAction: docked || full ? "auto" : "none",
          userSelect: "none",
          flex: "0 0 auto",
        }}
      >
        <div className="dialog-title" style={{ fontSize: 15 }}>
          {editing ? "Edit note" : "New note"}
        </div>
        <div
          style={{
            fontSize: 12,
            minWidth: 0,
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
            color: "color-mix(in srgb, var(--color-text) 55%, transparent)",
          }}
        >
          {/* Where it will land, which once the drive is navigable underneath
              is no longer the folder on screen. */}
          in {folderName}
        </div>
        {dirty && (
          <span
            title="Not saved yet"
            style={{
              flex: "0 0 auto",
              fontSize: 10,
              letterSpacing: ".06em",
              textTransform: "uppercase",
              color: "var(--color-accent-700)",
            }}
          >
            Unsaved
          </span>
        )}
        <div style={{ marginLeft: "auto", display: "flex", gap: 2, flex: "0 0 auto" }}>
          <Tool
            label={collapsed ? "Unroll the note" : "Roll the note up"}
            hint={collapsed ? "Unroll" : "Roll up"}
            onClick={() => setCollapsed((was) => !was)}
          >
            <Icon
              name="chevron"
              size={15}
              style={{ transform: `rotate(${collapsed ? 90 : -90}deg)` }}
            />
          </Tool>
          {!docked && (
            <Tool
              label={full ? "Back to a window" : "Fill the window"}
              hint={full ? "Back to a window" : "Fill the window"}
              onClick={toggleFull}
            >
              <Icon name={full ? "shrink" : "expand"} size={15} />
            </Tool>
          )}
          <Tool label="Close the note" hint="Close" onClick={attemptCancel}>
            <Icon name="close" size={15} />
          </Tool>
        </div>
      </div>

      {/* Everything below the bar is hidden rather than unmounted when the
          panel is rolled up: an unmounted textarea loses the browser's own
          undo history, which is not this editor's to throw away. */}
      <div
        style={{
          display: collapsed ? "none" : "flex",
          flexDirection: "column",
          gap: "var(--space-3)",
          padding: "var(--space-4)",
          flex: "1 1 auto",
          minHeight: 0,
          overflow: "auto",
        }}
      >
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

        <div
          className="field"
          style={{ display: "flex", flexDirection: "column", flex: "1 1 auto", minHeight: 0 }}
        >
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
              <Tool
                label="Line between sections"
                hint="Line between sections"
                onClick={() => at(applyRule)}
              >
                <Icon name="split" size={15} />
              </Tool>
                </>
              )}
              {(
                <Tool
                  label="Add a picture or a file"
                  hint="Pictures go inside the note; anything else is stored in the folder and linked. Paste or drop one too."
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
            // The pane scrolls, and .dc-doc sits inside it holding the
            // measure. The two were one element, which left the wheel dead
            // over the margins beside the centred column — see FileViewer.
            <div
              style={{
                flex: "1 1 auto",
                minHeight: 120,
                overflow: "auto",
                border: "1px solid var(--color-divider)",
                background: "var(--color-bg)",
              }}
            >
              <div
                className="dc-doc"
                style={{ padding: "14px 16px" }}
                dangerouslySetInnerHTML={{ __html: preview }}
              />
            </div>
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
              if (ev.dataTransfer.types.includes("Files")) ev.preventDefault();
            }}
            // readOnly rather than disabled: a disabled textarea's contents
            // cannot be selected or copied, so a save that is merely slow would
            // hold the author's only copy of their words out of reach.
            readOnly={busy}
            spellCheck
            style={{
              // The panel is what gets resized now, so the textarea takes
              // whatever is left of it rather than carrying its own handle.
              flex: "1 1 auto",
              minHeight: 120,
              resize: "none",
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
              Close
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
      </div>

      {/* The corner to pull. Dragging it out while the panel is already against
          the edge of the window widens it leftwards — see clampBox. */}
      {!collapsed && !full && !docked && (
        <span
          aria-hidden
          onPointerDown={(ev) => startDrag(ev, "size")}
          style={{
            position: "absolute",
            right: 2,
            bottom: 2,
            width: 16,
            height: 16,
            cursor: "nwse-resize",
            touchAction: "none",
            background:
              "linear-gradient(135deg, transparent 0 46%, var(--color-divider) 46% 54%, transparent 54% 70%, var(--color-divider) 70% 78%, transparent 78%)",
          }}
        />
      )}
    </form>
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
 *
 * A keyboard press of a button is a click with no mouse behind it, which
 * detail === 0 is how the browser says so. Without that line these buttons
 * exist only for people using a pointer.
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
      onClick={(ev) => {
        if (ev.detail === 0) onClick();
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
