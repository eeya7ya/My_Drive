/**
 * The minutes table: saving, listing, reopening and deleting what /MOM writes.
 *
 * Server side only — it holds the D1 calls, which is why it is separate from
 * lib/mom.ts, the pure document module that the browser also imports.
 *
 * Every function here takes a document that has already been through
 * `normalise`, so nothing below re-checks a field's type or length. What it
 * does add are the two limits that only make sense with the whole table in
 * view rather than one document: how often one caller may write, and how many
 * minutes may exist at all. /MOM has no sign-in — the address is the only
 * thing between the internet and this table — so without them a single script
 * could fill the database, and that would break the drive the table shares.
 *
 * The throttle is per instance and the deployment is serverless, so a second
 * instance counts from zero: it is a speed bump, in the same spirit as
 * lib/guard.ts and with the same honest limit. The row cap is not — it is a
 * count, and it holds wherever it is asked.
 */

import { d1Execute, d1Query } from "./d1";
import { MAX_DOCUMENT, normalise, type MomDoc, type MomSummary } from "./mom";

/** Saves one caller may make, and over how long. */
const MAX_WRITES = 40;
const WINDOW_MS = 10 * 60 * 1000;

/** Minutes the table will hold before it refuses new ones. */
const MAX_MINUTES = 2000;

/** Keep the table of callers from growing without bound. */
const MAX_TRACKED_CALLERS = 4096;

const writes = new Map<string, number[]>();

/**
 * The caller as whatever proxy sits in front of the app reports them. Every
 * one of these headers is written by an edge and forged as easily by a client,
 * so this identifies a caller only as well as lib/guard.ts does — which is to
 * say, well enough to slow down the careless and not the determined.
 */
function callerOf(req: Request): string {
  const forwarded = req.headers.get("x-forwarded-for");
  if (forwarded) {
    const first = forwarded.split(",")[0].trim();
    if (first) return first;
  }
  return req.headers.get("cf-connecting-ip") ?? req.headers.get("x-real-ip") ?? "unknown";
}

function recent(id: string, now: number): number[] {
  const times = (writes.get(id) ?? []).filter((at) => now - at < WINDOW_MS);
  if (times.length) writes.set(id, times);
  else writes.delete(id);
  return times;
}

/**
 * Count this caller's save, and throw once they have had too many. Called
 * before the write rather than after, so the write is the thing being rationed
 * and not merely reported on.
 */
export function noteWrite(req: Request): void {
  const id = callerOf(req);
  const now = Date.now();
  if (writes.size > MAX_TRACKED_CALLERS) {
    for (const other of [...writes.keys()]) recent(other, now);
  }
  const times = recent(id, now);
  if (times.length >= MAX_WRITES) {
    const err = new Error("That is a lot of saving at once. Wait a few minutes and try again.");
    (err as Error & { status?: number }).status = 429;
    throw err;
  }
  writes.set(id, [...times, now]);
}

function tooLarge(): never {
  const err = new Error("This minute is too large to save. Shorten it, or use a smaller client logo.");
  (err as Error & { status?: number }).status = 413;
  throw err;
}

/**
 * The document as it goes into the row, with the size ceiling applied.
 *
 * A backstop rather than the main defence. The real bound is lib/mom.ts, whose
 * per-field limits cap a normalised document near 700KB — comfortably under
 * MAX_DOCUMENT — so a save that came through the route handlers can never trip
 * this. It is here for the caller that reaches these functions without going
 * through `normalise` first, which is a mistake worth catching at the row
 * rather than discovering as a D1 error about a value being too large.
 */
function serialise(doc: MomDoc): string {
  const json = JSON.stringify(doc);
  if (json.length > MAX_DOCUMENT) tooLarge();
  return json;
}

interface SummaryRow {
  id: string;
  reference: string;
  title: string;
  client: string;
  project: string;
  meeting_date: string;
  created_at: number;
  modified_at: number;
}

function toSummary(row: SummaryRow): MomSummary {
  return {
    id: row.id,
    reference: row.reference,
    title: row.title,
    client: row.client,
    project: row.project,
    meetingDate: row.meeting_date,
    createdAt: Number(row.created_at),
    modifiedAt: Number(row.modified_at),
  };
}

/** Every saved minute, most recently worked on first. Never reads a document. */
export async function listMinutes(limit = 200): Promise<MomSummary[]> {
  const rows = await d1Query<SummaryRow>(
    `SELECT id, reference, title, client, project, meeting_date, created_at, modified_at
       FROM minutes
      ORDER BY modified_at DESC
      LIMIT ?`,
    [Math.min(Math.max(limit, 1), 500)]
  );
  return rows.map(toSummary);
}

/** One minute, whole, or null if there is no such row. */
export async function getMinute(id: string): Promise<{ id: string; doc: MomDoc; createdAt: number; modifiedAt: number } | null> {
  const rows = await d1Query<{ id: string; document: string; created_at: number; modified_at: number }>(
    `SELECT id, document, created_at, modified_at FROM minutes WHERE id = ? LIMIT 1`,
    [id]
  );
  const row = rows[0];
  if (!row) return null;

  // The stored JSON goes back through normalise on the way out as well as in.
  // A row written by an older version of the document — or by hand — must not
  // be able to hand the browser a shape it does not expect.
  let parsed: unknown = null;
  try {
    parsed = JSON.parse(row.document);
  } catch {
    parsed = null;
  }

  return {
    id: row.id,
    doc: normalise(parsed),
    createdAt: Number(row.created_at),
    modifiedAt: Number(row.modified_at),
  };
}

/** Save a new minute and return its summary. */
export async function createMinute(doc: MomDoc): Promise<MomSummary> {
  const [{ n }] = await d1Query<{ n: number }>(`SELECT COUNT(*) AS n FROM minutes`);
  if (Number(n) >= MAX_MINUTES) {
    const err = new Error("The minutes table is full. Delete some saved minutes before saving another.");
    (err as Error & { status?: number }).status = 507;
    throw err;
  }

  const id = crypto.randomUUID();
  const now = Date.now();
  const document = serialise(doc);

  await d1Execute(
    `INSERT INTO minutes
       (id, reference, title, client, project, meeting_date, document, created_at, modified_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [id, doc.reference, doc.title, doc.client, doc.project, doc.date, document, now, now]
  );

  return {
    id,
    reference: doc.reference,
    title: doc.title,
    client: doc.client,
    project: doc.project,
    meetingDate: doc.date,
    createdAt: now,
    modifiedAt: now,
  };
}

/**
 * Overwrite a saved minute. Returns null when the id names nothing, so the
 * caller can say "that minute is gone" rather than silently saving nothing —
 * which is a real case here, because anyone may delete one.
 */
export async function updateMinute(id: string, doc: MomDoc): Promise<MomSummary | null> {
  const now = Date.now();
  const document = serialise(doc);

  const changed = await d1Execute(
    `UPDATE minutes
        SET reference = ?, title = ?, client = ?, project = ?, meeting_date = ?,
            document = ?, modified_at = ?
      WHERE id = ?`,
    [doc.reference, doc.title, doc.client, doc.project, doc.date, document, now, id]
  );
  if (!changed) return null;

  const rows = await d1Query<{ created_at: number }>(
    `SELECT created_at FROM minutes WHERE id = ? LIMIT 1`,
    [id]
  );

  return {
    id,
    reference: doc.reference,
    title: doc.title,
    client: doc.client,
    project: doc.project,
    meetingDate: doc.date,
    createdAt: Number(rows[0]?.created_at ?? now),
    modifiedAt: now,
  };
}

/** Delete one. True when a row went. */
export async function deleteMinute(id: string): Promise<boolean> {
  return (await d1Execute(`DELETE FROM minutes WHERE id = ?`, [id])) > 0;
}
