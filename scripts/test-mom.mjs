/**
 * Checks what /MOM will accept into the database.
 *
 * lib/mom.ts is pure on purpose — no D1, no environment — because it is the
 * only thing standing between an open route and the `minutes` table. There is
 * no sign-in on /MOM, so every save is a stranger's JSON, and `normalise` is
 * what guarantees that whatever arrives becomes a document of a known shape
 * and a bounded size before a row is written.
 *
 * So the cases below are the ones that matter when nobody is authenticated:
 * that nonsense still yields a document rather than throwing, that no field or
 * list can be made arbitrarily long, and that the client's logo can only ever
 * be an image the browser already holds — never a remote address that would
 * turn every open of a minute into a request to somebody else's server.
 *
 * Run with `npm test`.
 */

import { readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { createRequire } from "node:module";
const ts = createRequire(import.meta.url)("typescript");

const src = readFileSync(new URL("../lib/mom.ts", import.meta.url), "utf8");
const js = ts.transpileModule(src, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
}).outputText;

const tmp = join(tmpdir(), `mom-${process.pid}.mjs`);
writeFileSync(tmp, js);
const m = await import(pathToFileURL(tmp).href);
try { rmSync(tmp); } catch { /* a leftover temp file is not a test failure */ }
const { normalise, momLabel, MAX_LINE, MAX_POINT, MAX_NOTE, MAX_LOGO,
        MAX_ATTENDEES, MAX_POINTS } = m;

let pass = 0, fail = 0;
const eq = (label, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  ok ? pass++ : fail++;
  console.log(`  ${ok ? "ok  " : "FAIL"} ${label}` +
    (ok ? "" : `\n         got  ${JSON.stringify(got)}\n         want ${JSON.stringify(want)}`));
};

console.log("\nnormalise — anything at all becomes a minute");
for (const junk of [null, undefined, 42, "a minute", [], true]) {
  const doc = normalise(junk);
  eq(`${JSON.stringify(junk) ?? "undefined"} yields an empty document`,
    [typeof doc.title, Array.isArray(doc.attendees), Array.isArray(doc.points), doc.clientLogo],
    ["string", true, true, null]);
}

console.log("\nnormalise — fields keep their type");
{
  const doc = normalise({ title: 12, client: null, attendees: "nope", points: { a: 1 }, reviewDays: 5 });
  eq("a number where a line belongs becomes empty", doc.title, "");
  eq("null where a line belongs becomes empty", doc.client, "");
  eq("a string where a list belongs becomes empty", doc.attendees, []);
  eq("an object where a list belongs becomes empty", doc.points, []);
  eq("a number where the review period belongs becomes empty", doc.reviewDays, "");
}

console.log("\nnormalise — nothing can be made arbitrarily long");
{
  const doc = normalise({
    title: "x".repeat(MAX_LINE * 4),
    note: "y".repeat(MAX_NOTE * 4),
    attendees: Array.from({ length: MAX_ATTENDEES + 30 }, () => ({ name: "z".repeat(MAX_LINE * 2) })),
    points: Array.from({ length: MAX_POINTS + 50 }, () => ({ text: "w".repeat(MAX_POINT * 3) })),
  });
  eq("a line is cut to the limit", doc.title.length, MAX_LINE);
  eq("the note is cut to the limit", doc.note.length, MAX_NOTE);
  eq("attendees are cut to the limit", doc.attendees.length, MAX_ATTENDEES);
  eq("points are cut to the limit", doc.points.length, MAX_POINTS);
  eq("a name inside a row is cut too", doc.attendees[0].name.length, MAX_LINE);
  eq("a point's body is cut to its own, larger limit", doc.points[0].text.length, MAX_POINT);
}

console.log("\nnormalise — rows");
{
  const doc = normalise({
    attendees: [{ name: "A" }, null, "not a row", 7, { name: "B" }],
    points: [{ subject: "S", text: "T", id: "../../etc" }, { subject: "S2" }],
  });
  eq("rows that are not objects are dropped", doc.attendees.map((a) => a.name), ["A", "B"]);
  eq("a missing field in a row becomes empty", doc.attendees[0].company, "");
  eq("ids are numbered by position, not taken from the body",
    [doc.attendees[0].id, doc.attendees[1].id, doc.points[0].id, doc.points[1].id],
    ["att-1", "att-2", "pt-1", "pt-2"]);
}

console.log("\nnormalise — the client logo is an image the browser already holds");
{
  const png = "data:image/png;base64,iVBORw0KGgo=";
  eq("a data: image is kept", normalise({ clientLogo: png }).clientLogo, png);
  eq("an svg data: image is kept",
    normalise({ clientLogo: "data:image/svg+xml;utf8,<svg/>" }).clientLogo,
    "data:image/svg+xml;utf8,<svg/>");
  eq("a remote address is refused",
    normalise({ clientLogo: "https://example.com/logo.png" }).clientLogo, null);
  eq("a protocol-relative address is refused",
    normalise({ clientLogo: "//example.com/logo.png" }).clientLogo, null);
  eq("a javascript: url is refused",
    normalise({ clientLogo: "javascript:alert(1)" }).clientLogo, null);
  eq("a data: document is refused",
    normalise({ clientLogo: "data:text/html;base64,PHNjcmlwdD4=" }).clientLogo, null);
  eq("a data: image beyond the limit is refused",
    normalise({ clientLogo: "data:image/png;base64," + "A".repeat(MAX_LOGO) }).clientLogo, null);
  eq("a non-string is refused", normalise({ clientLogo: { href: "x" } }).clientLogo, null);
}

console.log("\nnormalise — a document survives a round trip unchanged");
{
  const doc = normalise({
    reference: "ADV-MOM-014", title: "Design review", client: "INTRO Utility",
    attendees: [{ id: "att-1", name: "Yahya Khaled", company: "ADVEC", position: "Engineer", status: "Present" }],
    points: [{ id: "pt-1", subject: "Cable routing", text: "Moved to the north wall." }],
    reviewDays: "5", note: "A note.",
  });
  eq("normalising twice changes nothing", normalise(doc), doc);
}

console.log("\nmomLabel — a saved minute is always findable in the list");
eq("reference and title read together",
  momLabel({ reference: "ADV-MOM-014", title: "Design review", client: "X" }),
  "ADV-MOM-014 — Design review");
eq("a title alone is enough",
  momLabel({ reference: "", title: "Design review", client: "X" }), "Design review");
eq("the client stands in when neither is set",
  momLabel({ reference: " ", title: "", client: "INTRO Utility" }), "INTRO Utility");
eq("an empty minute is still named",
  momLabel({ reference: "", title: "", client: "" }), "Untitled minute");

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
