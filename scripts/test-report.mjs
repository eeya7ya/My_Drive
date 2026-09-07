/**
 * Checks the report's outline and its line breaking.
 *
 * The half of lib/report.ts above the rendering marker is pure on purpose —
 * no pdf-lib, no fonts, no database — so the two things most worth checking
 * can be checked here: that a section number is never claimed twice, and that
 * text is broken to a measure rather than off the edge of the page.
 *
 * Run with `npm test`.
 */

import { readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { createRequire } from "node:module";
const ts = createRequire(import.meta.url)("typescript");

const src = readFileSync(new URL("../lib/report.ts", import.meta.url), "utf8");
const pure = src
  .slice(0, src.indexOf("/* ── rendering ──"))
  .replace(/^import[\s\S]*?;$/gm, "");

const js = ts.transpileModule(pure, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
}).outputText;

const tmp = join(tmpdir(), `report-${process.pid}.mjs`);
writeFileSync(tmp, js);
const m = await import(pathToFileURL(tmp).href);
try { rmSync(tmp); } catch { /* a leftover temp file is not a test failure */ }
const { planReport, notesOf, noteTitle, baseName, toWinAnsi, wrapText, wrapCode,
        reportFileName, usesLeadingHeading } = m;

let pass = 0, fail = 0;
const eq = (label, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  ok ? pass++ : fail++;
  console.log(`  ${ok ? "ok  " : "FAIL"} ${label}` + (ok ? "" : `\n         got  ${JSON.stringify(got)}\n         want ${JSON.stringify(want)}`));
};

/* ── the outline ─────────────────────────────────────────────────────────── */

const file = (id, name) => ({ id, name, uploadedAt: "Sep 3, 2026 at 10:12" });
const node = (id, name, number, files = [], children = []) =>
  ({ id, name, number, files, children });
const isNote = (name) => /\.(md|txt)$/i.test(name);

const tree = [
  node("f1", "Alternator", "1", [file("n1", "Acceptance.md")], [
    node("f1a", "Stator", "1.1", [file("n2", "Windings.md"), file("n3", "Checks.txt")]),
    node("f1b", "Rotor", "1.2", []),
  ]),
  node("f2", "MV Switchgear", "2", [], [
    node("f2a", "Protection", "2.1", [file("n4", "Settings.md")]),
  ]),
  node("f3", "Lightning", "3", [file("x1", "risk.xlsx")]),
];
const plan = planReport(tree, [file("n5", "Read me.md"), file("x2", "photo.png")], isNote);
const outline = plan.map((e) => `${e.number} ${e.kind === "folder" ? "[" + e.title + "]" : e.title}`);

eq("sections read in outline order", outline, [
  "1 [Alternator]",
  "1.1 [Stator]",
  "1.1.1 Windings",
  "1.1.2 Checks",
  "1.3 Acceptance",
  "2 [MV Switchgear]",
  "2.1 [Protection]",
  "2.1.1 Settings",
  "4 Read me",
]);
eq("a folder's own notes are numbered past its subfolders",
   plan.find((e) => e.title === "Acceptance").number, "1.3");
eq("no number is claimed twice",
   new Set(plan.map((e) => e.number)).size, plan.length);
eq("a folder holding no note anywhere is left out",
   outline.some((l) => l.includes("Lightning") || l.includes("Rotor")), false);
eq("a note keeps its drive folder's numbering", plan[1].number, "1.1");
eq("root notes are numbered past the last root folder",
   plan[plan.length - 1].number, "4");
eq("only notes are gathered", notesOf(plan).length, 5);
eq("depth follows the tree", plan.map((e) => e.depth), [0, 1, 2, 2, 1, 0, 1, 2, 0]);
eq("an empty drive plans nothing", planReport([], [], isNote), []);

/* ── titles ──────────────────────────────────────────────────────────────── */

eq("a note's own heading becomes its title",
   noteTitle("# Stator winding limits\n\ntext", "notes-3.md"), "Stator winding limits");
eq("emphasis in a heading is markup, not the title",
   noteTitle("# **Stator** limits", "n.md"), "Stator limits");
eq("a heading further down is not the title",
   noteTitle("intro\n\n# Later heading", "Acceptance.md"), "Acceptance");
eq("no heading falls back to the file name",
   noteTitle("just text", "Alternator Notes.md"), "Alternator Notes");
eq("a trailing-hash heading still reads", noteTitle("# Title #", "n.md"), "Title");
eq("the leading heading is only dropped when it was used",
   [usesLeadingHeading("# T\n\nx", "n.md"), usesLeadingHeading("x", "n.md")], [true, false]);
eq("baseName drops one extension", baseName("IEC 61850.8.1 notes.md"), "IEC 61850.8.1 notes");
eq("baseName leaves an extensionless name", baseName("README"), "README");

/* ── what the standard fonts can draw ────────────────────────────────────── */

eq("arrows are spelled out", toWinAnsi("A → B"), "A -> B");
eq("engineering symbols survive", toWinAnsi("R ≤ 0.5 Ω at 40 °C ±2 %"), "R <= 0.5 Ohm at 40 °C ±2 %");
eq("smart punctuation is kept as-is", toWinAnsi("“quoted” — dash…"), "“quoted” — dash…");
eq("accented Latin is kept", toWinAnsi("Nöel café"), "Nöel café");
eq("a decomposable letter is folded, not dropped", toWinAnsi("ā"), "a");
eq("an unrepresentable script becomes a question mark", toWinAnsi("مرحبا"), "?????");
eq("zero-width characters are removed", toWinAnsi("a​b﻿"), "ab");
eq("a non-breaking space becomes a space", toWinAnsi("a b"), "a b");
eq("nothing outside WinAnsi survives",
   [...toWinAnsi("→≤Ω✓ﬁ→中")].every((c) => {
     const n = c.codePointAt(0);
     return (n >= 0x20 && n <= 0x7e) || (n >= 0xa0 && n <= 0xff);
   }), true);

/* ── line breaking ───────────────────────────────────────────────────────── */

// One unit per character, so a "width" is a column count.
const chars = (s) => s.length;

eq("prose wraps at the measure",
   wrapText("the quick brown fox jumps over the lazy dog", 12, chars),
   ["the quick", "brown fox", "jumps over", "the lazy dog"]);
eq("no line exceeds the measure",
   wrapText("the quick brown fox jumps over the lazy dog", 12, chars).every((l) => l.length <= 12),
   true);
eq("a word longer than the measure is broken",
   wrapText("supercalifragilistic x", 8, chars), ["supercal", "ifragili", "stic x"]);
eq("an empty line is kept", wrapText("a\n\nb", 10, chars), ["a", "", "b"]);
eq("code keeps its indentation", wrapCode("  a = 1\n    b = 2", 40, chars), ["  a = 1", "    b = 2"]);
eq("code wraps rather than overflowing",
   wrapCode("aaaa bbbb cccc dddd", 10, chars).every((l) => l.length <= 10), true);
eq("a tab becomes four spaces", wrapCode("\tx", 40, chars), ["    x"]);
eq("an unbreakable code line is cut",
   wrapCode("aaaaaaaaaaaa", 5, chars), ["aaaaa", "aaaaa", "aa"]);

/* ── the download's name ─────────────────────────────────────────────────── */

const at = Date.parse("2026-09-06T09:30:00Z");
eq("the file name carries the drive and the date",
   reportFileName("eSpark Drive", at), "eSpark-Drive-Notes-Report-2026-09-06.pdf");
eq("punctuation is not smuggled into a file name",
   reportFileName('a/b "c"', at), "a-b-c-Notes-Report-2026-09-06.pdf");
eq("a name with nothing usable still gets one",
   reportFileName("—", at), "Drive-Notes-Report-2026-09-06.pdf");

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
