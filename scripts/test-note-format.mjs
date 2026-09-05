/**
 * Checks the note editor's formatting helpers.
 *
 * They are fiddly string surgery over a text selection, where an off-by-one
 * puts someone's caret in the middle of a word and nobody notices until they
 * are writing. They were written as pure functions precisely so this could
 * exist: no browser, no framework, no dependencies beyond the TypeScript that
 * is already here to transpile them out of the .tsx.
 *
 * Run with `npm test`.
 */

import { readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { createRequire } from "node:module";
const ts = createRequire(import.meta.url)("typescript");

const src = readFileSync(new URL("../components/NoteEditor.tsx", import.meta.url), "utf8");
// Everything above the component is pure and browser-free; transpile just that.
const pure = src.slice(0, src.indexOf("export default function NoteEditor"))
  .replace(/^"use client";/m, "")
  .replace(/^import .*$/gm, "");

const js = ts.transpileModule(pure, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
}).outputText;

const tmp = join(tmpdir(), `note-format-${process.pid}.mjs`);
writeFileSync(tmp, js);
const m = await import(pathToFileURL(tmp).href);
try { rmSync(tmp); } catch { /* a leftover temp file is not a test failure */ }
const { applyWrap, applyHeading, applyBullets, applyNumbers, applyQuote, applyLink, applyImage,
        applyAttachment, noteFileName, noteContentType, extensionOf, withExtension,
        freeFileName } = m;

let pass = 0, fail = 0;
const eq = (label, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  ok ? pass++ : fail++;
  console.log(`  ${ok ? "ok  " : "FAIL"} ${label}` + (ok ? "" : `\n         got  ${JSON.stringify(got)}\n         want ${JSON.stringify(want)}`));
};

let r = applyWrap("hello world", 6, 11, "**", "bold text");
eq("bold wraps", r.text, "hello **world**");
eq("bold keeps the word selected", [r.start, r.end], [8, 13]);
eq("bold unwraps from inside", applyWrap(r.text, 8, 13, "**", "x").text, "hello world");
eq("bold unwraps from outside", applyWrap("hello **world**", 6, 15, "**", "x").text, "hello world");
eq("bold with no selection inserts a placeholder", applyWrap("", 0, 0, "**", "bold text").text, "**bold text**");

eq("h1 applies", applyHeading("Title", 0, 0, 1).text, "# Title");
eq("h1 toggles off", applyHeading("# Title", 0, 0, 1).text, "Title");
eq("h2 replaces h1", applyHeading("# Title", 0, 0, 2).text, "## Title");
eq("h1 replaces h2", applyHeading("## Title", 0, 0, 1).text, "# Title");

const three = "one\ntwo\nthree";
eq("bullets every selected line", applyBullets(three, 0, three.length).text, "- one\n- two\n- three");
eq("bullets toggle off", applyBullets("- one\n- two", 0, 11).text, "one\ntwo");
eq("numbers count up", applyNumbers(three, 0, three.length).text, "1. one\n2. two\n3. three");
eq("quote applies", applyQuote("a\nb", 0, 3).text, "> a\n> b");
eq("caret alone formats its own line", applyBullets("alpha\nbeta", 7, 7).text, "alpha\n- beta");
eq("caret alone leaves the other line", applyBullets("alpha\nbeta", 2, 2).text, "- alpha\nbeta");

r = applyLink("see docs here", 4, 8);
eq("link keeps the label", r.text, "see [docs](url) here");
eq("link puts the caret on url", r.text.slice(r.start, r.end), "url");

// An image is a block, and an edit must be able to round-trip a name unchanged.
eq("image opens its own block", applyImage("text here", 9, 9, "shot", "/api/files/x/view").text,
   "text here\n\n![shot](/api/files/x/view)\n");
eq("image on an empty note adds no leading blank", applyImage("", 0, 0, "shot", "/u").text,
   "![shot](/u)\n");
eq("image gets a blank line above, not just a newline", applyImage("a\nb", 2, 2, "s", "/u").text,
   "a\n\n![s](/u)\n\nb");
eq("image after a blank line adds no more", applyImage("a\n\n", 3, 3, "s", "/u").text,
   "a\n\n![s](/u)\n");
eq("caret lands after the image", (() => { const r = applyImage("", 0, 0, "s", "/u"); return r.start === r.text.length; })(), true);

// Two screenshots off a clipboard are both called image.png; a repeated name in
// one folder is a revision, which would bury the first under the second.
eq("a free name is left alone", freeFileName("image.png", ["other.png"]), "image.png");
eq("a taken name steps aside", freeFileName("image.png", ["image.png"]), "image-2.png");
eq("it keeps stepping", freeFileName("image.png", ["image.png", "image-2.png"]), "image-3.png");
eq("a name with no extension still works", freeFileName("scan", ["scan"]), "scan-2");
eq("only the last dot is the extension", freeFileName("v1.2.png", ["v1.2.png"]), "v1.2-2.png");

eq("a non-image attaches as an inline link", applyAttachment("see ", 4, 4, "spec.pdf", "/u").text,
   "see [spec.pdf](/u)");

// The format is a choice, so an unextended name takes whichever one is chosen.
eq("plain name gets .md", noteFileName("Meeting"), "Meeting.md");
eq("plain name takes the chosen format", noteFileName("Meeting", "txt"), "Meeting.txt");
eq("a typed extension beats the chosen format", noteFileName("Meeting.csv", "txt"), "Meeting.csv");
eq("an empty name is dated in the chosen format", noteFileName("", "txt").endsWith(".txt"), true);
eq("extensionOf reads the tail", extensionOf("Alternator Notes.md"), "md");
eq("extensionOf on a bare name", extensionOf("Alternator Notes"), "");
eq("extensionOf ignores a leading dot", extensionOf(".env"), "");
eq("withExtension swaps it", withExtension("Notes.md", "txt"), "Notes.txt");
eq("withExtension adds one when absent", withExtension("Notes", "txt"), "Notes.txt");
eq("markdown keeps its type", noteContentType("a.md"), "text/markdown; charset=utf-8");
eq("csv gets its own type", noteContentType("a.csv"), "text/csv; charset=utf-8");
eq("an unknown extension falls back to plain text", noteContentType("a.bib"), "text/plain; charset=utf-8");
eq("a dotfile keeps its own name", noteFileName(".env"), ".env");
eq("a dotfile with an extension is untouched", noteFileName(".env.local"), ".env.local");
eq("an existing note round-trips unchanged", noteFileName("Alternator Notes.md"), "Alternator Notes.md");
eq("interior dot is not an extension", noteFileName("IEC 61850.8.1 notes"), "IEC 61850.8.1 notes.md");
eq("a real extension is kept", noteFileName("readme.txt"), "readme.txt");
eq("trailing dot is trimmed", noteFileName("draft."), "draft.md");
eq("slashes cannot make a path", noteFileName("a/b"), "a-b.md");

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
