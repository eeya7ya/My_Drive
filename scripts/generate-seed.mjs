/**
 * Emit seed.sql — the design's starting folder tree, ready to load into D1:
 *   npx wrangler d1 execute <DB> --remote --file=./seed.sql
 */

import { writeFileSync } from "node:fs";
import { stamped } from "./design-tree.mjs";

const rows = stamped();
const q = (s) => "'" + String(s).replace(/'/g, "''") + "'";

const lines = [
  "-- Yahya Khaled Drive — starting folder tree.",
  "-- Generated from the design canvas by scripts/generate-seed.mjs.",
  "-- Load after schema.sql:",
  "--   npx wrangler d1 execute <DB_NAME> --remote --file=./seed.sql",
  "",
  // Only the main drive's rows: the eSpark drive shares this database.
  "DELETE FROM folders WHERE drive = 'main';",
  "",
];

for (const r of rows) {
  const ts = Date.parse(r.modified + " 12:00:00 UTC");
  lines.push(
    `INSERT INTO folders (id, parent_id, name, code, icon, position, created_at, modified_at) VALUES (` +
      [
        q(r.id),
        r.parent_id === null ? "NULL" : q(r.parent_id),
        q(r.name),
        q(r.code),
        q(r.icon),
        r.position,
        ts,
        ts,
      ].join(", ") +
      ");"
  );
}
lines.push("");

writeFileSync("seed.sql", lines.join("\n"));
console.log(`seed.sql written — ${rows.length} folders`);
