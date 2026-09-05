/**
 * Access requests: the one thing on this site a stranger may write.
 *
 * That makes it the surface worth being careful about. The body is measured
 * and refused before it is parsed, the fields lib/drives.ts does not know
 * about are dropped, and the reply is the same short acknowledgement whatever
 * happened underneath — including when the drive someone named does not
 * exist, since a form that answered differently for a real key would be a way
 * to discover the drives the dashboard deliberately does not list.
 *
 * Requests are rows rather than mail, so the admin panel is the single place
 * they are read and answered.
 */

import { createRequest, getDrive, listRequests } from "@/lib/drives";
import { requireAdmin } from "@/lib/auth";
import { ok, fail, badRequest } from "@/lib/api";

export const dynamic = "force-dynamic";

/**
 * Generous next to a name, an email and a note, and far below anything worth
 * buffering. lib/drives.ts trims each field to its own limit; this is only the
 * bound on what the server agrees to hold in memory first.
 */
const MAX_BODY_BYTES = 8 * 1024;

/**
 * How many requests one caller may raise before the form stops writing them
 * down, and over how long. Set well above anything a person filling the form
 * in could reach, because what it is for is the script that would bury the
 * real requests under a few thousand rows.
 */
const MAX_REQUESTS = 5;
const WINDOW_MS = 10 * 60 * 1000;

/** Keep the table below from growing without bound as callers keep changing. */
const MAX_TRACKED_CALLERS = 4096;

/**
 * Recent posts, keyed by caller, held in this instance's memory. The
 * deployment is serverless, so this slows a flood down rather than stopping
 * one: a second instance counts from zero and a cold start forgets what this
 * one saw. The counter is a copy of the one in the unlock route because a
 * route file may export only its handlers, and a shared module for twenty
 * lines would read worse than the copy.
 */
const posts = new Map<string, number[]>();

function tooLarge(): never {
  const err = new Error("That message is longer than this form accepts.");
  (err as Error & { status?: number }).status = 413;
  throw err;
}

/** Read a JSON object, refusing an oversized body before parsing costs anything. */
async function readSmallJson(req: Request): Promise<Record<string, unknown>> {
  const declared = Number(req.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > MAX_BODY_BYTES) tooLarge();

  // A chunked request declares no length, so the text is measured as well —
  // in characters rather than bytes, which is close enough for a cap whose
  // only job is to stop a body that was never a form submission.
  const raw = await req.text();
  if (raw.length > MAX_BODY_BYTES) tooLarge();

  let parsed: unknown = null;
  try {
    parsed = JSON.parse(raw);
  } catch {
    badRequest("Request body must be valid JSON.");
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    badRequest("Expected a JSON object.");
  }
  return parsed as Record<string, unknown>;
}

/**
 * The caller as whatever proxy sits in front of the app reports them. Each of
 * these headers is written by an edge and forged just as easily by a client,
 * so none of them is trusted on its own; they are read in turn and a caller
 * who rotates one to dodge the count is a caller who could rotate addresses
 * anyway. That is the honest limit of what a counter like this can do.
 */
function callerOf(req: Request): string {
  const forwarded = req.headers.get("x-forwarded-for");
  if (forwarded) {
    const first = forwarded.split(",")[0].trim();
    if (first) return first;
  }
  return req.headers.get("cf-connecting-ip") ?? req.headers.get("x-real-ip") ?? "unknown";
}

/** One caller's posts inside the window, with the older ones dropped. */
function recentPosts(id: string, now: number): number[] {
  const times = (posts.get(id) ?? []).filter((at) => now - at < WINDOW_MS);
  if (times.length) posts.set(id, times);
  else posts.delete(id);
  return times;
}

function outOfAllowance(id: string): boolean {
  return recentPosts(id, Date.now()).length >= MAX_REQUESTS;
}

function notePost(id: string): void {
  const now = Date.now();
  // Sweeping only once the table is already large keeps the ordinary call to a
  // single lookup; entries left behind by a caller who never returns age out
  // on the next sweep.
  if (posts.size > MAX_TRACKED_CALLERS) {
    for (const other of [...posts.keys()]) recentPosts(other, now);
  }
  posts.set(id, [...recentPosts(id, now), now]);
}

/**
 * The registry errors carry instructions meant for whoever runs the
 * deployment — which migration to run, which credentials to set — and this is
 * the one route reached without signing in, so those two are answered with
 * something that describes nothing and logged in full for the operator. A 400
 * from validation is passed through untouched, since a visitor needs to read
 * it to correct the form.
 */
function withoutInternals(err: unknown): unknown {
  const status = (err as { status?: number } | null)?.status;
  if (status !== 409 && status !== 503) return err;

  console.error("[drive] access request could not be recorded", err);
  const quiet = new Error("Requests are not being taken right now. Please try again later.");
  (quiet as Error & { status?: number }).status = 503;
  return quiet;
}

/** Everything anyone has asked for, newest first. Admin only. */
export async function GET() {
  try {
    await requireAdmin();
    return ok({ requests: await listRequests() });
  } catch (err) {
    return fail(err);
  }
}

/** Raise a request from the dashboard. Public and unauthenticated by design. */
export async function POST(req: Request) {
  try {
    // Counted before the body is read, and every attempt counts rather than
    // only the ones that become rows, since a post full of nonsense costs the
    // same to serve as a real one. A caller over the limit gets back the
    // acknowledgement every other outcome gets and no row is written: telling
    // them they had been throttled would be the one answer this route varies,
    // and the allowance is wide enough that only a script reaches it.
    const caller = callerOf(req);
    if (outOfAllowance(caller)) return ok({ ok: true });
    notePost(caller);

    const body = await readSmallJson(req);

    // A key that names nothing is recorded as no drive rather than refused, so
    // the answer a stranger gets never depends on which drives exist. The
    // request still reaches the admin, who can see from the note what it was
    // meant to be about.
    let driveKey: string | null = null;
    if (typeof body.driveKey === "string" && body.driveKey) {
      driveKey = (await getDrive(body.driveKey))?.key ?? null;
    }

    await createRequest({
      driveKey,
      name: typeof body.name === "string" ? body.name : "",
      email: typeof body.email === "string" ? body.email : "",
      note: typeof body.note === "string" ? body.note : "",
    });

    return ok({ ok: true });
  } catch (err) {
    return fail(withoutInternals(err));
  }
}
