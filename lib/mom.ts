/**
 * What a minute of meeting *is*, and the one function that decides whether a
 * given blob counts as one.
 *
 * Deliberately pure — no database, no environment, no imports at all — because
 * both sides need it: the browser builds a document here and the route handler
 * has to be able to distrust what arrives. A module that reached for lib/d1
 * could not be imported by a client component without dragging the API token's
 * neighbourhood into the browser bundle.
 *
 * `normalise` is the contract. /MOM is an open route with no sign-in, so the
 * body of a save is a stranger's JSON: every field is coerced to the type the
 * document says it has, every string is cut to a length a minute plausibly
 * needs, and every list to a length a meeting plausibly has. What comes back
 * is a document, whatever went in — there is no path where a malformed save
 * reaches the table, and no single request can push an arbitrary amount of
 * text into a row.
 */

export interface Attendee {
  id: string;
  name: string;
  company: string;
  position: string;
  status: string;
}

export interface Point {
  id: string;
  subject: string;
  text: string;
}

/**
 * What the sheet shows, and what it leaves out.
 *
 * Not every meeting needs every part of the form. A minute with no apologies
 * does not need a Status column; one for an internal review does not need a
 * client's reference number. Rather than leave those printing as empty cells
 * and grey placeholders, each is a switch — and it belongs to the minute, not
 * to the browser, so a minute reopened on another machine is laid out the way
 * it was issued.
 *
 * Every key defaults to on, which is what makes a minute saved before this
 * existed come back showing everything it used to.
 */
export interface MomShow {
  /** The reference block on the letterhead, beside the title. */
  reference: boolean;

  /** Whole sections. */
  details: boolean;
  attendees: boolean;
  points: boolean;
  note: boolean;

  /** Fields of the meeting-details grid. */
  title: boolean;
  meetingNo: boolean;
  project: boolean;
  client: boolean;
  date: boolean;
  time: boolean;
  location: boolean;
  preparedBy: boolean;
  issueDate: boolean;
  revision: boolean;

  /** Columns of the two tables. */
  attendeeCompany: boolean;
  attendeePosition: boolean;
  attendeeStatus: boolean;
  pointSubject: boolean;
}

/**
 * Everything on. Also the key list: `normalise` walks these names, so a switch
 * added here is a switch the route handler accepts, and one that is not here
 * is not a switch at all however it arrives.
 */
export const SHOW_ALL: MomShow = {
  reference: true,
  details: true,
  attendees: true,
  points: true,
  note: true,
  title: true,
  meetingNo: true,
  project: true,
  client: true,
  date: true,
  time: true,
  location: true,
  preparedBy: true,
  issueDate: true,
  revision: true,
  attendeeCompany: true,
  attendeePosition: true,
  attendeeStatus: true,
  pointSubject: true,
};

/** The minute itself: everything the sheet prints. */
export interface MomDoc {
  reference: string;
  title: string;
  meetingNo: string;
  meetingType: string;
  project: string;
  client: string;
  date: string;
  timeFrom: string;
  timeTo: string;
  location: string;
  preparedBy: string;
  issueDate: string;
  revision: string;
  /** The client's mark as a data URL, or null. Never a remote address. */
  clientLogo: string | null;
  attendees: Attendee[];
  points: Point[];
  reviewDays: string;
  note: string;
  /** Which of the above the sheet actually prints. */
  show: MomShow;
}

/** One row of the picker: what the list shows without reading a document. */
export interface MomSummary {
  id: string;
  reference: string;
  title: string;
  client: string;
  project: string;
  meetingDate: string;
  createdAt: number;
  modifiedAt: number;
}

/* ── the limits ───────────────────────────────────────────────────────────
   Numbers rather than a general "reasonable size" check, so that what the
   route will accept is written down in one place and the browser can warn
   before a save is refused. They are generous for a minute and small for a
   database row: the worst case a single save can store is a little under a
   megabyte, and that only with a large logo and eighty long discussion points.
   ─────────────────────────────────────────────────────────────────────── */

/** Names, references, dates — anything that is one line on the sheet. */
export const MAX_LINE = 300;
/** A discussion point's body, which is the only place real prose goes. */
export const MAX_POINT = 4000;
/** The clause at the foot of the minute. */
export const MAX_NOTE = 3000;
/** The client's logo, as data-URL characters. Roughly 220KB of image. */
export const MAX_LOGO = 300_000;
export const MAX_ATTENDEES = 50;
export const MAX_POINTS = 80;
/** A whole document, serialised. Nothing normalised can exceed this by much. */
export const MAX_DOCUMENT = 900_000;

function line(value: unknown, max = MAX_LINE): string {
  return typeof value === "string" ? value.slice(0, max) : "";
}

/**
 * A data URL for an image, or null.
 *
 * Only `data:image/...` is allowed through. The sheet renders this straight
 * into an <img src>, so a remote address here would make every minute a
 * request to somebody else's server when it is opened, and a `javascript:` or
 * `data:text/html` one is worth refusing on principle even where an <img> tag
 * would not run it.
 */
function logo(value: unknown): string | null {
  if (typeof value !== "string") return null;
  if (!/^data:image\/(png|jpeg|gif|webp|svg\+xml);/i.test(value)) return null;
  if (value.length > MAX_LOGO) return null;
  return value;
}

/**
 * The switches, with anything unrecognised dropped and anything missing left
 * on. Only a literal `false` turns a part of the sheet off: a save that omits
 * the object, or sends a string where a boolean belongs, gets the whole
 * document rather than a mysteriously empty one.
 */
function show(value: unknown): MomShow {
  const raw = (typeof value === "object" && value !== null ? value : {}) as Record<string, unknown>;
  const out = {} as MomShow;
  for (const key of Object.keys(SHOW_ALL) as (keyof MomShow)[]) {
    out[key] = raw[key] === false ? false : true;
  }
  return out;
}

function rows<T>(value: unknown, max: number, each: (row: Record<string, unknown>, i: number) => T): T[] {
  if (!Array.isArray(value)) return [];
  return value
    .slice(0, max)
    .filter((row): row is Record<string, unknown> => typeof row === "object" && row !== null)
    .map(each);
}

/** Coerce anything at all into a minute. */
export function normalise(input: unknown): MomDoc {
  const raw = (typeof input === "object" && input !== null ? input : {}) as Record<string, unknown>;

  return {
    reference: line(raw.reference),
    title: line(raw.title),
    meetingNo: line(raw.meetingNo),
    meetingType: line(raw.meetingType),
    project: line(raw.project),
    client: line(raw.client),
    date: line(raw.date),
    timeFrom: line(raw.timeFrom),
    timeTo: line(raw.timeTo),
    location: line(raw.location),
    preparedBy: line(raw.preparedBy),
    issueDate: line(raw.issueDate),
    revision: line(raw.revision),
    clientLogo: logo(raw.clientLogo),
    attendees: rows(raw.attendees, MAX_ATTENDEES, (row, i) => ({
      // Ids are the browser's own bookkeeping for React's benefit. One that
      // arrived missing or duplicated would make rows swap under the cursor,
      // so position decides it and whatever was sent is ignored.
      id: `att-${i + 1}`,
      name: line(row.name),
      company: line(row.company),
      position: line(row.position),
      status: line(row.status),
    })),
    points: rows(raw.points, MAX_POINTS, (row, i) => ({
      id: `pt-${i + 1}`,
      subject: line(row.subject),
      text: line(row.text, MAX_POINT),
    })),
    reviewDays: line(raw.reviewDays, 8),
    note: line(raw.note, MAX_NOTE),
    show: show(raw.show),
  };
}

/**
 * The line the picker shows for a minute, and the fallback when it has no
 * title yet — an untitled minute still has to be findable in a list.
 */
export function momLabel(summary: { reference: string; title: string; client: string }): string {
  const parts = [summary.reference.trim(), summary.title.trim()].filter(Boolean);
  if (parts.length) return parts.join(" — ");
  return summary.client.trim() || "Untitled minute";
}
