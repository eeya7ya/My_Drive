"use client";

/**
 * The minutes-of-meeting workbench: a form on one side, the ADVEC letterhead
 * filling itself in on the other, and a button that turns the second into a
 * PDF.
 *
 * There is no PDF library here, for the same reason the note printer has none
 * (see PrintNote): every browser already contains a typesetter that paginates,
 * embeds fonts and writes real PDFs with selectable, searchable text. A
 * JavaScript writer would mean either rasterising this page into a blurry
 * picture of itself or rebuilding the whole letterhead — its rules, its fills,
 * its column widths — a second time in drawing commands, where it would
 * quietly drift from the design it is meant to be. So the sheet on the right
 * *is* the document: what the screen shows at 100% is what comes out of the
 * printer, because both are laid out from the same stylesheet, and "Save as
 * PDF" is the destination the reader picks.
 *
 * A minute lives in two places, and the difference matters. The draft is in
 * this tab, written to localStorage on every keystroke so a mis-tap does not
 * cost an hour's typing; it is private to this browser and survives a reload,
 * nothing more. Saving puts it in the database, where it can be listed and
 * reopened from any machine — and, because /MOM has no sign-in, by anyone who
 * reaches the address. The bar keeps the two apart in as many words: a minute
 * is "not saved to the database yet" until it has been.
 *
 * The client's logo rides along inside the document as a data URL. It is drawn
 * into the letterhead from the file the person picked and, until they save,
 * never leaves the browser.
 */

import React, { useCallback, useEffect, useRef, useState } from "react";
import { Icon } from "./icons";
import { momLabel, SHOW_ALL, type Attendee, type MomDoc, type MomShow, type MomSummary, type Point } from "@/lib/mom";

/* ── What a minute is ─────────────────────────────────────────────────────
   The shape itself lives in lib/mom.ts, because the route handler that saves
   it has to validate against the same definition — and does not get to trust
   this file, since /MOM is open and a save can arrive from anywhere.

   Rows carry an id rather than being keyed by their position, so that React
   keeps the field you are typing in when a row above is deleted or moved.
   Everything is a string: this is a document, and a half-typed date is a
   legitimate state to be in.
   ─────────────────────────────────────────────────────────────────────── */

type Mom = MomDoc;

/** The statuses the attendee table offers, as the printed document words them. */
const ATTENDANCE = ["Present", "Apology", "Absent", "Partial", "Online"];

/**
 * The clause that makes a minute binding, and the reason this document is
 * worth issuing at all: silence past the review period is acceptance. It is
 * left editable because the period is a contractual number, not ours to fix,
 * but it is written out by default so nobody issues a minute without it.
 */
const DEFAULT_NOTE =
  "These minutes record ADVEC's understanding of the matters discussed and the decisions taken. " +
  "They are deemed accurate and accepted by all parties unless written comments are received by the preparer " +
  "within {days} working days of the issue date stated above.";

let seq = 0;
/**
 * Ids for rows. Deliberately a counter and not crypto.randomUUID(): this runs
 * on the server for the first paint too, and a value minted there would differ
 * from the one the browser mints on hydration.
 */
function rowId(prefix: string): string {
  seq += 1;
  return `${prefix}-${seq}`;
}

function blankAttendee(company = ""): Attendee {
  return { id: rowId("att"), name: "", company, position: "", status: "Present" };
}
function blankPoint(): Point {
  return { id: rowId("pt"), subject: "", text: "" };
}

/**
 * A new minute: the shape filled in, nothing invented. Two attendee rows
 * because a meeting has at least two sides, and three discussion rows because
 * that is roughly where a real minute starts.
 */
function emptyMom(): Mom {
  return {
    reference: "",
    title: "",
    meetingNo: "",
    meetingType: "",
    project: "",
    client: "",
    date: "",
    timeFrom: "",
    timeTo: "",
    location: "",
    preparedBy: "",
    issueDate: "",
    revision: "00",
    clientLogo: null,
    attendees: [blankAttendee("ADVEC"), blankAttendee()],
    points: [blankPoint(), blankPoint(), blankPoint()],
    reviewDays: "5",
    note: DEFAULT_NOTE,
    show: { ...SHOW_ALL },
  };
}

/* ── Keeping the work ─────────────────────────────────────────────────────
   One key, one JSON blob, written as you type. A browser that refuses storage
   — private mode, a quota already spent on a large logo — must not take the
   form down with it, so every access is guarded and a failure is reported in
   the bar rather than thrown.
   ─────────────────────────────────────────────────────────────────────── */

const STORE_KEY = "advec:mom:v1";
/** The saved minute this draft is a copy of, so a reload keeps the link. */
const SAVED_KEY = "advec:mom:v1:saved";

function load(): Mom | null {
  try {
    const raw = window.localStorage.getItem(STORE_KEY);
    if (!raw) return null;
    const saved = JSON.parse(raw) as Partial<Mom>;
    // Merged over a fresh minute rather than used as-is: a blob written by an
    // earlier version of this page is missing whatever has been added since,
    // and a missing array would be a crash on the first .map().
    const base = emptyMom();
    const merged = {
      ...base,
      ...saved,
      attendees: saved.attendees?.length ? saved.attendees : base.attendees,
      points: saved.points?.length ? saved.points : base.points,
      // A draft from before the switches existed has no `show` at all, and one
      // from before a switch was added is missing that key: both must come
      // back showing the part rather than hiding it.
      show: { ...base.show, ...(saved.show ?? {}) },
    } as Mom & Record<string, unknown>;
    // The other direction: a draft written while the minute still had its
    // later sections carries fields this one no longer has, and they would
    // otherwise be carried forward invisibly on every save from here on.
    for (const key of Object.keys(merged)) if (!(key in base)) delete merged[key];
    return merged;
  } catch {
    return null;
  }
}

/* ── The logo ─────────────────────────────────────────────────────────────
   The client's mark is chosen from the machine and drawn straight into the
   letterhead. It is redrawn through a canvas first, at the size the sheet
   actually prints it: a 4MB photograph of a logo would blow the storage quota
   on the first keystroke after it was chosen, and nothing in the printed
   result is better for the extra pixels.

   Three times the printed height is the width a 300dpi print wants from a
   42px-tall mark, with a little to spare.
   ─────────────────────────────────────────────────────────────────────── */

const LOGO_MAX_W = 900;
const LOGO_MAX_H = 260;

function readLogo(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("The file could not be read."));
    reader.onload = () => {
      const src = String(reader.result ?? "");
      // SVG has no pixels to resample and loses nothing by being kept whole;
      // sending it through a canvas would only rasterise it.
      if (file.type === "image/svg+xml") {
        resolve(src);
        return;
      }
      const img = new Image();
      img.onerror = () => reject(new Error("That file is not an image the browser can draw."));
      img.onload = () => {
        const scale = Math.min(1, LOGO_MAX_W / img.width, LOGO_MAX_H / img.height);
        if (scale >= 1 && src.length < 400_000) {
          resolve(src);
          return;
        }
        const canvas = document.createElement("canvas");
        canvas.width = Math.max(1, Math.round(img.width * scale));
        canvas.height = Math.max(1, Math.round(img.height * scale));
        const ctx = canvas.getContext("2d");
        if (!ctx) {
          resolve(src);
          return;
        }
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        // PNG, not JPEG: a logo is usually flat colour on transparency, and
        // JPEG would both fill the transparency with black and ring the edges.
        resolve(canvas.toDataURL("image/png"));
      };
      img.src = src;
    };
    reader.readAsDataURL(file);
  });
}

/* ── Printing the sheet ───────────────────────────────────────────────── */

/**
 * Nothing still loading. A print() fired while the logo is decoding or the
 * letterhead's face is still swapping produces a PDF with a gap or the wrong
 * type in it, and nothing about the result says anything went wrong.
 */
async function settled(root: HTMLElement | null): Promise<void> {
  const images = Array.from(root?.querySelectorAll("img") ?? []);
  await Promise.all(
    images.map((img) =>
      img.complete
        ? Promise.resolve()
        : new Promise<void>((resolve) => {
            img.addEventListener("load", () => resolve(), { once: true });
            img.addEventListener("error", () => resolve(), { once: true });
          })
    )
  );
  try {
    await document.fonts.ready;
  } catch {
    // A browser without the font API still prints; it may just not have
    // finished swapping the face, which is not worth blocking the button on.
  }
}

/* ── Small pieces of the form ─────────────────────────────────────────── */

function Field({
  label,
  value,
  onChange,
  placeholder,
  span,
  area,
  rows,
  options,
}: {
  label: string;
  value: string;
  onChange: (next: string) => void;
  placeholder?: string;
  span?: boolean;
  area?: boolean;
  rows?: number;
  /** Present for a fixed vocabulary — attendance, action status — else free text. */
  options?: string[];
}) {
  const id = React.useId();
  return (
    <div className={span ? "mom-field mom-span" : "mom-field"}>
      <label htmlFor={id}>{label}</label>
      {options ? (
        <select id={id} className="input" value={value} onChange={(e) => onChange(e.target.value)}>
          {options.map((o) => (
            <option key={o} value={o}>
              {o}
            </option>
          ))}
        </select>
      ) : area ? (
        <textarea
          id={id}
          className="input"
          rows={rows ?? 3}
          value={value}
          placeholder={placeholder}
          onChange={(e) => onChange(e.target.value)}
        />
      ) : (
        <input
          id={id}
          className="input"
          type="text"
          value={value}
          placeholder={placeholder}
          onChange={(e) => onChange(e.target.value)}
        />
      )}
    </div>
  );
}

/** A repeating entry's header: what it is, and the controls that move it. */
function RowHead({
  label,
  index,
  count,
  onMove,
  onRemove,
}: {
  label: string;
  index: number;
  count: number;
  onMove: (from: number, to: number) => void;
  onRemove: (index: number) => void;
}) {
  return (
    <div className="mom-row-head">
      <span>{label}</span>
      <span className="mom-row-tools">
        <button
          type="button"
          className="btn btn-secondary"
          title="Move up"
          aria-label={`Move ${label} up`}
          disabled={index === 0}
          onClick={() => onMove(index, index - 1)}
        >
          <Icon name="up" size={13} />
        </button>
        <button
          type="button"
          className="btn btn-secondary"
          title="Move down"
          aria-label={`Move ${label} down`}
          disabled={index === count - 1}
          onClick={() => onMove(index, index + 1)}
        >
          <Icon name="down" size={13} />
        </button>
        <button
          type="button"
          className="btn btn-secondary"
          title="Remove"
          aria-label={`Remove ${label}`}
          onClick={() => onRemove(index)}
        >
          <Icon name="trash" size={13} />
        </button>
      </span>
    </div>
  );
}

/** One switch in the Sections panel. */
function Toggle({
  label,
  on,
  onChange,
  disabled,
  indent,
}: {
  label: string;
  on: boolean;
  onChange: (next: boolean) => void;
  /** A column switch whose whole section is off has nothing to act on. */
  disabled?: boolean;
  indent?: boolean;
}) {
  return (
    <label className={indent ? "mom-toggle mom-toggle-in" : "mom-toggle"}>
      <input
        type="checkbox"
        checked={on}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
      />
      <span>{label}</span>
    </label>
  );
}

/**
 * A collapsible block of the form, numbered to match the printed section.
 *
 * `hidden` marks a block whose section the sheet is not printing. The fields
 * stay editable on purpose — switching a section back on should bring back
 * what was typed, not an empty table — so the heading has to say plainly that
 * what is being typed is not on the page.
 */
function Group({
  n,
  title,
  children,
  open,
  hidden,
}: {
  n: string;
  title: string;
  children: React.ReactNode;
  open?: boolean;
  hidden?: boolean;
}) {
  return (
    <details className={hidden ? "mom-group is-hidden" : "mom-group"} open={open ?? true}>
      <summary>
        <span>
          {n}&nbsp;&nbsp;{title}
          {hidden ? <em className="mom-off">not printed</em> : null}
        </span>
      </summary>
      <div className="mom-group-fields">{children}</div>
    </details>
  );
}

/* ── Small pieces of the sheet ────────────────────────────────────────── */

/**
 * A value as the document prints it, or the template's bracketed prompt in the
 * lighter ink where nothing was typed. An unfilled minute therefore prints as
 * a blank form rather than as a page of gaps.
 */
function Val({
  value,
  placeholder,
  mono,
}: {
  value: string;
  placeholder: string;
  mono?: boolean;
}) {
  const filled = value.trim().length > 0;
  return (
    <div className={`mom-value${mono ? " mom-mono" : ""}${filled ? "" : " mom-ph"}`}>
      {filled ? value : placeholder}
    </div>
  );
}

/**
 * Spread the measure across whichever columns are switched on.
 *
 * The widths are weights, not percentages: hiding the Status column has to
 * give its share back to the others, or a four-column table draws itself
 * across four fifths of the page and stops. Returns undefined for a hidden
 * column, which is also what decides whether its cells are rendered at all.
 */
function widths(cols: { key: string; weight: number; on: boolean }[]): Record<string, string | undefined> {
  const total = cols.reduce((n, c) => (c.on ? n + c.weight : n), 0) || 1;
  const out: Record<string, string | undefined> = {};
  for (const c of cols) out[c.key] = c.on ? `${((c.weight / total) * 100).toFixed(2)}%` : undefined;
  return out;
}

/** The same, inside a table cell. */
function Cell({ value, placeholder }: { value: string; placeholder: string }) {
  const filled = value.trim().length > 0;
  return <span className={filled ? undefined : "mom-ph"}>{filled ? value : placeholder}</span>;
}

/** One field of the details grid. */
function Detail({
  label,
  value,
  placeholder,
  mono,
}: {
  label: string;
  value: string;
  placeholder: string;
  mono?: boolean;
}) {
  return (
    <div>
      <div className="mom-label">{label}</div>
      <Val value={value} placeholder={placeholder} mono={mono} />
    </div>
  );
}

/** "14:32" — enough to tell one save from the next within a session. */
function timeOfDay(at: number): string {
  return new Date(at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

/** When a saved minute was last written, as the picker shows it. */
function stamp(at: number): string {
  const d = new Date(at);
  const today = new Date();
  const sameDay =
    d.getDate() === today.getDate() &&
    d.getMonth() === today.getMonth() &&
    d.getFullYear() === today.getFullYear();
  return sameDay
    ? timeOfDay(at)
    : d.toLocaleDateString([], { day: "2-digit", month: "short", year: "numeric" });
}

/* ── The page ─────────────────────────────────────────────────────────── */

/**
 * The minute's relationship to its row in the database: which row, when it
 * was last written, and what was written — the snapshot is how "there are
 * unsaved changes" is answered without asking the server.
 *
 * `at: 0` means the link was restored from a reload rather than from a save
 * this session, so the time is not known and is not claimed.
 */
interface Saved {
  id: string;
  at: number;
  snapshot: string;
}

export default function MomBuilder() {
  const [mom, setMom] = useState<Mom>(emptyMom);
  const [draftError, setDraftError] = useState<string | null>(null);
  const [logoError, setLogoError] = useState<string | null>(null);
  const [saved, setSaved] = useState<Saved | null>(null);
  const [dbError, setDbError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [listOpen, setListOpen] = useState(false);
  const [list, setList] = useState<MomSummary[] | null>(null);
  const sheet = useRef<HTMLDivElement>(null);
  const logoInput = useRef<HTMLInputElement>(null);
  // Nothing is written until the saved minute has been read back, or the first
  // render would overwrite the reader's work with an empty form.
  const restored = useRef(false);

  useEffect(() => {
    const draft = load();
    if (draft) setMom(draft);
    try {
      const id = window.localStorage.getItem(SAVED_KEY);
      // No snapshot to compare against after a reload, so the minute counts as
      // changed until it is saved again. That is the safe way round: offering
      // a save that turns out to be unnecessary costs a click, and withholding
      // one that was needed costs the work.
      if (id) setSaved({ id, at: 0, snapshot: "" });
    } catch {
      // A browser that refuses storage simply starts unlinked.
    }
    restored.current = true;
  }, []);

  useEffect(() => {
    if (!restored.current) return;
    try {
      window.localStorage.setItem(STORE_KEY, JSON.stringify(mom));
      setDraftError(null);
    } catch {
      setDraftError("This browser will not keep a draft — the minute is safe until you close the tab.");
    }
  }, [mom]);

  useEffect(() => {
    if (!restored.current) return;
    try {
      if (saved) window.localStorage.setItem(SAVED_KEY, saved.id);
      else window.localStorage.removeItem(SAVED_KEY);
    } catch {
      // Same as above: the link is a convenience, not the record.
    }
  }, [saved]);

  /** Change one top-level field. */
  const set = useCallback(<K extends keyof Mom>(key: K, value: Mom[K]) => {
    setMom((prev) => ({ ...prev, [key]: value }));
  }, []);

  /** Turn one part of the sheet on or off. */
  const setShow = useCallback((key: keyof MomShow, on: boolean) => {
    setMom((prev) => ({ ...prev, show: { ...prev.show, [key]: on } }));
  }, []);

  /** Change one field of one row of one of the repeating lists. */
  const setRow = useCallback(
    <K extends "attendees" | "points">(
      key: K,
      index: number,
      patch: Partial<Mom[K][number]>
    ) => {
      setMom((prev) => {
        const rows = prev[key].slice() as Mom[K];
        rows[index] = { ...rows[index], ...patch };
        return { ...prev, [key]: rows };
      });
    },
    []
  );

  const addRow = useCallback((key: keyof Mom, row: unknown) => {
    setMom((prev) => ({ ...prev, [key]: [...(prev[key] as unknown[]), row] }));
  }, []);

  const removeRow = useCallback((key: keyof Mom, index: number) => {
    setMom((prev) => ({
      ...prev,
      [key]: (prev[key] as unknown[]).filter((_, i) => i !== index),
    }));
  }, []);

  const moveRow = useCallback((key: keyof Mom, from: number, to: number) => {
    setMom((prev) => {
      const rows = (prev[key] as unknown[]).slice();
      if (to < 0 || to >= rows.length) return prev;
      const [row] = rows.splice(from, 1);
      rows.splice(to, 0, row);
      return { ...prev, [key]: rows };
    });
  }, []);

  const pickLogo = useCallback(async (file: File | null) => {
    if (!file) return;
    setLogoError(null);
    try {
      const url = await readLogo(file);
      setMom((prev) => ({ ...prev, clientLogo: url }));
    } catch (e) {
      setLogoError(e instanceof Error ? e.message : "That image could not be used.");
    }
  }, []);

  const toPdf = useCallback(async () => {
    await settled(sheet.current);
    window.print();
  }, []);

  /* ── The database ───────────────────────────────────────────────────────
     Four calls against /api/mom. Each one reports what went wrong in the bar
     rather than throwing: the minute on screen is the work, and a failed save
     must never be allowed to take it down with it.
     ───────────────────────────────────────────────────────────────────── */

  /** Ask the server what a response meant, preferring its own words. */
  const problem = useCallback(async (res: Response, fallback: string) => {
    const body = await res.json().catch(() => null);
    return new Error(body?.error || `${fallback} (${res.status})`);
  }, []);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch("/api/mom", { cache: "no-store" });
      if (!res.ok) throw await problem(res, "Could not read the saved minutes");
      setList((await res.json()) as MomSummary[]);
      setDbError(null);
    } catch (e) {
      setList([]);
      setDbError(e instanceof Error ? e.message : "Could not read the saved minutes");
    }
  }, [problem]);

  /** Write the minute: a new row, or the row it was opened from. */
  const save = useCallback(async () => {
    setBusy(true);
    setDbError(null);
    // Taken before the request, so that edits made while it is in flight are
    // still counted as unsaved rather than being marked clean by its reply.
    const sent = JSON.stringify(mom);
    try {
      const res = await fetch(saved ? `/api/mom/${saved.id}` : "/api/mom", {
        method: saved ? "PUT" : "POST",
        headers: { "Content-Type": "application/json" },
        body: sent,
      });

      // The row was deleted — by another tab, or by somebody else, since
      // anyone may delete one here. Unlink rather than fail, so the next press
      // saves the work as a new minute instead of losing it.
      if (res.status === 404 && saved) {
        setSaved(null);
        throw new Error("That minute is no longer saved. Press Save again to store it as a new one.");
      }
      if (!res.ok) throw await problem(res, "Could not save this minute");

      const summary = (await res.json()) as MomSummary;
      setSaved({ id: summary.id, at: summary.modifiedAt, snapshot: sent });
      if (list) refresh();
    } catch (e) {
      setDbError(e instanceof Error ? e.message : "Could not save this minute");
    } finally {
      setBusy(false);
    }
  }, [mom, saved, list, refresh, problem]);

  /** Open a saved minute back into the form. */
  const openSaved = useCallback(
    async (id: string) => {
      setBusy(true);
      setDbError(null);
      try {
        const res = await fetch(`/api/mom/${id}`, { cache: "no-store" });
        if (!res.ok) throw await problem(res, "Could not open that minute");
        const found = (await res.json()) as { id: string; doc: Mom; modifiedAt: number };
        setMom(found.doc);
        // The snapshot is what was just put on screen, so a minute opened and
        // not touched does not present itself as having unsaved changes.
        setSaved({ id: found.id, at: found.modifiedAt, snapshot: JSON.stringify(found.doc) });
        setListOpen(false);
        setLogoError(null);
        if (logoInput.current) logoInput.current.value = "";
      } catch (e) {
        setDbError(e instanceof Error ? e.message : "Could not open that minute");
      } finally {
        setBusy(false);
      }
    },
    [problem]
  );

  const removeSaved = useCallback(
    async (row: MomSummary) => {
      if (!window.confirm(`Delete "${momLabel(row)}"? This cannot be undone.`)) return;
      setBusy(true);
      setDbError(null);
      try {
        const res = await fetch(`/api/mom/${row.id}`, { method: "DELETE" });
        if (!res.ok && res.status !== 404) throw await problem(res, "Could not delete that minute");
        // The minute on screen was that row: it stays, as unsaved work.
        if (saved?.id === row.id) setSaved(null);
        await refresh();
      } catch (e) {
        setDbError(e instanceof Error ? e.message : "Could not delete that minute");
      } finally {
        setBusy(false);
      }
    },
    [saved, refresh, problem]
  );

  const toggleList = useCallback(() => {
    setListOpen((open) => {
      if (!open && list === null) refresh();
      return !open;
    });
  }, [list, refresh]);

  const reset = useCallback(() => {
    if (!window.confirm("Clear this minute and start a new one? This cannot be undone.")) return;
    setMom(emptyMom());
    // Unlinked, so the next save writes a new row rather than overwriting the
    // one this form happened to be showing.
    setSaved(null);
    setLogoError(null);
    setDbError(null);
    if (logoInput.current) logoInput.current.value = "";
  }, []);

  /** Today, as the sheet writes dates, for the two buttons that fill one in. */
  const today = useCallback(() => {
    const d = new Date();
    const pad = (n: number) => String(n).padStart(2, "0");
    return `${pad(d.getDate())} / ${pad(d.getMonth() + 1)} / ${d.getFullYear()}`;
  }, []);

  const clientName = mom.client.trim();
  const note = mom.note.replace("{days}", mom.reviewDays.trim() || "5");
  const show = mom.show;

  // Sections are numbered by what is printed, not by what exists: hide the
  // attendees and the discussion points become 2, because a document that
  // jumps from 1 to 3 reads as one with a page missing.
  const numbered = [
    show.details && "details",
    show.attendees && "attendees",
    show.points && "points",
  ].filter(Boolean) as string[];
  const numberOf = (key: string) => numbered.indexOf(key) + 1;

  const attW = widths([
    { key: "n", weight: 5, on: true },
    { key: "name", weight: 29, on: true },
    { key: "company", weight: 24, on: show.attendeeCompany },
    { key: "position", weight: 25, on: show.attendeePosition },
    { key: "status", weight: 17, on: show.attendeeStatus },
  ]);
  const ptW = widths([
    { key: "n", weight: 9, on: true },
    { key: "subject", weight: 24, on: show.pointSubject },
    { key: "text", weight: 67, on: true },
  ]);

  /**
   * The meeting-details grid, as the cells that are switched on.
   *
   * Built as a list rather than written out, because the grid is two columns
   * wide and an odd number of cells would otherwise leave the last row open at
   * the right — no cell there means no border there.
   */
  const details = [
    show.title && (
      <Detail key="title" label="Meeting title" value={mom.title} placeholder="[Meeting title]" />
    ),
    show.meetingNo && (
      <Detail
        key="no"
        label="Meeting no. / type"
        value={[mom.meetingNo, mom.meetingType].filter((v) => v.trim()).join(" — ")}
        placeholder="[No.] — [Kick-off / Progress / Technical / Site]"
      />
    ),
    show.project && (
      <Detail key="project" label="Project" value={mom.project} placeholder="[Project name / package]" />
    ),
    show.client && <Detail key="client" label="Client" value={mom.client} placeholder="[Client name]" />,
    show.date && <Detail key="date" label="Date" value={mom.date} placeholder="[DD / MM / YYYY]" mono />,
    show.time && (
      <Detail
        key="time"
        label="Time (from — to)"
        value={
          mom.timeFrom.trim() || mom.timeTo.trim()
            ? `${mom.timeFrom.trim() || "—"} — ${mom.timeTo.trim() || "—"}`
            : ""
        }
        placeholder="[00:00] — [00:00]"
        mono
      />
    ),
    show.location && (
      <Detail key="location" label="Location" value={mom.location} placeholder="[Site / office / online]" />
    ),
    show.preparedBy && (
      <Detail
        key="by"
        label="Prepared by"
        value={mom.preparedBy.trim() ? `${mom.preparedBy.trim()} — ADVEC` : ""}
        placeholder="[Name] — ADVEC"
      />
    ),
    show.issueDate && (
      <Detail key="issued" label="Issue date" value={mom.issueDate} placeholder="[DD / MM / YYYY]" mono />
    ),
    show.revision && (
      <Detail
        key="rev"
        label="Revision"
        value={mom.revision.trim() ? `Rev. ${mom.revision.trim()}` : ""}
        placeholder="Rev. [00]"
        mono
      />
    ),
  ].filter(Boolean);
  const dirty = !saved || JSON.stringify(mom) !== saved.snapshot;

  /** What the bar says about where this minute stands. */
  const status = dbError
    ? dbError
    : draftError
      ? draftError
      : !saved
        ? "Not saved to the database yet."
        : dirty
          ? "Unsaved changes."
          : saved.at
            ? `Saved ${timeOfDay(saved.at)}.`
            : "Saved.";

  return (
    <div className="mom">
      <div className="mom-bar">
        <div>
          <span className="mom-bar-title">Minutes of Meeting</span>{" "}
          <span className={dbError || draftError ? "mom-bar-warn" : "mom-bar-note"}>{status}</span>
        </div>
        <div className="mom-bar-actions">
          <button type="button" className="btn btn-secondary" onClick={reset} disabled={busy}>
            <Icon name="plus" size={14} /> New minute
          </button>
          <button
            type="button"
            className={listOpen ? "btn btn-primary" : "btn btn-secondary"}
            onClick={toggleList}
            aria-expanded={listOpen}
          >
            <Icon name="list" size={14} /> Saved minutes
          </button>
          <button
            type="button"
            className="btn btn-secondary"
            onClick={save}
            disabled={busy || (!dirty && Boolean(saved))}
          >
            <Icon name="upload" size={14} /> {saved ? "Save" : "Save to database"}
          </button>
          <button type="button" className="btn btn-primary" onClick={toPdf}>
            <Icon name="download" size={14} /> Save as PDF
          </button>
        </div>
      </div>

      {listOpen ? (
        <div className="mom-saved">
          {list === null ? (
            <p className="mom-saved-empty">Reading the saved minutes…</p>
          ) : list.length === 0 ? (
            <p className="mom-saved-empty">
              Nothing saved yet. Press <strong>Save to database</strong> and the minute will be
              listed here, on any machine that opens this page.
            </p>
          ) : (
            <ul className="mom-saved-list">
              {list.map((row) => (
                <li key={row.id} className={row.id === saved?.id ? "is-open" : undefined}>
                  <div className="mom-saved-what">
                    <strong>{momLabel(row)}</strong>
                    <span>
                      {[row.client.trim(), row.project.trim(), row.meetingDate.trim()]
                        .filter(Boolean)
                        .join(" · ") || "No client or date yet"}
                    </span>
                  </div>
                  <div className="mom-saved-when">{stamp(row.modifiedAt)}</div>
                  <div className="mom-saved-tools">
                    <button
                      type="button"
                      className="btn btn-secondary"
                      onClick={() => openSaved(row.id)}
                      disabled={busy}
                    >
                      Open
                    </button>
                    <button
                      type="button"
                      className="btn btn-secondary"
                      onClick={() => removeSaved(row)}
                      disabled={busy}
                      aria-label={`Delete ${momLabel(row)}`}
                      title="Delete"
                    >
                      <Icon name="trash" size={13} />
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : null}

      <div className="mom-body">
        {/* ── The form ─────────────────────────────────────────────────── */}
        <div className="mom-form">
          <Group n="—" title="Sections" open={false}>
            <p className="mom-hint" style={{ marginTop: 0 }}>
              Untick anything this minute should not print. The fields stay here and keep what you
              typed, and the choice is saved with the minute — so it is laid out the same way
              wherever it is opened.
            </p>
            <div className="mom-toggles">
              <fieldset className="mom-toggle-set">
              <legend>Letterhead</legend>
              <Toggle
                label="Reference no."
                on={mom.show.reference}
                onChange={(v) => setShow("reference", v)}
              />

              </fieldset>

              <fieldset className="mom-toggle-set">
              <legend>Meeting details</legend>
              <Toggle
                label="The whole section"
                on={mom.show.details}
                onChange={(v) => setShow("details", v)}
              />
              {(
                [
                  ["title", "Meeting title"],
                  ["meetingNo", "Meeting no. / type"],
                  ["project", "Project"],
                  ["client", "Client"],
                  ["date", "Date"],
                  ["time", "Time (from — to)"],
                  ["location", "Location"],
                  ["preparedBy", "Prepared by"],
                  ["issueDate", "Issue date"],
                  ["revision", "Revision"],
                ] as [keyof MomShow, string][]
              ).map(([key, label]) => (
                <Toggle
                  key={key}
                  label={label}
                  indent
                  disabled={!mom.show.details}
                  on={mom.show[key]}
                  onChange={(v) => setShow(key, v)}
                />
              ))}

              </fieldset>

              <fieldset className="mom-toggle-set">
              <legend>Attendees</legend>
              <Toggle
                label="The whole section"
                on={mom.show.attendees}
                onChange={(v) => setShow("attendees", v)}
              />
              <Toggle
                label="Company column"
                indent
                disabled={!mom.show.attendees}
                on={mom.show.attendeeCompany}
                onChange={(v) => setShow("attendeeCompany", v)}
              />
              <Toggle
                label="Position column"
                indent
                disabled={!mom.show.attendees}
                on={mom.show.attendeePosition}
                onChange={(v) => setShow("attendeePosition", v)}
              />
              <Toggle
                label="Status column (Present / Apology)"
                indent
                disabled={!mom.show.attendees}
                on={mom.show.attendeeStatus}
                onChange={(v) => setShow("attendeeStatus", v)}
              />

              </fieldset>

              <fieldset className="mom-toggle-set">
              <legend>Discussion points &amp; decisions</legend>
              <Toggle
                label="The whole section"
                on={mom.show.points}
                onChange={(v) => setShow("points", v)}
              />
              <Toggle
                label="Subject column"
                indent
                disabled={!mom.show.points}
                on={mom.show.pointSubject}
                onChange={(v) => setShow("pointSubject", v)}
              />

              </fieldset>

              <fieldset className="mom-toggle-set">
              <legend>Foot of the page</legend>
              <Toggle label="The note" on={mom.show.note} onChange={(v) => setShow("note", v)} />
              </fieldset>
            </div>
          </Group>

          <Group n="1" title="Meeting details" hidden={!mom.show.details}>
            <div className="mom-grid">
              <Field
                label="Reference no."
                value={mom.reference}
                onChange={(v) => set("reference", v)}
                placeholder="ADV-MOM-001"
              />
              <Field
                label="Revision"
                value={mom.revision}
                onChange={(v) => set("revision", v)}
                placeholder="00"
              />
              <Field
                label="Meeting title"
                value={mom.title}
                onChange={(v) => set("title", v)}
                placeholder="Substation 132kV — design review"
                span
              />
              <Field
                label="Meeting no."
                value={mom.meetingNo}
                onChange={(v) => set("meetingNo", v)}
                placeholder="03"
              />
              <Field
                label="Meeting type"
                value={mom.meetingType}
                onChange={(v) => set("meetingType", v)}
                placeholder="Progress"
              />
              <Field
                label="Project"
                value={mom.project}
                onChange={(v) => set("project", v)}
                placeholder="Project name / package"
              />
              <Field
                label="Client"
                value={mom.client}
                onChange={(v) => set("client", v)}
                placeholder="Client name"
              />
              <Field
                label="Date"
                value={mom.date}
                onChange={(v) => set("date", v)}
                placeholder="17 / 09 / 2026"
              />
              <Field
                label="Location"
                value={mom.location}
                onChange={(v) => set("location", v)}
                placeholder="Site / office / online"
              />
              <Field
                label="Time from"
                value={mom.timeFrom}
                onChange={(v) => set("timeFrom", v)}
                placeholder="10:00"
              />
              <Field
                label="Time to"
                value={mom.timeTo}
                onChange={(v) => set("timeTo", v)}
                placeholder="11:30"
              />
              <Field
                label="Prepared by"
                value={mom.preparedBy}
                onChange={(v) => set("preparedBy", v)}
                placeholder="Name"
              />
              <Field
                label="Issue date"
                value={mom.issueDate}
                onChange={(v) => set("issueDate", v)}
                placeholder="17 / 09 / 2026"
              />
              <div className="mom-span">
                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={() =>
                    setMom((prev) => ({
                      ...prev,
                      date: prev.date || today(),
                      issueDate: today(),
                    }))
                  }
                >
                  Use today&rsquo;s date
                </button>
              </div>
            </div>
          </Group>

          <Group n="—" title="Client logo">
            <div className="mom-logo-pick">
              {mom.clientLogo ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={mom.clientLogo} alt="" />
              ) : null}
              <button
                type="button"
                className="btn btn-secondary"
                onClick={() => logoInput.current?.click()}
              >
                <Icon name="upload" size={14} /> {mom.clientLogo ? "Replace" : "Choose image"}
              </button>
              {mom.clientLogo ? (
                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={() => {
                    set("clientLogo", null);
                    if (logoInput.current) logoInput.current.value = "";
                  }}
                >
                  Remove
                </button>
              ) : null}
              <input
                ref={logoInput}
                type="file"
                accept="image/*"
                hidden
                onChange={(e) => pickLogo(e.target.files?.[0] ?? null)}
              />
            </div>
            <p className="mom-hint">
              PNG or SVG with a transparent background prints best. The image stays in this
              browser — it is drawn into the letterhead, never uploaded.
            </p>
            {logoError ? <p className="mom-error">{logoError}</p> : null}
          </Group>

          <Group n="2" title="Attendees" hidden={!mom.show.attendees}>
            {mom.attendees.map((row, i) => (
              <div className="mom-row" key={row.id}>
                <RowHead
                  label={`Attendee ${i + 1}`}
                  index={i}
                  count={mom.attendees.length}
                  onMove={(from, to) => moveRow("attendees", from, to)}
                  onRemove={(index) => removeRow("attendees", index)}
                />
                <div className="mom-grid">
                  <Field
                    label="Name"
                    value={row.name}
                    onChange={(v) => setRow("attendees", i, { name: v })}
                    placeholder="Full name"
                    span
                  />
                  <Field
                    label="Company"
                    value={row.company}
                    onChange={(v) => setRow("attendees", i, { company: v })}
                    placeholder="ADVEC"
                  />
                  <Field
                    label="Position"
                    value={row.position}
                    onChange={(v) => setRow("attendees", i, { position: v })}
                    placeholder="Project engineer"
                  />
                  <Field
                    label="Status"
                    value={row.status}
                    onChange={(v) => setRow("attendees", i, { status: v })}
                    options={ATTENDANCE}
                  />
                </div>
              </div>
            ))}
            <button
              type="button"
              className="btn btn-secondary btn-block"
              onClick={() => addRow("attendees", blankAttendee())}
            >
              <Icon name="plus" size={14} /> Add attendee
            </button>
          </Group>

          <Group n="3" title="Discussion points & decisions" hidden={!mom.show.points}>
            {mom.points.map((row, i) => (
              <div className="mom-row" key={row.id}>
                <RowHead
                  label={`Item ${i + 1}`}
                  index={i}
                  count={mom.points.length}
                  onMove={(from, to) => moveRow("points", from, to)}
                  onRemove={(index) => removeRow("points", index)}
                />
                <div className="mom-grid mom-grid-1">
                  <Field
                    label="Subject"
                    value={row.subject}
                    onChange={(v) => setRow("points", i, { subject: v })}
                    placeholder="Cable routing"
                  />
                  <Field
                    label="Discussion / decision"
                    value={row.text}
                    onChange={(v) => setRow("points", i, { text: v })}
                    placeholder="What was discussed, what was agreed, and by whom. One decision per item."
                    area
                    rows={4}
                  />
                </div>
              </div>
            ))}
            <button
              type="button"
              className="btn btn-secondary btn-block"
              onClick={() => addRow("points", blankPoint())}
            >
              <Icon name="plus" size={14} /> Add point
            </button>
          </Group>

          <Group n="—" title="Footer note" open={false} hidden={!mom.show.note}>
            <div className="mom-grid mom-grid-1">
              <Field
                label="Review period (working days)"
                value={mom.reviewDays}
                onChange={(v) => set("reviewDays", v)}
                placeholder="5"
              />
              <Field
                label="Note printed at the foot of the minute"
                value={mom.note}
                onChange={(v) => set("note", v)}
                area
                rows={6}
              />
            </div>
            <p className="mom-hint">
              <code>{"{days}"}</code> is replaced by the review period above.
            </p>
          </Group>
        </div>

        {/* ── The document ─────────────────────────────────────────────── */}
        <div className="mom-preview">
          <div className="mom-sheet" ref={sheet}>
            {/* Letterhead */}
            <div className="mom-head">
              <div className="mom-logos">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src="/assets/advec-logo.png" alt="ADVEC" />
                <div className="mom-logo-slot">
                  {mom.clientLogo ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={mom.clientLogo} alt={clientName || "Client"} />
                  ) : (
                    <div className="mom-logo-empty">Client logo</div>
                  )}
                </div>
              </div>
              <div className="mom-rule">
                <span>&nbsp;</span>
              </div>
              <div className="mom-titles">
                <div className="mom-doctitle">Minutes of Meeting</div>
                {show.reference ? (
                  <div className="mom-ref">
                    <div className="mom-label">Reference no.</div>
                    <Val value={mom.reference} placeholder="ADV-MOM-[000]" mono />
                  </div>
                ) : null}
              </div>
            </div>

            {/* 1 · Meeting details */}
            {show.details && details.length > 0 ? (
              <section className="mom-section">
                <h2>
                  <span>{numberOf("details")}</span>Meeting Details
                </h2>
                <div className="mom-details">
                  {details}
                  {/* Closes the grid when an odd number of cells leaves the
                      last row half empty. It draws the same borders and holds
                      the row's height with a non-breaking space. */}
                  {details.length % 2 === 1 ? <div aria-hidden="true">&nbsp;</div> : null}
                </div>
              </section>
            ) : null}

            {/* 2 · Attendees */}
            {show.attendees ? (
              <section className="mom-section">
                <h2>
                  <span>{numberOf("attendees")}</span>Attendees
                </h2>
                <table className="mom-table">
                  <thead>
                    <tr>
                      <th style={{ width: attW.n }}>#</th>
                      <th style={{ width: attW.name }}>Name</th>
                      {attW.company ? <th style={{ width: attW.company }}>Company</th> : null}
                      {attW.position ? <th style={{ width: attW.position }}>Position</th> : null}
                      {attW.status ? <th style={{ width: attW.status }}>Status</th> : null}
                    </tr>
                  </thead>
                  <tbody>
                    {mom.attendees.map((row, i) => (
                      <tr key={row.id}>
                        <td className="mom-num">{i + 1}</td>
                        <td>
                          <Cell value={row.name} placeholder="[Full name]" />
                        </td>
                        {attW.company ? (
                          <td>
                            <Cell value={row.company} placeholder="[Company]" />
                          </td>
                        ) : null}
                        {attW.position ? (
                          <td>
                            <Cell value={row.position} placeholder="[Position]" />
                          </td>
                        ) : null}
                        {attW.status ? (
                          <td>
                            <Cell value={row.status} placeholder="Present" />
                          </td>
                        ) : null}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </section>
            ) : null}

            {/* 3 · Discussion points and decisions */}
            {show.points ? (
              <section className="mom-section">
                <h2>
                  <span>{numberOf("points")}</span>Discussion Points &amp; Decisions
                </h2>
                <table className="mom-table">
                  <thead>
                    <tr>
                      <th style={{ width: ptW.n }}>Item</th>
                      {ptW.subject ? <th style={{ width: ptW.subject }}>Subject</th> : null}
                      <th style={{ width: ptW.text }}>Discussion / decision</th>
                    </tr>
                  </thead>
                  <tbody>
                    {mom.points.map((row, i) => (
                      <tr key={row.id}>
                        <td className="mom-num">{i + 1}</td>
                        {ptW.subject ? (
                          <td>
                            <Cell value={row.subject} placeholder="[Subject]" />
                          </td>
                        ) : null}
                        <td className="mom-para">
                          <Cell
                            value={row.text}
                            placeholder="[What was discussed, what was agreed, and by whom. Keep one decision per item.]"
                          />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </section>
            ) : null}

            {/* The clause the minute is issued under. */}
            {show.note ? (
              <div className="mom-note">
                <strong>Note&nbsp;·&nbsp;</strong>
                {note}
              </div>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
}
