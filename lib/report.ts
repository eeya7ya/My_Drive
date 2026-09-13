/**
 * Every note in a drive, gathered into one sectionalised PDF report.
 *
 * This writes a real PDF rather than handing the browser a page and asking for
 * "Save as PDF" — that destination is buried on desktop and missing outright
 * on several mobile browsers, so a report that depends on finding it is a
 * report some readers can never get. What comes out of here downloads as a
 * file, on any device, with one press.
 *
 * The price of that is a typesetter: browsers have one, PDF writers do not, so
 * the second half of this file is a small one — line breaking, pagination,
 * tables, lists, code and pictures. It is deliberately plain. The report is a
 * record of what the notes say, not a redesign of them.
 *
 * The report is set in Geist, the app's own typeface, embedded from lib/fonts
 * and subsetted to what each report uses. Two limits worth knowing:
 *   - Text is folded to WinAnsi, which covers Latin and the punctuation notes
 *     actually use. Anything outside it is transliterated (see `toWinAnsi`);
 *     Arabic and CJK come through as "?" and belong in the browser print
 *     route. The fold is kept even though an embedded font could carry more,
 *     because it is also what makes the built-in-font fallback safe, and
 *     because "R <= 0.5 Ohm" beats a row of missing glyphs either way.
 *   - Pictures embed as PNG or JPEG. Anything else is named rather than drawn.
 *
 * Everything above the rendering marker is pure — no pdf-lib, no fonts, no
 * database — so scripts/test-report.mjs can check the outline and the line
 * breaking without a browser or a bucket.
 */

import { readFile } from "node:fs/promises";
import { join } from "node:path";
import fontkit from "@pdf-lib/fontkit";
import { marked } from "marked";
import { PDFDocument, PDFName, PDFString, StandardFonts, rgb } from "pdf-lib";
import type { PDFFont, PDFImage, PDFPage } from "pdf-lib";
import type { Token, Tokens } from "marked";
import type { DriveFile, TreeNode } from "./types";

/* ── the outline ──────────────────────────────────────────────────────────
   A report is only as good as its numbering, so the numbering is not invented
   here: it is the drive's own. Folder "3.2" in the sidebar is section "3.2" in
   the report, which is what makes the two things talk about each other.

   Notes take the numbers that come after their folder's subfolders — folder 3
   with subfolders 3.1 and 3.2 numbers its own notes 3.3, 3.4 — so an outline
   number is never claimed twice, and the sections still read in order.
   ─────────────────────────────────────────────────────────────────────── */

export interface ReportFolderEntry {
  kind: "folder";
  /** Outline number: "3", "3.2". Empty only for a report of a single note. */
  number: string;
  title: string;
  /** 0 for a top-level section; each level of folder adds one. */
  depth: number;
}

export interface ReportNoteEntry {
  kind: "note";
  number: string;
  title: string;
  depth: number;
  fileId: string;
  /** The note's name in the drive, shown under its heading. */
  fileName: string;
  /** When the shown revision was uploaded, already formatted. */
  updated: string;
  /** Filled in by the caller once the bytes have been read. */
  markdown: string;
}

export type ReportEntry = ReportFolderEntry | ReportNoteEntry;

/** Drop a file's extension: "Alternator Notes.md" -> "Alternator Notes". */
export function baseName(name: string): string {
  return name.replace(/\.[^./\\]+$/, "") || name;
}

/**
 * Walk the drive and lay out the report's sections.
 *
 * A folder is included only when it, or something under it, holds a note that
 * is going in — a report of the notes should not be mostly empty headings. Its
 * number is left as the drive assigned it, so pruning leaves gaps rather than
 * renumbering the drive behind the reader's back.
 *
 * `chosen`, when given, narrows the report to exactly those notes: a report of
 * four notes picked out of a folder of forty. Everything else about the layout
 * is unchanged, so a selective report still reads as a section of the drive
 * rather than as a pile of loose pages — the folders the chosen notes live in
 * are still printed as headings, in tree order, and folders that contributed
 * nothing drop out entirely.
 */
export function planReport(
  tree: TreeNode[],
  rootFiles: DriveFile[],
  isNote: (name: string) => boolean,
  chosen?: ReadonlySet<string> | null
): ReportEntry[] {
  const entries: ReportEntry[] = [];

  /** A note the report is taking: one of the drive's, and one that was picked. */
  const wanted = (file: DriveFile): boolean =>
    isNote(file.name) && (!chosen || chosen.has(file.id));

  const noteEntry = (
    file: DriveFile,
    number: string,
    depth: number
  ): ReportNoteEntry => ({
    kind: "note",
    number,
    title: baseName(file.name),
    depth,
    fileId: file.id,
    fileName: file.name,
    updated: file.uploadedAt,
    markdown: "",
  });

  /** Does this subtree hold a single wanted note? Decides whether it is printed. */
  const holdsNote = (node: TreeNode): boolean =>
    node.files.some(wanted) || node.children.some(holdsNote);

  const walk = (node: TreeNode, depth: number) => {
    entries.push({
      kind: "folder",
      number: node.number,
      title: node.name,
      depth,
    });
    // Subfolders first, then this folder's own notes — the order the outline
    // numbers count in, so a reader never has to jump backwards.
    for (const child of node.children) {
      if (holdsNote(child)) walk(child, depth + 1);
    }
    const after = node.children.length;
    node.files.filter(wanted).forEach((f, i) => {
      entries.push(noteEntry(f, `${node.number}.${after + i + 1}`, depth + 1));
    });
  };

  for (const node of tree) {
    if (holdsNote(node)) walk(node, 0);
  }

  // Notes sitting loose at the drive root are numbered past the last folder,
  // whether or not that folder made it into the report.
  rootFiles.filter(wanted).forEach((f, i) => {
    entries.push(noteEntry(f, String(tree.length + i + 1), 0));
  });

  return entries;
}

/** The notes in an outline, in the order they will be printed. */
export function notesOf(entries: ReportEntry[]): ReportNoteEntry[] {
  return entries.filter((e): e is ReportNoteEntry => e.kind === "note");
}

/**
 * What to call a note in the contents.
 *
 * A note that opens with a heading has already been given a title by whoever
 * wrote it, and it is nearly always better than the file name — "Stator
 * winding temperature rise" against "notes-3.md". The heading is dropped from
 * the body in exchange, so the title is not printed twice.
 */
function leadingHeading(markdown: string): string {
  const m = /^\uFEFF?\s*#\s+(.+?)\s*#*\s*$/m.exec(markdown.slice(0, 2000));
  const heading = m && markdown.slice(0, m.index).trim() === "" ? m[1].trim() : "";
  // Markdown emphasis around a title is markup, not part of the words.
  return heading.replace(/[*_`]/g, "").trim();
}

export function noteTitle(markdown: string, fileName: string): string {
  return leadingHeading(markdown) || baseName(fileName);
}

/**
 * Whether the note opens with a heading the report is about to print for it.
 *
 * This used to ask whether the title had ended up different from the file
 * name, which is not the same question and got the commonest case wrong: a
 * note called "Site survey.md" that opens with "# Site survey" produced a
 * title identical to its file name, so the opening heading was kept — and the
 * words printed twice, once as the report's numbered heading and again as the
 * note's own, one line below it. What matters is only whether the note opens
 * with a heading at all: when it does, `noteTitle` takes the title from it, so
 * the report's heading is already saying those words.
 */
export function usesLeadingHeading(markdown: string): boolean {
  return leadingHeading(markdown) !== "";
}

/* ── text ────────────────────────────────────────────────────────────────── */

/** The characters WinAnsi keeps in the 0x80–0x9F block, which Latin-1 leaves empty. */
const WIN_ANSI_HIGH = new Set(
  ("\u20AC\u201A\u0192\u201E\u2026\u2020\u2021\u02C6\u2030\u0160\u2039\u0152\u017D" +
    "\u2018\u2019\u201C\u201D\u2022\u2013\u2014\u02DC\u2122\u0161\u203A\u0153\u017E\u0178").split("")
);

/**
 * What an engineering note reaches for that WinAnsi has no room for. Spelled
 * out rather than dropped: "R <= 0.5 Ohm" is still the measurement, while
 * "R ? 0.5 ?" is not.
 */
const TRANSLITERATE: Record<string, string> = {
  "\u2192": "->", "\u2190": "<-", "\u2194": "<->", "\u21D2": "=>", "\u21D0": "<=",
  "\u2264": "<=", "\u2265": ">=", "\u2260": "!=", "\u2248": "~", "\u221E": "inf",
  "\u2212": "-", "\u2044": "/", "\u221A": "sqrt", "\u2211": "Sum", "\u220F": "Prod",
  "\u03A9": "Ohm", "\u0394": "Delta", "\u2206": "Delta", "\u03A6": "Phi",
  "\u03B1": "alpha", "\u03B2": "beta", "\u03B3": "gamma", "\u03B4": "delta",
  "\u03B5": "eps", "\u03B7": "eta", "\u03B8": "theta", "\u03BB": "lambda",
  "\u03BC": "\u00B5", "\u03C0": "pi", "\u03C1": "rho", "\u03C3": "sigma",
  "\u03C6": "phi", "\u03C8": "psi", "\u03C9": "omega",
  "\u2032": "'", "\u2033": "\"",
  "\u2713": "[x]", "\u2714": "[x]", "\u2717": "[ ]", "\u2718": "[ ]",
  "\uFB01": "fi", "\uFB02": "fl", "\u2011": "-", "\u2500": "-",
  "\u25CF": "\u2022", "\u25AA": "\u2022", "\u25A0": "\u2022", "\u25B8": "\u2022",
};

/** Invisible characters that would otherwise measure as a glyph or a "?". */
const INVISIBLE = /[\u200B-\u200F\u202A-\u202E\u2060\uFEFF\uFE0E\uFE0F]/g;

/** Combining marks left behind by a compatibility decomposition. */
const COMBINING = /[\u0300-\u036F]/g;

/**
 * Fold text into what the standard fonts can actually draw.
 *
 * pdf-lib throws on a character WinAnsi cannot encode, and a report that dies
 * because one note contains an arrow is worse than a report that prints "->".
 * So this is a safety net as much as a nicety: everything that leaves here is
 * drawable.
 */
export function toWinAnsi(text: string): string {
  let out = "";
  for (const ch of text.normalize("NFC").replace(INVISIBLE, "")) {
    const mapped = TRANSLITERATE[ch];
    if (mapped !== undefined) {
      out += mapped;
      continue;
    }
    const code = ch.codePointAt(0)!;
    // Whitespace is whitespace. A newline inside a paragraph is the source
    // file wrapping, not a character to draw, and a tab is an indent — but
    // both sit below WinAnsi's printable range, so without this they fell past
    // every branch to the "?" at the bottom and printed one in the middle of
    // the sentence, wherever the writer's line happened to end. Collapsing
    // them to a space is what the line breaker does with them anyway, and it
    // is what the non-breaking space was already being folded to. Code never
    // arrives here holding either: wrapCode has expanded its tabs and split it
    // into lines before a character of it is encoded.
    if (/\s/.test(ch)) {
      out += " ";
    } else if ((code >= 0x20 && code <= 0x7e) || (code >= 0xa0 && code <= 0xff)) {
      out += ch;
    } else if (WIN_ANSI_HIGH.has(ch)) {
      out += ch;
    } else {
      // Last chance: é written as "e" plus a combining accent decomposes into
      // something Latin-1 holds. Only then give up on the character.
      const folded = ch.normalize("NFKD").replace(COMBINING, "");
      out += folded !== ch ? toWinAnsi(folded) : "?";
    }
  }
  return out;
}

/**
 * Greedy line breaking against a measured width.
 *
 * `measure` is injected so this can be tested without a font: the renderer
 * passes pdf-lib's width function, the test passes a character count.
 */
export function wrapText(
  text: string,
  maxWidth: number,
  measure: (s: string) => number
): string[] {
  const lines: string[] = [];
  for (const paragraph of text.split("\n")) {
    const words = paragraph.split(/\s+/).filter(Boolean);
    if (!words.length) {
      lines.push("");
      continue;
    }
    let line = "";
    for (const word of words) {
      const candidate = line ? `${line} ${word}` : word;
      if (measure(candidate) <= maxWidth || !line) {
        // A single word wider than the column has to be broken somewhere;
        // breaking it by character keeps it on the page instead of running
        // off the edge, which is what an unbroken URL would otherwise do.
        if (!line && measure(word) > maxWidth) {
          const pieces = breakWord(word, maxWidth, measure);
          lines.push(...pieces.slice(0, -1));
          line = pieces[pieces.length - 1];
          continue;
        }
        line = candidate;
      } else {
        lines.push(line);
        line = measure(word) > maxWidth ? "" : word;
        if (!line) {
          const pieces = breakWord(word, maxWidth, measure);
          lines.push(...pieces.slice(0, -1));
          line = pieces[pieces.length - 1];
        }
      }
    }
    if (line) lines.push(line);
  }
  return lines;
}

function breakWord(
  word: string,
  maxWidth: number,
  measure: (s: string) => number
): string[] {
  const out: string[] = [];
  let piece = "";
  for (const ch of word) {
    if (piece && measure(piece + ch) > maxWidth) {
      out.push(piece);
      piece = ch;
    } else {
      piece += ch;
    }
  }
  out.push(piece);
  return out;
}

/**
 * Line breaking for text whose spacing is the content — code, and anything
 * else printed as typed. `wrapText` collapses runs of whitespace, which is
 * right for a paragraph and destroys an indented block, so this one never
 * touches what is inside a line: it only decides where to cut it, preferring
 * a space and falling back to mid-word when there is none.
 */
export function wrapCode(
  text: string,
  maxWidth: number,
  measure: (s: string) => number
): string[] {
  const out: string[] = [];
  for (const raw of text.replace(/\t/g, "    ").split("\n")) {
    let line = raw;
    while (measure(line) > maxWidth) {
      // Find the longest prefix that fits, then back up to a space if there is
      // one late in it, so a wrapped line breaks between tokens where it can.
      let cut = line.length;
      while (cut > 1 && measure(line.slice(0, cut)) > maxWidth) cut--;
      const space = line.lastIndexOf(" ", cut);
      const at = space > cut * 0.6 ? space : cut;
      out.push(line.slice(0, at));
      line = line.slice(space > cut * 0.6 ? at + 1 : at);
      if (!line) break;
    }
    out.push(line);
  }
  return out;
}

/** "eSpark Drive" -> "eSpark-Drive-Notes-Report-2026-09-06.pdf". */
export function reportFileName(title: string, at: number): string {
  const stamp = new Date(at).toISOString().slice(0, 10);
  const stem =
    title
      .normalize("NFKD")
      .replace(COMBINING, "")
      .replace(/[^A-Za-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || "Drive";
  return `${stem}-Notes-Report-${stamp}.pdf`;
}

/* ── rendering ────────────────────────────────────────────────────────────
   Below here is the typesetter. Nothing above this line imports pdf-lib, so
   the outline and the line breaking stay testable on their own.
   ─────────────────────────────────────────────────────────────────────── */

/** A4, in points, which is what a PDF measures in. */
const PAGE = { w: 595.28, h: 841.89 };
const MARGIN = { top: 66, bottom: 62, left: 62, right: 62 };
const COLUMN = PAGE.w - MARGIN.left - MARGIN.right;

/**
 * The drive's own palette, in the form pdf-lib wants.
 *
 * Every value here is a token from app/design-system.css rather than a colour
 * picked to suit a page, so a printed report and the screen it came from are
 * recognisably the same document. The accent ramp is used at its ends as well
 * as its middle — DEEP for a field a reader looks at once, ACCENT for the
 * headings they read all the way through, SOFT and the two tints for the
 * surfaces underneath them — because a report that says everything in one
 * blue reads as decorated rather than organised.
 */
const INK = rgb(0.106, 0.118, 0.125); // #1B1E20  --color-text
const MUTED = rgb(0.373, 0.365, 0.357); // #5F5D5B
const FAINT = rgb(0.604, 0.596, 0.588); // #9A9896
const RULE = rgb(0.843, 0.831, 0.824); // #D7D4D2
const ACCENT = rgb(0.282, 0.384, 0.427); // #48626D  --color-accent-700
const ACCENT_DEEP = rgb(0.188, 0.275, 0.31); // #30464F  --color-accent-800
const ACCENT_MID = rgb(0.357, 0.471, 0.518); // #5B7884  --brand-primary
const ACCENT_SOFT = rgb(0.643, 0.737, 0.776); // #A4BCC6  --color-accent-400
const TINT = rgb(0.843, 0.922, 0.957); // #D7EBF4  --color-accent-200
const TINT_PALE = rgb(0.902, 0.976, 1.0); // #E6F9FF  --color-accent-100
const WHITE = rgb(1, 1, 1);

/**
 * The drive's second accent, which the report had never used.
 *
 * One colour used for everything says only "this is coloured". Two, given
 * jobs, say what a thing is: the blue is the report's own apparatus — the
 * numbering, the headings, the table heads, the rules that divide it — and the
 * sage is what the note brought with it, the code it quotes and the passages
 * it quotes from somewhere else. A reader never has to be told that; they
 * only have to notice that the green things are all the same kind of thing.
 */
const SAGE = rgb(0.329, 0.38, 0.341); // #546157  --color-accent-2
const SAGE_SOFT = rgb(0.682, 0.737, 0.671); // #AEBCAB  --color-accent-2-400
const SAGE_PALE = rgb(0.925, 0.98, 0.933); // #ECFAEE  --color-accent-2-100

const BODY_SIZE = 10.5;
const BODY_LEAD = 15.4;

type Colour = ReturnType<typeof rgb>;

interface Fonts {
  regular: PDFFont;
  bold: PDFFont;
  italic: PDFFont;
  boldItalic: PDFFont;
  mono: PDFFont;
  monoBold: PDFFont;
}

/** One styled fragment of a line of prose. */
interface Style {
  font: PDFFont;
  size: number;
  colour: Colour;
  link?: string;
}

interface Atom {
  text: string;
  style: Style;
}

/** A picture the report may draw, already decoded. */
export interface ReportImage {
  bytes: Uint8Array;
  /** PDF embeds these two and nothing else. */
  type: "png" | "jpg";
}

export interface ReportInput {
  /** The outline from `planReport`, with every note's markdown filled in. */
  entries: ReportEntry[];
  /** The drive's name — the report's title. */
  title: string;
  /** The line under it on the cover, usually the drive's tagline. */
  subtitle: string;
  /** What the report covers: "My Drive", or a folder's breadcrumb. */
  scope: string;
  /** The mark in the cover's bottom corner, or null. */
  poweredBy: string | null;
  generatedAt: number;
  /**
   * Turn a picture's address in a note into bytes. Returning null leaves the
   * picture named rather than drawn, which is what happens to a format PDF
   * cannot hold and to anything the reader is not allowed to fetch.
   */
  resolveImage?: (href: string) => Promise<ReportImage | null>;
}

/**
 * The page a section starts on, gathered on the first pass and spent on the
 * second — a table of contents cannot be written until the body has been laid
 * out, and the body's page numbers cannot be written until the table of
 * contents has a length. Both passes run the same code; only `draw` differs.
 */
type PageIndex = Map<number, number>;

class Sheet {
  page: PDFPage | null = null;
  /** Every body page, in order, so the contents can point at them. */
  readonly pages: PDFPage[] = [];
  /** Distance from the top of the page to the next thing drawn. */
  y = 0;
  /** How many body pages have been started. */
  count = 0;
  /** The section named in the running head. */
  section = "";

  constructor(
    private doc: PDFDocument,
    readonly fonts: Fonts,
    private readonly draw: boolean,
    private readonly title: string,
    /** Pages ahead of the body — cover and contents. Zero on the first pass. */
    private readonly offset = 0,
    /** The report's length, for "3 of 24". Zero on the first pass. */
    private readonly total = 0
  ) {}

  get atTop(): boolean {
    return this.y === MARGIN.top && this.count > 0;
  }

  get room(): number {
    return PAGE.h - MARGIN.bottom - this.y;
  }

  newPage(): void {
    this.count++;
    this.y = MARGIN.top;
    if (!this.draw) return;
    this.page = this.doc.addPage([PAGE.w, PAGE.h]);
    this.pages.push(this.page);
    this.chrome();
  }

  /** Everything on a body page that is not the notes: head, rule, folio. */
  private chrome(): void {
    const page = this.page!;
    const f = this.fonts;
    const top = PAGE.h - MARGIN.top + 22;
    page.drawText(toWinAnsi(this.title), {
      x: MARGIN.left,
      y: top,
      size: 7.6,
      font: f.regular,
      color: MUTED,
    });
    if (this.section) {
      // The section, not the drive, is what a reader flicking through pages is
      // looking for, so it is the half of the head that carries the colour.
      const label = this.fit(this.section, f.bold, 7.6, COLUMN * 0.6);
      const w = f.bold.widthOfTextAtSize(label, 7.6);
      page.drawText(label, {
        x: PAGE.w - MARGIN.right - w,
        y: top,
        size: 7.6,
        font: f.bold,
        color: ACCENT,
      });
    }
    page.drawLine({
      start: { x: MARGIN.left, y: top - 7 },
      end: { x: PAGE.w - MARGIN.right, y: top - 7 },
      thickness: 0.5,
      color: RULE,
    });
    // The app's accent edge, kept to a stub so the head stays a head.
    page.drawRectangle({
      x: MARGIN.left,
      y: top - 7.8,
      width: 26,
      height: 1.6,
      color: ACCENT,
    });

    // A rule over the folio, to close the page. Without it the text block has
    // an edge at the top and nothing at the bottom, and the last line of a
    // short page falls off into white.
    page.drawLine({
      start: { x: MARGIN.left, y: MARGIN.bottom - 12 },
      end: { x: PAGE.w - MARGIN.right, y: MARGIN.bottom - 12 },
      thickness: 0.5,
      color: RULE,
    });

    // "3" is the number a reader is looking for and "of 24" is the reassurance
    // that there is more; they are not the same message and are not set alike.
    const here = String(this.offset + this.count);
    const rest = ` of ${this.total}`;
    const hereW = f.bold.widthOfTextAtSize(here, 8.6);
    const restW = f.regular.widthOfTextAtSize(rest, 8);
    const fx = (PAGE.w - hereW - restW) / 2;
    page.drawText(here, {
      x: fx,
      y: MARGIN.bottom - 26,
      size: 8.6,
      font: f.bold,
      color: ACCENT,
    });
    page.drawText(rest, {
      x: fx + hereW,
      y: MARGIN.bottom - 26,
      size: 8,
      font: f.regular,
      color: FAINT,
    });
  }

  /** Make sure `height` fits below the cursor, starting a page if it does not. */
  need(height: number): void {
    if (this.count === 0 || this.room < height) this.newPage();
  }

  down(by: number): void {
    this.y += by;
  }

  text(
    value: string,
    x: number,
    style: Style,
    /** Baseline offset from the cursor; the caller advances y itself. */
    baseline: number
  ): void {
    if (!this.draw || !this.page || !value) return;
    this.page.drawText(value, {
      x,
      y: PAGE.h - this.y - baseline,
      size: style.size,
      font: style.font,
      color: style.colour,
    });
    if (style.link) {
      this.link(
        style.link,
        x,
        PAGE.h - this.y - baseline - 2,
        style.font.widthOfTextAtSize(value, style.size),
        style.size + 2
      );
    }
  }

  /**
   * Letterspaced small type at the cursor.
   *
   * PDF has no setting for tracking, so an eyebrow is drawn a character at a
   * time. Worth the loop: it is what makes a seven-point label read as a label
   * rather than as small print.
   */
  tracked(
    value: string,
    x: number,
    style: Style,
    baseline: number,
    spacing: number
  ): void {
    if (!this.draw || !this.page) return;
    let cx = x;
    for (const ch of toWinAnsi(value)) {
      this.page.drawText(ch, {
        x: cx,
        y: PAGE.h - this.y - baseline,
        size: style.size,
        font: style.font,
        color: style.colour,
      });
      cx += style.font.widthOfTextAtSize(ch, style.size) + spacing;
    }
  }

  /** Same as `text`, but at a distance from the page top the caller chooses. */
  textAt(
    value: string,
    x: number,
    atY: number,
    style: Style,
    baseline: number
  ): void {
    if (!this.draw || !this.page || !value) return;
    this.page.drawText(value, {
      x,
      y: PAGE.h - atY - baseline,
      size: style.size,
      font: style.font,
      color: style.colour,
    });
  }

  rectAt(
    x: number,
    atY: number,
    width: number,
    height: number,
    colour: Colour
  ): void {
    if (!this.draw || !this.page) return;
    this.page.drawRectangle({
      x,
      y: PAGE.h - atY - height,
      width,
      height,
      color: colour,
    });
  }

  rect(x: number, width: number, height: number, colour: Colour): void {
    if (!this.draw || !this.page) return;
    this.page.drawRectangle({
      x,
      y: PAGE.h - this.y - height,
      width,
      height,
      color: colour,
    });
  }

  line(x1: number, x2: number, atY: number, thickness = 0.5, colour = RULE): void {
    if (!this.draw || !this.page) return;
    this.page.drawLine({
      start: { x: x1, y: PAGE.h - atY },
      end: { x: x2, y: PAGE.h - atY },
      thickness,
      color: colour,
    });
  }

  image(img: PDFImage, x: number, width: number, height: number): void {
    if (!this.draw || !this.page) return;
    this.page.drawImage(img, { x, y: PAGE.h - this.y - height, width, height });
  }

  /** A clickable region pointing out of the document. */
  link(url: string, x: number, y: number, width: number, height: number): void {
    if (!this.draw || !this.page) return;
    const annot = this.doc.context.obj({
      Type: "Annot",
      Subtype: "Link",
      Rect: [x, y, x + width, y + height],
      Border: [0, 0, 0],
      A: { Type: "Action", S: "URI", URI: PDFString.of(url) },
    });
    this.page.node.addAnnot(this.doc.context.register(annot));
  }

  /** Trim to width, ending in an ellipsis rather than running into the next column. */
  fit(value: string, font: PDFFont, size: number, width: number): string {
    return clip(toWinAnsi(value), font, size, width);
  }
}

/* ── the typefaces ────────────────────────────────────────────────────────
   The app is set in Geist; the report used to be set in Helvetica, because
   Helvetica is one of the fourteen faces every PDF reader already owns and
   costs nothing to use. It also looks like nothing in particular, which is the
   wrong note for the one thing a drive sends to people who never see the
   drive. The files live in lib/fonts — a PDF has to carry its own, since a
   reader opening it has no stylesheet to follow — and they are the same files
   the app's own stylesheet pulls from Google Fonts, so a heading on paper is
   the same drawing of the same letter as the heading on screen.
   ─────────────────────────────────────────────────────────────────────── */

const FONT_DIR = join(process.cwd(), "lib", "fonts");

/**
 * Read once per process rather than once per report. A warm function builds
 * many reports and the family is half a megabyte; reading it off disk for each
 * one is half a megabyte of nothing.
 */
const faceCache = new Map<string, Uint8Array>();

async function face(file: string): Promise<Uint8Array> {
  const held = faceCache.get(file);
  if (held) return held;
  const bytes = new Uint8Array(await readFile(join(FONT_DIR, file)));
  faceCache.set(file, bytes);
  return bytes;
}

/**
 * Embed the family, or fall back to the built-in faces.
 *
 * Subsetted, so a report carries only the glyphs it actually uses: tens of
 * kilobytes rather than the 450 the whole family weighs.
 *
 * The fallback is the point of the try. Embedding reads six files off the
 * deployed filesystem, and a file that did not make it into a serverless
 * bundle is the classic way for that to fail in production having worked
 * everywhere else. A report set in Helvetica is a small disappointment; a
 * report that 500s because a font is missing is a broken feature, and the
 * reader cannot tell which of the two they were owed.
 */
async function embedFaces(doc: PDFDocument): Promise<Fonts> {
  try {
    doc.registerFontkit(fontkit);
    const load = async (file: string) =>
      doc.embedFont(await face(file), { subset: true });
    return {
      regular: await load("Geist-Regular.ttf"),
      bold: await load("Geist-Bold.ttf"),
      italic: await load("Geist-Italic.ttf"),
      boldItalic: await load("Geist-BoldItalic.ttf"),
      mono: await load("GeistMono-Regular.ttf"),
      monoBold: await load("GeistMono-Bold.ttf"),
    };
  } catch {
    return {
      regular: await doc.embedFont(StandardFonts.Helvetica),
      bold: await doc.embedFont(StandardFonts.HelveticaBold),
      italic: await doc.embedFont(StandardFonts.HelveticaOblique),
      boldItalic: await doc.embedFont(StandardFonts.HelveticaBoldOblique),
      mono: await doc.embedFont(StandardFonts.Courier),
      monoBold: await doc.embedFont(StandardFonts.CourierBold),
    };
  }
}

/**
 * Build the report.
 *
 * Laid out twice on purpose. The first pass draws nothing and exists to learn
 * two numbers that depend on each other — which page each section lands on,
 * and how long the contents are — and the second pass, now knowing both, writes
 * the document with correct folios and a contents list that points at the right
 * pages.
 */
export async function buildReport(input: ReportInput): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const fonts = await embedFaces(doc);

  // Parsed once and rendered twice. Both passes must agree on every line break,
  // so they must not re-parse and risk differing.
  const parsed = new Map<number, Token[]>();
  input.entries.forEach((entry, i) => {
    if (entry.kind !== "note") return;
    const tokens = marked.lexer(entry.markdown ?? "");
    // The heading the title was taken from would otherwise print twice.
    if (usesLeadingHeading(entry.markdown ?? "")) {
      const first = tokens.findIndex((t) => t.type !== "space");
      if (first >= 0 && tokens[first].type === "heading") tokens.splice(first, 1);
    }
    parsed.set(i, tokens);
  });

  // Embedding is the expensive half of a picture, so it happens once and both
  // passes share the result — the first pass needs the dimensions anyway.
  const images = new Map<string, PDFImage | null>();
  const embed = async (href: string): Promise<PDFImage | null> => {
    if (images.has(href)) return images.get(href)!;
    let embedded: PDFImage | null = null;
    try {
      const found = input.resolveImage ? await input.resolveImage(href) : null;
      if (found) {
        embedded =
          found.type === "png"
            ? await doc.embedPng(found.bytes)
            : await doc.embedJpg(found.bytes);
      }
    } catch {
      // A picture that will not decode is not a reason to lose the report.
      embedded = null;
    }
    images.set(href, embedded);
    return embedded;
  };

  const measured: PageIndex = new Map();
  const dry = new Sheet(doc, fonts, false, input.title);
  await renderBody(dry, input.entries, parsed, embed, measured);
  const bodyPages = dry.count;

  // One note needs no contents list; anything more does.
  const contents = input.entries.length > 1 ? layoutContents(input.entries) : [];
  const front = 1 + contents.length;
  const total = front + bodyPages;

  drawCover(doc, fonts, input, {
    sections: input.entries.filter((e) => e.kind === "folder").length,
    notes: notesOf(input.entries).length,
    pages: total,
  });
  const contentsPages = contents.map(() => doc.addPage([PAGE.w, PAGE.h]));

  const wet = new Sheet(doc, fonts, true, input.title, front, total);
  await renderBody(wet, input.entries, parsed, embed, new Map());

  drawContents(doc, fonts, contents, contentsPages, measured, front, wet.pages);

  doc.setTitle(`${input.title} — Notes Report`);
  doc.setAuthor(input.title);
  doc.setSubject(`Notes report — ${input.scope}`);
  doc.setCreator("Drive");
  doc.setProducer("Drive");
  doc.setCreationDate(new Date(input.generatedAt));
  doc.setModificationDate(new Date(input.generatedAt));

  return doc.save();
}

/* ── the body ─────────────────────────────────────────────────────────────
   One pass over the outline. Folders become headings, notes become their
   markdown, and the sheet decides where the pages fall.
   ─────────────────────────────────────────────────────────────────────── */

async function renderBody(
  sheet: Sheet,
  entries: ReportEntry[],
  parsed: Map<number, Token[]>,
  embed: (href: string) => Promise<PDFImage | null>,
  measured: PageIndex
): Promise<void> {
  const f = sheet.fonts;

  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i];

    if (entry.depth === 0) {
      // A top-level section opens a page — folder or loose note alike. It is
      // the one break a reader can rely on, and what makes the report
      // navigable on paper. It also renames the running head.
      sheet.section = entry.number ? `${entry.number} ${entry.title}` : entry.title;
      sheet.newPage();
      measured.set(i, sheet.count - 1);
      if (entry.kind === "folder") {
        // Everything under this section, up to where the next one starts.
        const until = entries.findIndex((e, j) => j > i && e.depth === 0);
        drawSectionOpener(sheet, entry, entries.slice(i + 1, until < 0 ? undefined : until));
        continue;
      }
      drawNoteHeading(sheet, entry);
    } else if (entry.kind === "folder") {
      sheet.need(78);
      measured.set(i, sheet.count - 1);
      drawSubHeading(sheet, entry);
      continue;
    } else {
      // A note heading alone at the foot of a page is the classic bad break,
      // so it is only placed where a few lines of the note can follow it.
      sheet.need(96);
      measured.set(i, sheet.count - 1);
      drawNoteHeading(sheet, entry);
    }

    const tokens = parsed.get(i) ?? [];
    const base: Style = { font: f.regular, size: BODY_SIZE, colour: INK };
    if (tokens.length) {
      await renderTokens(sheet, tokens, MARGIN.left, COLUMN, embed, base);
    } else {
      drawFlow(
        sheet,
        [{ text: "This note is empty.", style: { ...base, font: f.italic, colour: MUTED } }],
        MARGIN.left,
        COLUMN
      );
    }
    sheet.down(10);
  }
}

/**
 * The page a section opens on.
 *
 * It used to be a number, a title and a rule on an otherwise empty sheet,
 * which spent a whole page saying what the running head says on every page
 * after it. It now says what is in the section: the notes it holds, in the
 * order they are about to be read. That is the one thing a divider is for —
 * a reader arriving at section 3 wants to know whether what they are looking
 * for is in it before turning eleven more pages — and it is what makes a
 * page-per-section worth the paper.
 *
 * Without page numbers beside them, deliberately. They are known only after
 * the body has been laid out, and the layout cannot depend on a measurement
 * taken from the layout without the two passes disagreeing about where the
 * pages fall. The contents at the front carries the numbers; this carries the
 * shape.
 */
function drawSectionOpener(
  sheet: Sheet,
  entry: ReportFolderEntry,
  within: ReportEntry[]
): void {
  const f = sheet.fonts;
  // The same eyebrow the cover wears, so the top of a section and the top of
  // the report are plainly the same document rather than two designs.
  sheet.tracked("SECTION", MARGIN.left, { font: f.bold, size: 7.4, colour: ACCENT }, 7.4, 2.4);
  sheet.down(16);
  if (entry.number) {
    sheet.text(entry.number, MARGIN.left, { font: f.bold, size: 44, colour: ACCENT }, 44);
    sheet.down(54);
  }
  const lines = wrapText(toWinAnsi(entry.title), COLUMN, (t) =>
    f.bold.widthOfTextAtSize(t, 25)
  );
  for (const line of lines) {
    sheet.text(line, MARGIN.left, { font: f.bold, size: 25, colour: INK }, 25);
    sheet.down(31);
  }
  sheet.down(8);
  sheet.line(MARGIN.left, PAGE.w - MARGIN.right, sheet.y, 1.4, ACCENT);
  sheet.down(30);

  const notes = within.filter((e): e is ReportNoteEntry => e.kind === "note");
  if (!notes.length) {
    sheet.down(4);
    return;
  }

  sheet.tracked(
    notes.length === 1 ? "IN THIS SECTION" : `IN THIS SECTION  ${notes.length} NOTES`,
    MARGIN.left,
    { font: f.bold, size: 7.2, colour: MUTED },
    7.2,
    1.8
  );
  sheet.down(18);

  for (const note of notes) {
    // A section with more notes than fit on its opener says so rather than
    // running the list onto a second divider, which would be a page spent
    // listing a page.
    if (sheet.room < 40) {
      sheet.text(
        `... and more, listed in the contents`,
        MARGIN.left,
        { font: f.italic, size: 9, colour: MUTED },
        9
      );
      sheet.down(16);
      break;
    }
    const number = toWinAnsi(note.number);
    const gutter = number ? Math.max(34, f.bold.widthOfTextAtSize(number, 9.6) + 12) : 0;
    sheet.rectAt(MARGIN.left, sheet.y - 3, 2, 16, TINT);
    if (number) {
      sheet.text(
        number,
        MARGIN.left + 12,
        { font: f.bold, size: 9.6, colour: ACCENT_MID },
        9.6
      );
    }
    sheet.text(
      sheet.fit(note.title, f.regular, 10.5, COLUMN - gutter - 12),
      MARGIN.left + gutter + 12,
      { font: f.regular, size: 10.5, colour: INK },
      10.5
    );
    sheet.down(19);
  }
  sheet.down(10);
}

function drawSubHeading(sheet: Sheet, entry: ReportFolderEntry): void {
  const f = sheet.fonts;
  sheet.down(14);
  sheet.rectAt(MARGIN.left, sheet.y - 2, 30, 2.4, ACCENT);
  sheet.down(11);
  const label = `${entry.number} ${entry.title}`.trim();
  const lines = wrapText(toWinAnsi(label), COLUMN, (t) =>
    f.bold.widthOfTextAtSize(t, 13.5)
  );
  for (const line of lines) {
    sheet.text(line, MARGIN.left, { font: f.bold, size: 13.5, colour: ACCENT_DEEP }, 13.5);
    sheet.down(17);
  }
  sheet.down(5);
}

function drawNoteHeading(sheet: Sheet, entry: ReportNoteEntry): void {
  const f = sheet.fonts;
  sheet.down(12);
  // The number is set apart from the title, in its own colour and its own
  // column, so a run of notes reads down the page as a numbered list — the
  // same shape the contents page gives them — instead of as a paragraph of
  // headings each beginning with a digit.
  const number = toWinAnsi(entry.number);
  const gutter = number ? f.bold.widthOfTextAtSize(number, 12.5) + 9 : 0;
  if (number) {
    sheet.text(number, MARGIN.left, { font: f.bold, size: 12.5, colour: ACCENT }, 12.5);
  }
  const lines = wrapText(toWinAnsi(entry.title), COLUMN - gutter, (t) =>
    f.bold.widthOfTextAtSize(t, 12.5)
  );
  for (const line of lines) {
    sheet.text(line, MARGIN.left + gutter, { font: f.bold, size: 12.5, colour: INK }, 12.5);
    sheet.down(16);
  }
  // Where the section came from, so a reader can find and correct the source.
  const meta = [entry.fileName, entry.updated].filter(Boolean).join("  ·  ");
  sheet.text(
    sheet.fit(meta, f.regular, 8.2, COLUMN - gutter),
    MARGIN.left + gutter,
    { font: f.regular, size: 8.2, colour: MUTED },
    8.2
  );
  sheet.down(10);
  sheet.line(MARGIN.left, PAGE.w - MARGIN.right, sheet.y, 0.5, RULE);
  sheet.down(13);
}

/* ── markdown blocks ─────────────────────────────────────────────────────── */

const HEADING_SIZE = [14.5, 13, 12, 11, 10.5, 10.5];

async function renderTokens(
  sheet: Sheet,
  tokens: Token[],
  x: number,
  width: number,
  embed: (href: string) => Promise<PDFImage | null>,
  base: Style
): Promise<void> {
  const f = sheet.fonts;

  for (const token of tokens) {
    switch (token.type) {
      case "space":
        sheet.down(4);
        break;

      case "heading": {
        const h = token as Tokens.Heading;
        const size = HEADING_SIZE[Math.min(h.depth, 6) - 1];
        sheet.down(h.depth <= 2 ? 9 : 6);
        // A heading with nothing under it is a heading in the wrong place.
        sheet.need(size * 4);
        drawFlow(
          sheet,
          inline(
            h.tokens ?? [],
            {
              ...base,
              font: f.bold,
              size,
              // A note's own headings step down in colour as well as in size,
              // so two levels of it are told apart at a glance rather than by
              // measuring which line is bigger.
              colour: h.depth === 1 ? ACCENT_DEEP : h.depth === 2 ? ACCENT : INK,
            },
            f
          ),
          x,
          width
        );
        sheet.down(3);
        break;
      }

      case "paragraph": {
        const p = token as Tokens.Paragraph;
        // A picture on its own is a figure, not a line of prose.
        const only = onlyImage(p.tokens ?? []);
        if (only) {
          await drawFigure(sheet, only, x, width, embed, base);
          break;
        }
        drawFlow(sheet, inline(p.tokens ?? [], base, f), x, width);
        sheet.down(6);
        break;
      }

      case "text": {
        const t = token as Tokens.Text;
        drawFlow(sheet, inline(t.tokens ?? [{ type: "text", raw: t.raw, text: t.text } as Token], base, f), x, width);
        break;
      }

      case "list":
        await drawList(sheet, token as Tokens.List, x, width, embed, base);
        break;

      case "blockquote": {
        const q = token as Tokens.Blockquote;
        const top = sheet.y;
        sheet.down(4);
        await renderTokens(sheet, q.tokens ?? [], x + 16, width - 16, embed, {
          ...base,
          font: f.italic,
          colour: SAGE,
        });
        // Drawn after the contents so the bar spans exactly what it quotes;
        // a quote that broke across pages gets a bar on the last of them.
        drawQuoteBar(sheet, x + 3, top, sheet.y);
        sheet.down(4);
        break;
      }

      case "code":
        drawCode(sheet, (token as Tokens.Code).text ?? "", x, width);
        break;

      case "table":
        drawTable(sheet, token as Tokens.Table, x, width);
        break;

      case "hr":
        sheet.down(8);
        sheet.need(12);
        sheet.line(x, x + width, sheet.y, 0.5, RULE);
        sheet.down(10);
        break;

      case "html":
        // Notes are markdown; raw HTML in one is nearly always a stray tag.
        break;

      default: {
        const any = token as { text?: string };
        if (any.text) {
          drawFlow(sheet, [{ text: toWinAnsi(any.text), style: base }], x, width);
        }
      }
    }
  }
}

/** The bar beside a quotation, clipped to the page it ends on. */
function drawQuoteBar(sheet: Sheet, x: number, from: number, to: number): void {
  const top = Math.max(from, MARGIN.top);
  if (to <= top) return;
  sheet.rectAt(x, top, 2.4, to - top, SAGE_SOFT);
}

/** A paragraph that is one picture and nothing else. */
function onlyImage(tokens: Token[]): Tokens.Image | null {
  const solid = tokens.filter((t) => !(t.type === "text" && !t.raw.trim()));
  return solid.length === 1 && solid[0].type === "image"
    ? (solid[0] as Tokens.Image)
    : null;
}

async function drawFigure(
  sheet: Sheet,
  image: Tokens.Image,
  x: number,
  width: number,
  embed: (href: string) => Promise<PDFImage | null>,
  base: Style
): Promise<void> {
  const f = sheet.fonts;
  const caption = (image.text || "").trim();
  const embedded = await embed(image.href);

  sheet.down(6);

  if (!embedded) {
    // Say what is missing rather than leaving a hole the reader cannot explain.
    const where = image.href.startsWith("data:") ? "embedded picture" : image.href;
    drawFlow(
      sheet,
      [
        {
          text: toWinAnsi(`[picture not shown${caption ? `: ${caption}` : ""} — ${where}]`),
          style: { ...base, font: f.italic, size: 9, colour: MUTED },
        },
      ],
      x,
      width
    );
    sheet.down(6);
    return;
  }

  // Pictures in a note are sized in CSS pixels; a point is three quarters of
  // one, which is the conversion every browser prints at.
  let w = Math.min(width, embedded.width * 0.75);
  let h = (w * embedded.height) / embedded.width;
  const tallest = PAGE.h - MARGIN.top - MARGIN.bottom - 30;
  if (h > tallest) {
    h = tallest;
    w = (h * embedded.width) / embedded.height;
  }

  sheet.need(h + (caption ? 16 : 0) + 8);
  sheet.image(embedded, x + (width - w) / 2, w, h);
  sheet.down(h + 5);

  if (caption) {
    const style: Style = { ...base, font: f.italic, size: 8.6, colour: MUTED };
    const line = sheet.fit(caption, f.italic, 8.6, width);
    const cw = f.italic.widthOfTextAtSize(line, 8.6);
    sheet.text(line, x + (width - cw) / 2, style, 8.6);
    sheet.down(13);
  }
  sheet.down(5);
}

async function drawList(
  sheet: Sheet,
  list: Tokens.List,
  x: number,
  width: number,
  embed: (href: string) => Promise<PDFImage | null>,
  base: Style
): Promise<void> {
  const indent = 17;
  let n = Number(list.start || 1);

  sheet.down(3);
  for (const item of list.items) {
    const marker = item.task
      ? item.checked
        ? "[x]"
        : "[ ]"
      : list.ordered
        ? `${n}.`
        : "•";
    if (list.ordered) n++;

    // The marker sits on the first line of the item, so the item is measured
    // first and the marker drawn at the height the sheet settled on.
    // Reserved before the marker is drawn so the marker cannot be stranded on
    // the page above the item it belongs to.
    sheet.need(base.size * 2.4);
    // Numbers and bullets are the same piece of furniture and take the same
    // colour; the numbers used to be grey, which made a numbered list read as
    // less structured than a bulleted one when it is more.
    sheet.text(marker, x, { ...base, colour: ACCENT }, base.size);
    await renderTokens(sheet, item.tokens ?? [], x + indent, width - indent, embed, base);
  }
  sheet.down(6);
}

function drawCode(sheet: Sheet, code: string, x: number, width: number): void {
  const f = sheet.fonts;
  const size = 8.8;
  const lead = 11.4;
  const pad = 8;
  const lines = wrapCode(code.replace(/\n+$/, ""), width - pad * 2, (t) =>
    f.mono.widthOfTextAtSize(t, size)
  );

  sheet.down(6);
  let i = 0;
  while (i < lines.length) {
    sheet.need(lead + pad * 2);
    // How many of the remaining lines fit on this page; the panel is drawn to
    // match, so a long listing breaks into panels instead of overflowing.
    const fit = Math.max(1, Math.floor((sheet.room - pad * 2) / lead));
    const chunk = lines.slice(i, i + fit);
    const panel = chunk.length * lead + pad * 2;
    sheet.rect(x, width, panel, SAGE_PALE);
    // The edge down the left, in the second accent, which is what marks code
    // and quotation apart from the report's own furniture. It also shows where
    // a listing broken across pages picks up again.
    sheet.rect(x, 2.4, panel, SAGE_SOFT);
    sheet.down(pad);
    for (const line of chunk) {
      sheet.text(toWinAnsi(line), x + pad, { font: f.mono, size, colour: INK }, size + 1);
      sheet.down(lead);
    }
    sheet.down(pad);
    i += chunk.length;
    if (i < lines.length) sheet.newPage();
  }
  sheet.down(6);
}

function drawTable(sheet: Sheet, table: Tokens.Table, x: number, width: number): void {
  const f = sheet.fonts;
  const size = 9.2;
  const lead = 12.4;
  const pad = 5;

  const header = table.header.map((c) => toWinAnsi(cellText(c)));
  const rows = table.rows.map((r) => r.map((c) => toWinAnsi(cellText(c))));
  const columns = header.length;
  if (!columns) return;

  // Columns are given room in proportion to what they hold, then squeezed to
  // the measure. A table wider than the page is the one thing a printed report
  // cannot recover from.
  const natural = header.map((h, i) => {
    const widest = Math.max(
      f.bold.widthOfTextAtSize(h, size),
      ...rows.map((r) => f.regular.widthOfTextAtSize(r[i] ?? "", size))
    );
    return Math.min(widest + pad * 2, width * 0.6);
  });
  const sum = natural.reduce((a, b) => a + b, 0) || 1;
  const widths = natural.map((w) => Math.max(38, (w / sum) * width));
  const over = widths.reduce((a, b) => a + b, 0) - width;
  if (over > 0) {
    const shrinkable = widths.reduce((a, w) => a + Math.max(0, w - 38), 0) || 1;
    for (let i = 0; i < widths.length; i++) {
      widths[i] -= (Math.max(0, widths[i] - 38) / shrinkable) * over;
    }
  }

  const cells = (row: string[], font: PDFFont) =>
    row.map((c, i) =>
      wrapText(c, widths[i] - pad * 2, (t) => font.widthOfTextAtSize(t, size))
    );

  const heightOf = (lines: string[][]) =>
    Math.max(...lines.map((l) => l.length)) * lead + pad * 2;

  /**
   * A row, in one of the three roles a row can have.
   *
   * The grid of rules this used to draw — a line under every row and down
   * every column — is the spreadsheet's way of telling cells apart, and it
   * costs a printed table more than it gives: forty hairlines compete with the
   * numbers they are supposed to be separating. Colour does the same work more
   * quietly. The header is a solid accent band with the names reversed out of
   * it, so it reads as a header from across a desk and repeats legibly when
   * the table runs on; the body alternates plain paper with the palest tint in
   * the ramp, which is enough to carry the eye along a row of figures without
   * drawing a single line; and the columns are left to the white space between
   * them, which is what separates columns in a book.
   */
  const drawRow = (lines: string[][], font: PDFFont, role: "head" | "odd" | "even") => {
    const height = heightOf(lines);
    sheet.need(height);
    if (role === "head") sheet.rect(x, width, height, ACCENT);
    else if (role === "odd") sheet.rect(x, width, height, TINT_PALE);
    const colour = role === "head" ? WHITE : INK;
    let cx = x;
    lines.forEach((cellLines, i) => {
      let cy = sheet.y + pad;
      for (const line of cellLines) {
        sheet.textAt(line, cx + pad, cy, { font, size, colour }, size + 1);
        cy += lead;
      }
      cx += widths[i];
    });
    sheet.down(height);
  };

  sheet.down(8);
  const head = cells(header, f.bold);
  sheet.need(heightOf(head) * 2);
  drawRow(head, f.bold, "head");
  let striped = false;
  for (const row of rows) {
    const lines = cells(row, f.regular);
    // A table that runs on repeats its header, or the columns lose their names.
    if (sheet.room < heightOf(lines)) {
      sheet.newPage();
      drawRow(head, f.bold, "head");
      striped = false;
    }
    drawRow(lines, f.regular, striped ? "odd" : "even");
    striped = !striped;
  }
  // One rule, under the whole table, to say where it ends.
  sheet.line(x, x + width, sheet.y, 1, ACCENT_SOFT);
  sheet.down(9);
}

function cellText(cell: Tokens.TableCell): string {
  return (cell.text ?? "").replace(/\s+/g, " ").trim();
}

/* ── inline text ─────────────────────────────────────────────────────────── */

function bolder(font: PDFFont, f: Fonts): PDFFont {
  if (font === f.italic || font === f.boldItalic) return f.boldItalic;
  if (font === f.mono || font === f.monoBold) return f.monoBold;
  return f.bold;
}

function italicer(font: PDFFont, f: Fonts): PDFFont {
  if (font === f.bold || font === f.boldItalic) return f.boldItalic;
  if (font === f.mono || font === f.monoBold) return f.mono;
  return f.italic;
}

/** Flatten a run of inline markdown into styled fragments. */
function inline(tokens: Token[], style: Style, f: Fonts, out: Atom[] = []): Atom[] {
  for (const token of tokens) {
    const nested = (token as { tokens?: Token[] }).tokens;
    switch (token.type) {
      case "strong":
        inline(nested ?? [], { ...style, font: bolder(style.font, f) }, f, out);
        break;
      case "em":
        inline(nested ?? [], { ...style, font: italicer(style.font, f) }, f, out);
        break;
      case "del":
        inline(nested ?? [], { ...style, colour: MUTED }, f, out);
        break;
      case "codespan":
        out.push({
          text: toWinAnsi((token as Tokens.Codespan).text ?? ""),
          style: { ...style, font: f.mono, size: style.size * 0.92, colour: SAGE },
        });
        break;
      case "link": {
        const link = token as Tokens.Link;
        // Only addresses a reader can actually follow become clickable; a link
        // into the drive means nothing once the PDF has left it.
        const external = /^https?:\/\//i.test(link.href ?? "");
        const inner = nested?.length
          ? nested
          : ([{ type: "text", raw: link.text, text: link.text }] as unknown as Token[]);
        inline(
          inner,
          { ...style, colour: ACCENT, link: external ? link.href : undefined },
          f,
          out
        );
        break;
      }
      case "image": {
        const img = token as Tokens.Image;
        out.push({
          text: toWinAnsi(`[${img.text || "picture"}]`),
          style: { ...style, font: italicer(style.font, f), colour: MUTED },
        });
        break;
      }
      case "br":
        out.push({ text: "\n", style });
        break;
      case "html":
        break;
      default: {
        if (nested?.length) {
          inline(nested, style, f, out);
          break;
        }
        const text = (token as { text?: string }).text ?? "";
        if (text) out.push({ text: toWinAnsi(text), style });
      }
    }
  }
  return out;
}

/**
 * Break styled fragments into lines that fit the measure.
 *
 * Words carry their own style, so bold in the middle of a sentence is measured
 * as bold — which is the whole reason this cannot be `wrapText`.
 */
function flowLines(atoms: Atom[], width: number): Atom[][] {
  const lines: Atom[][] = [];
  let line: Atom[] = [];
  let used = 0;
  let pendingSpace = false;

  const push = () => {
    lines.push(line);
    line = [];
    used = 0;
    pendingSpace = false;
  };

  for (const atom of atoms) {
    if (atom.text === "\n") {
      push();
      continue;
    }
    const style = atom.style;
    const measure = (t: string) => style.font.widthOfTextAtSize(t, style.size);
    const spaceW = measure(" ");

    for (const part of atom.text.split(/(\s+)/)) {
      if (!part) continue;
      if (/^\s+$/.test(part)) {
        if (line.length) pendingSpace = true;
        continue;
      }
      const w = measure(part);
      const gap = line.length && pendingSpace ? spaceW : 0;
      if (line.length && used + gap + w > width) push();

      if (!line.length && w > width) {
        const pieces = breakWord(part, width, measure);
        for (let i = 0; i < pieces.length - 1; i++) {
          line.push({ text: pieces[i], style });
          push();
        }
        const last = pieces[pieces.length - 1];
        line.push({ text: last, style });
        used = measure(last);
        continue;
      }

      if (line.length && pendingSpace) {
        line.push({ text: " ", style });
        used += spaceW;
      }
      line.push({ text: part, style });
      used += w;
      pendingSpace = false;
    }
  }
  if (line.length) lines.push(line);
  return lines;
}

/** Lay out inline text and draw it, breaking pages between lines. */
function drawFlow(sheet: Sheet, atoms: Atom[], x: number, width: number): void {
  for (const line of flowLines(atoms, width)) {
    const size = Math.max(BODY_SIZE, ...line.map((a) => a.style.size));
    const lead = (size * BODY_LEAD) / BODY_SIZE;
    sheet.need(lead);
    let cx = x;
    for (const atom of line) {
      sheet.text(atom.text, cx, atom.style, size);
      cx += atom.style.font.widthOfTextAtSize(atom.text, atom.style.size);
    }
    sheet.down(lead);
  }
}

/* ── contents ────────────────────────────────────────────────────────────── */

interface ContentsLine {
  /** Index into the outline, which is how the page number is looked up. */
  index: number;
  entry: ReportEntry;
}

const TOC_LINE = 15.6;
const TOC_TOP = MARGIN.top + 54;
const TOC_NUMBER_COLUMN = 54;

/**
 * Break the outline into contents pages.
 *
 * Its length is needed before the body can be numbered — the body starts after
 * it — and it depends only on how many entries there are, never on the page
 * numbers themselves, which is what keeps that from being circular.
 */
function layoutContents(entries: ReportEntry[]): ContentsLine[][] {
  const limit = PAGE.h - MARGIN.bottom;
  const pages: ContentsLine[][] = [];
  let page: ContentsLine[] = [];
  let y = TOC_TOP;

  entries.forEach((entry, index) => {
    const gap = entry.kind === "folder" && entry.depth === 0 && page.length ? 9 : 0;
    if (y + gap + TOC_LINE > limit) {
      pages.push(page);
      page = [];
      y = TOC_TOP;
    } else {
      y += gap;
    }
    page.push({ index, entry });
    y += TOC_LINE;
  });

  if (page.length || !pages.length) pages.push(page);
  return pages;
}

function drawContents(
  doc: PDFDocument,
  f: Fonts,
  groups: ContentsLine[][],
  pages: PDFPage[],
  measured: PageIndex,
  front: number,
  body: PDFPage[]
): void {
  const total = front + body.length;
  const right = PAGE.w - MARGIN.right;

  groups.forEach((lines, p) => {
    const page = pages[p];
    if (!page) return;

    page.drawText("Contents", {
      x: MARGIN.left,
      y: PAGE.h - MARGIN.top - 6,
      size: 19,
      font: f.bold,
      color: INK,
    });
    if (p > 0) {
      page.drawText("continued", {
        x: MARGIN.left + f.bold.widthOfTextAtSize("Contents", 19) + 9,
        y: PAGE.h - MARGIN.top - 6,
        size: 9,
        font: f.italic,
        color: FAINT,
      });
    }
    page.drawLine({
      start: { x: MARGIN.left, y: PAGE.h - MARGIN.top - 20 },
      end: { x: right, y: PAGE.h - MARGIN.top - 20 },
      thickness: 1.4,
      color: ACCENT,
    });

    page.drawLine({
      start: { x: MARGIN.left, y: MARGIN.bottom - 12 },
      end: { x: right, y: MARGIN.bottom - 12 },
      thickness: 0.5,
      color: RULE,
    });

    // Set exactly as the body sets it, because a reader who notices the folio
    // at all notices when it changes shape halfway through the document.
    const here = String(p + 2);
    const rest = ` of ${total}`;
    const hereW = f.bold.widthOfTextAtSize(here, 8.6);
    const restW = f.regular.widthOfTextAtSize(rest, 8);
    const fx = (PAGE.w - hereW - restW) / 2;
    page.drawText(here, {
      x: fx,
      y: MARGIN.bottom - 26,
      size: 8.6,
      font: f.bold,
      color: ACCENT,
    });
    page.drawText(rest, {
      x: fx + hereW,
      y: MARGIN.bottom - 26,
      size: 8,
      font: f.regular,
      color: FAINT,
    });

    let y = TOC_TOP;
    lines.forEach((line, i) => {
      const { entry, index } = line;
      const folder = entry.kind === "folder";
      if (folder && entry.depth === 0 && i > 0) y += 9;

      const top = folder && entry.depth === 0;
      const size = top ? 10.5 : 9.6;
      const font = folder ? f.bold : f.regular;
      // The note titles used to be set in the muted grey, which made the list
      // of things the report actually contains the faintest thing on the page.
      // They are ink now; the numbers beside them carry the accent instead, so
      // the hierarchy is in the colour of the numbering rather than in how
      // hard the titles are to read.
      const colour = folder ? (top ? INK : ACCENT_DEEP) : INK;
      const numberColour = folder ? (top ? ACCENT : ACCENT_DEEP) : ACCENT_MID;
      const indent = entry.depth * 11;
      const baseline = PAGE.h - y - size;

      // A band behind each top-level section, so the contents break into parts
      // at a glance instead of reading as one long column of titles.
      if (top) {
        page.drawRectangle({
          x: MARGIN.left - 6,
          y: baseline - 5,
          width: right - MARGIN.left + 12,
          height: size + 11,
          color: TINT,
        });
      }

      page.drawText(toWinAnsi(entry.number), {
        x: MARGIN.left + indent,
        y: baseline,
        size,
        font,
        color: numberColour,
      });

      const titleX = MARGIN.left + TOC_NUMBER_COLUMN + indent;
      const numberText = String(front + (measured.get(index) ?? 0) + 1);
      const numberW = f.regular.widthOfTextAtSize(numberText, 9.4);
      const room = right - numberW - 12 - titleX;
      const title = clip(toWinAnsi(entry.title), font, size, room);
      page.drawText(title, { x: titleX, y: baseline, size, font, color: colour });

      // Dot leaders, so the eye can carry a title across to its page number.
      const titleW = font.widthOfTextAtSize(title, size);
      const from = titleX + titleW + 5;
      const to = right - numberW - 5;
      // A banded section heading needs no leader: the band already carries the
      // eye, and dots across it only make the band look ruled.
      if (to > from && !top) {
        const dot = f.regular.widthOfTextAtSize(".", 9);
        const count = Math.floor((to - from) / (dot * 2));
        if (count > 0) {
          page.drawText(".".repeat(count).split("").join(" "), {
            x: from,
            y: baseline,
            size: 9,
            font: f.regular,
            color: RULE,
          });
        }
      }

      page.drawText(numberText, {
        x: right - numberW,
        y: baseline,
        size: 9.4,
        font: top ? f.bold : f.regular,
        color: top ? ACCENT : MUTED,
      });

      // The whole row is the link, which is how a reader expects a contents
      // list to behave on a screen.
      const target = body[measured.get(index) ?? 0];
      if (target) {
        const annot = doc.context.obj({
          Type: "Annot",
          Subtype: "Link",
          Rect: [MARGIN.left, baseline - 3, right, baseline + size + 2],
          Border: [0, 0, 0],
          Dest: [target.ref, PDFName.of("XYZ"), 0, PAGE.h, 0],
        });
        page.node.addAnnot(doc.context.register(annot));
      }

      y += TOC_LINE;
    });
  });
}

/** Truncate to a width, ending in an ellipsis. */
function clip(text: string, font: PDFFont, size: number, width: number): string {
  if (font.widthOfTextAtSize(text, size) <= width) return text;
  let cut = text.length;
  while (cut > 1 && font.widthOfTextAtSize(text.slice(0, cut) + "…", size) > width) {
    cut--;
  }
  return text.slice(0, cut).trimEnd() + "…";
}

/* ── cover ───────────────────────────────────────────────────────────────── */

/** Letterspaced small type, which PDF has no setting for. */
function tracked(
  page: PDFPage,
  text: string,
  x: number,
  y: number,
  size: number,
  font: PDFFont,
  colour: Colour,
  tracking: number
): number {
  let cx = x;
  for (const ch of toWinAnsi(text)) {
    page.drawText(ch, { x: cx, y, size, font, color: colour });
    cx += font.widthOfTextAtSize(ch, size) + tracking;
  }
  return cx - x;
}

function drawCover(
  doc: PDFDocument,
  f: Fonts,
  input: ReportInput,
  stats: { sections: number; notes: number; pages: number }
): void {
  const page = doc.addPage([PAGE.w, PAGE.h]);
  const right = PAGE.w - MARGIN.right;

  /**
   * The field.
   *
   * The cover used to be words on white with a hairline over them, which is
   * not a cover — it is the first page of the report with a gap above it. The
   * top of the page is a block of the drive's deepest accent now, with the
   * title reversed out of it, and the paper below carries what the report is
   * of. That division is the whole design: a reader knows before reading a
   * word that this is the front of something.
   *
   * The grid ruled faintly across it is the drawing board the rest of the app
   * is built on — the registration marks at the corners of every card come
   * from the same place — and at six per cent white it is texture rather than
   * pattern: it reads as paper under raking light, and it disappears entirely
   * on a printer that cannot hold the tone.
   */
  const fieldH = 372;
  const fieldBottom = PAGE.h - fieldH;
  page.drawRectangle({
    x: 0,
    y: fieldBottom,
    width: PAGE.w,
    height: fieldH,
    color: ACCENT_DEEP,
  });
  const pitch = 26;
  for (let gx = pitch; gx < PAGE.w; gx += pitch) {
    page.drawLine({
      start: { x: gx, y: fieldBottom },
      end: { x: gx, y: PAGE.h },
      thickness: 0.4,
      color: WHITE,
      opacity: 0.06,
    });
  }
  for (let gy = fieldBottom + pitch; gy < PAGE.h; gy += pitch) {
    page.drawLine({
      start: { x: 0, y: gy },
      end: { x: PAGE.w, y: gy },
      thickness: 0.4,
      color: WHITE,
      opacity: 0.06,
    });
  }
  // The edge the app puts on everything, here where the field meets the paper.
  page.drawRectangle({ x: 0, y: fieldBottom - 3, width: PAGE.w, height: 3, color: ACCENT });

  // The registration marks the rest of the app draws around its cards. The two
  // in the field are white, the two on the paper are accent: the same mark in
  // whichever ink the surface under it leaves room for.
  const inset = 34;
  const arm = 13;
  const corners: [number, number, number, number, boolean][] = [
    [inset, PAGE.h - inset, 1, -1, true],
    [PAGE.w - inset, PAGE.h - inset, -1, -1, true],
    [inset, inset, 1, 1, false],
    [PAGE.w - inset, inset, -1, 1, false],
  ];
  for (const [cx, cy, dx, dy, onField] of corners) {
    const ink = onField ? WHITE : ACCENT_SOFT;
    const opacity = onField ? 0.5 : 1;
    page.drawLine({
      start: { x: cx, y: cy },
      end: { x: cx + arm * dx, y: cy },
      thickness: 0.6,
      color: ink,
      opacity,
    });
    page.drawLine({
      start: { x: cx, y: cy },
      end: { x: cx, y: cy + arm * dy },
      thickness: 0.6,
      color: ink,
      opacity,
    });
  }

  // One note asked for on its own is not a report of a drive, and a cover that
  // called it one would count sections it does not have.
  const single =
    input.entries.length === 1 && input.entries[0].kind === "note"
      ? input.entries[0]
      : null;

  // Set from the foot of the field upwards, so a title that takes two lines
  // grows into the empty top of the field rather than through its bottom edge.
  const titleLines = wrapText(toWinAnsi(input.title), COLUMN, (t) =>
    f.bold.widthOfTextAtSize(t, 32)
  );
  const TITLE_LEAD = 38;
  let y =
    fieldBottom +
    58 +
    (input.subtitle ? 30 : 0) +
    (titleLines.length - 1) * TITLE_LEAD +
    48;

  tracked(page, single ? "NOTE" : "NOTES REPORT", MARGIN.left, y, 9, f.bold, ACCENT_SOFT, 2.8);
  y -= 17;
  page.drawRectangle({ x: MARGIN.left, y, width: 44, height: 2, color: WHITE, opacity: 0.85 });
  y -= 31;

  for (const line of titleLines) {
    page.drawText(line, { x: MARGIN.left, y, size: 32, font: f.bold, color: WHITE });
    y -= TITLE_LEAD;
  }

  if (input.subtitle) {
    y += TITLE_LEAD - 30;
    page.drawText(clip(toWinAnsi(input.subtitle), f.regular, 13, COLUMN), {
      x: MARGIN.left,
      y,
      size: 13,
      font: f.regular,
      color: ACCENT_SOFT,
    });
  }

  const generated =
    new Date(input.generatedAt).toISOString().replace("T", " ").slice(0, 16) + " UTC";

  // Facts are rows; counts are figures. Splitting them means the three numbers
  // a reader actually wants off a cover — how much of the drive, how many
  // notes, how long — can be read at a glance instead of out of a list.
  const rows: [string, string][] = single
    ? [
        ["Note", single.title],
        ["File", single.fileName],
        ["Folder", input.scope],
        ["Generated", generated],
      ]
    : [
        ["Scope", input.scope],
        ["Generated", generated],
      ];

  const figures: [string, string][] = single
    ? [[String(stats.pages), stats.pages === 1 ? "Page" : "Pages"]]
    : [
        [String(stats.sections), stats.sections === 1 ? "Section" : "Sections"],
        [String(stats.notes), stats.notes === 1 ? "Note" : "Notes"],
        [String(stats.pages), stats.pages === 1 ? "Page" : "Pages"],
      ];

  // Hung from the field rather than from the footer. The white below a cover
  // is the cover breathing; the white between the field and the first thing
  // under it is just a gap, and a gap that changed size with the number of
  // rows read as a mistake on every report that had a different number.
  const ROW = 26;
  const chipH = 58;
  const foot = MARGIN.bottom + 26;
  y = fieldBottom - 62;

  for (const [label, value] of rows) {
    tracked(page, label.toUpperCase(), MARGIN.left, y, 7.4, f.bold, ACCENT, 1.4);
    page.drawText(clip(toWinAnsi(value), f.regular, 11, COLUMN - 118), {
      x: MARGIN.left + 118,
      y,
      size: 11,
      font: f.regular,
      color: INK,
    });
    page.drawLine({
      start: { x: MARGIN.left, y: y - 9 },
      end: { x: right, y: y - 9 },
      thickness: 0.5,
      color: RULE,
    });
    y -= ROW;
  }

  y -= 18;
  const gap = 12;
  // Always measured against a row of three, so the single figure a one-note
  // cover has is a chip like any other rather than a banner across the page.
  const across = Math.max(figures.length, 3);
  const chip = (COLUMN - gap * (across - 1)) / across;
  figures.forEach(([figure, label], i) => {
    const cx = MARGIN.left + i * (chip + gap);
    page.drawRectangle({
      x: cx,
      y: y - chipH + 16,
      width: chip,
      height: chipH,
      color: TINT_PALE,
    });
    // The chip's own accent edge, the same two points the app draws down the
    // left of a selected row.
    page.drawRectangle({
      x: cx,
      y: y - chipH + 16,
      width: 2.4,
      height: chipH,
      color: ACCENT,
    });
    page.drawText(figure, {
      x: cx + 15,
      y: y - 12,
      size: 23,
      font: f.bold,
      color: ACCENT_DEEP,
    });
    tracked(page, label.toUpperCase(), cx + 15, y - 31, 7.2, f.regular, MUTED, 1.3);
  });

  page.drawLine({
    start: { x: MARGIN.left, y: foot + 16 },
    end: { x: right, y: foot + 16 },
    thickness: 0.5,
    color: RULE,
  });
  if (stats.sections) {
    page.drawText("Section numbers are the drive's own folder numbers.", {
      x: MARGIN.left,
      y: foot,
      size: 8.4,
      font: f.regular,
      color: FAINT,
    });
  }
  if (input.poweredBy) {
    const mark = toWinAnsi(input.poweredBy);
    const w = f.bold.widthOfTextAtSize(mark, 8.4);
    page.drawText(mark, {
      x: right - w,
      y: foot,
      size: 8.4,
      font: f.bold,
      color: ACCENT,
    });
  }
}
