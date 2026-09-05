"use client";

/**
 * The owner's panel: the drives that exist, and the people asking to be let
 * into one.
 *
 * It is an owner's tool, not a separate application, so it is assembled from
 * the same parts as everything else — blueprint frames with registration
 * marks, `.field` / `.input` controls, the letterspaced micro-label, the
 * accent rule under a heading. Somebody who arrives here from a drive should
 * recognise where they are.
 *
 * Two decisions shape the rest of the file. Every write sends only the fields
 * that actually changed and then calls router.refresh(), so the server render
 * stays the single copy of the truth; a panel that patched its own list would
 * drift from the database the first time a save half succeeded, and the admin
 * would have no way to tell. And the passcode is a three-way choice rather
 * than a text box, because the API has three cases — leave it, set it, clear
 * it — and a blank field that silently means "leave it" is how people lock
 * themselves out of their own drive.
 */

import React, { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Icon } from "./icons";
import { Brand, DriveVisibility, SITE, slugifyDrive } from "@/lib/brand";
import type { DriveRequest } from "@/lib/drives";

/** The design's recurring micro-label: 11px, uppercase, letterspaced, accent. */
const LABEL: React.CSSProperties = {
  fontSize: 11,
  letterSpacing: ".12em",
  textTransform: "uppercase",
  color: "var(--color-accent-700)",
};

/** The sidebar's small line under a name, at panel scale. */
const TAGLINE: React.CSSProperties = {
  fontSize: 10,
  letterSpacing: ".18em",
  textTransform: "uppercase",
  color: "var(--color-accent-700)",
};

/** The one red in the system, used for refusals and for destructive controls. */
const DANGER = "#c0492f";
/**
 * A confirm button paints DANGER over `.btn-primary`, which colours its label
 * with `--color-bg` — nearly black under the dark theme, and unreadable on the
 * red. The two go together, so both are stated here rather than at either call
 * site, and white is the one that holds in both themes because the background
 * behind it is the same red whatever the page is doing.
 */
const DANGER_TEXT = "#fff";

/**
 * A group of radios is a fieldset with a legend rather than a label, since a
 * label may only name one control. These two carry the `.field > label` look
 * across, so a choice sits in a form beside the text inputs without announcing
 * that it is built from different parts.
 */
const GROUP: React.CSSProperties = { border: "none", padding: 0, margin: 0, minWidth: 0 };
const GROUP_LABEL: React.CSSProperties = {
  padding: 0,
  fontSize: 12,
  marginBottom: 5,
  color: "color-mix(in srgb, var(--color-text) 70%, transparent)",
};

/**
 * What the panel says after a write. A confirmation and a refusal share one
 * slot deliberately: whatever happened, the answer appears in the same place,
 * so there is no state in which the admin has to guess whether a change
 * landed.
 */
type Note = { tone: "ok" | "bad"; text: string } | null;

/** A drive's editable identity in the shape the controls hold it. */
interface DriveForm {
  name: string;
  tagline: string;
  title: string;
  shortName: string;
  description: string;
  slug: string;
  numbered: boolean;
  poweredBy: string;
  listed: boolean;
  visibility: DriveVisibility;
}

/** The body of a PATCH: absent means unchanged, so every field is optional. */
interface DrivePatch {
  name?: string;
  tagline?: string;
  title?: string;
  shortName?: string;
  description?: string;
  slug?: string;
  numbered?: boolean;
  poweredBy?: string | null;
  listed?: boolean;
  visibility?: DriveVisibility;
  passcode?: string | null;
}

/** The three things an admin can mean by touching the passcode. */
type PasscodeMode = "keep" | "set" | "clear";

function formOf(brand: Brand): DriveForm {
  return {
    name: brand.name,
    tagline: brand.tagline,
    title: brand.title,
    shortName: brand.shortName,
    description: brand.description,
    slug: brand.slug,
    numbered: brand.numbered,
    poweredBy: brand.poweredBy ?? "",
    listed: brand.listed,
    visibility: brand.visibility,
  };
}

/**
 * The difference between the drive as it is and the form as it stands. Sending
 * the whole form instead would work, but it would also rewrite fields nobody
 * touched — and with two admins, or two tabs, that quietly reverts the other
 * one's edit.
 */
function patchFor(
  brand: Brand,
  form: DriveForm,
  mode: PasscodeMode,
  passcode: string
): DrivePatch {
  const patch: DrivePatch = {};

  const name = form.name.trim();
  if (name !== brand.name) patch.name = name;
  if (form.tagline !== brand.tagline) patch.tagline = form.tagline;

  const title = form.title.trim();
  if (title !== brand.title) patch.title = title;

  const shortName = form.shortName.trim();
  if (shortName !== brand.shortName) patch.shortName = shortName;

  if (form.description !== brand.description) patch.description = form.description;

  // The address is slugified here as well as on the server, so what is sent is
  // exactly the address the form has been showing underneath the field.
  const slug = slugifyDrive(form.slug.trim());
  if (slug !== brand.slug) patch.slug = slug;

  if (form.numbered !== brand.numbered) patch.numbered = form.numbered;

  const poweredBy = form.poweredBy.trim();
  if (poweredBy !== (brand.poweredBy ?? "")) patch.poweredBy = poweredBy || null;

  if (form.listed !== brand.listed) patch.listed = form.listed;
  if (form.visibility !== brand.visibility) patch.visibility = form.visibility;

  // The unlock form trims what the visitor types and the server compares the
  // hashes exactly, so a passcode saved with a space around it could never be
  // entered again. It is trimmed on the way in as well, and the two ends agree.
  if (mode === "set") patch.passcode = passcode.trim();
  if (mode === "clear") patch.passcode = null;

  return patch;
}

/**
 * Requests carry an epoch, and the server that renders this page rarely keeps
 * the admin's clock. The timestamp is therefore allowed to differ across
 * hydration rather than being frozen to UTC, which would be accurate and
 * useless to read.
 */
function when(ms: number): string {
  return new Date(ms).toLocaleString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export default function AdminPanel({
  drives,
  requests,
}: {
  drives: Brand[];
  requests: DriveRequest[];
}) {
  const router = useRouter();

  // The drive keeps its light/dark choice in component state and writes it to
  // the body, which is where every token flips. This screen is a sibling of
  // that one, so it does exactly the same thing.
  const [theme, setTheme] = useState<"light" | "dark">("light");

  const [note, setNote] = useState<Note>(null);
  // The action in flight, if any. One at a time: a panel that could run two
  // writes against the same row would refresh into a result neither of them
  // describes.
  const [busy, setBusy] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);

  useEffect(() => {
    document.body.setAttribute("data-theme", theme);
  }, [theme]);

  /**
   * One write, start to finish: lock the controls, send it, say what happened
   * in the panel's own words or in the server's, and reload the server data.
   * The boolean is for the caller that wants to close a form only when the
   * save actually landed.
   */
  const call = useCallback(
    async (id: string, url: string, init: RequestInit, done: string): Promise<boolean> => {
      setBusy(id);
      setNote(null);
      try {
        const res = await fetch(url, init);
        const body: { error?: string } = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(body?.error || "That change did not go through.");
        setNote({ tone: "ok", text: done });
        router.refresh();
        return true;
      } catch (e) {
        setNote({
          tone: "bad",
          text: e instanceof Error ? e.message : "That change did not go through.",
        });
        return false;
      } finally {
        setBusy(null);
      }
    },
    [router]
  );

  const locked = busy !== null;
  const waiting = requests.filter((r) => r.status === "new").length;

  async function signOut() {
    setBusy("sign-out");
    try {
      // Leaving for the dashboard on a logout that did not happen would look
      // like a sign-out while the admin cookie is still being carried, so the
      // navigation waits on the answer the way every other write here does.
      const res = await fetch("/api/auth/logout", { method: "POST" });
      if (!res.ok) throw new Error("Could not sign out.");
      window.location.href = "/";
    } catch {
      setBusy(null);
      setNote({ tone: "bad", text: "Could not sign out." });
    }
  }

  return (
    <div style={{ minHeight: "100vh", display: "flex", flexDirection: "column" }}>
      <header
        className="dc-header"
        style={{
          display: "flex",
          alignItems: "center",
          gap: 14,
          padding: "16px 27px",
          borderBottom: "1px solid var(--color-divider)",
          flexWrap: "wrap",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 12, marginRight: "auto" }}>
          <div
            style={{
              width: 34,
              height: 34,
              flex: "none",
              display: "grid",
              placeItems: "center",
              background: "var(--color-accent-100)",
              color: "var(--color-accent-700)",
              border: "1px solid var(--color-accent-300)",
            }}
          >
            <Icon name="shield" size={17} />
          </div>
          <div>
            <div
              style={{
                fontFamily: "var(--font-heading)",
                fontWeight: 600,
                fontSize: 19,
                lineHeight: 1.1,
                letterSpacing: ".02em",
              }}
            >
              {SITE.name}
            </div>
            <div style={TAGLINE}>Admin Panel</div>
          </div>
        </div>

        <button
          className="btn btn-secondary btn-icon"
          onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
          title="Toggle dark mode"
          aria-label="Toggle dark mode"
        >
          {theme === "dark" ? <Icon name="sun" size={15} /> : <Icon name="moon" size={15} />}
        </button>

        <a className="btn btn-secondary" href="/" title="The dashboard">
          <Icon name="hdd" size={14} />
          Dashboard
        </a>

        <button
          className="btn btn-secondary"
          onClick={signOut}
          disabled={locked}
          title="Sign out of the admin session"
        >
          <Icon name="logout" size={14} />
          Sign out
        </button>
      </header>

      <main
        className="dc-pad"
        style={{
          flex: 1,
          width: "100%",
          maxWidth: 1120,
          margin: "0 auto",
          padding: "36px 27px 64px",
        }}
      >
        <div style={{ display: "flex", flexDirection: "column", gap: 10, marginBottom: 30 }}>
          <h1 className="dc-title" style={{ margin: 0, fontSize: 42 }}>
            Drives &amp; requests
          </h1>
          <div
            style={{
              height: 2,
              width: 58,
              background: "var(--color-accent)",
              animation: "sweepIn .55s cubic-bezier(.2,.7,.3,1) both",
            }}
          />
          <p style={{ margin: 0, fontSize: 15, opacity: 0.75, maxWidth: "64ch" }}>
            A drive added here appears on the dashboard straight away — no deploy. Its key is
            fixed at creation because every folder and file row carries it; everything else,
            including the address, can be changed later.
          </p>
        </div>

        {note && (
          <div
            // A refusal has to interrupt whatever is being read; a confirmation
            // can wait for a pause, so the two tones announce differently.
            role={note.tone === "bad" ? "alert" : "status"}
            style={{
              display: "flex",
              alignItems: "flex-start",
              gap: 9,
              marginBottom: 26,
              padding: "10px 13px",
              fontSize: 13,
              border:
                note.tone === "ok"
                  ? "1px solid var(--color-accent-300)"
                  : `1px solid color-mix(in srgb, ${DANGER} 45%, transparent)`,
              background:
                note.tone === "ok"
                  ? "var(--color-accent-100)"
                  : `color-mix(in srgb, ${DANGER} 8%, transparent)`,
              color: note.tone === "ok" ? "var(--color-accent-800)" : DANGER,
            }}
          >
            <Icon name="info" size={15} style={{ flex: "none", marginTop: 2 }} />
            <span style={{ flex: 1 }}>{note.text}</span>
            <button
              onClick={() => setNote(null)}
              title="Dismiss"
              aria-label="Dismiss"
              style={{
                background: "transparent",
                border: "none",
                cursor: "pointer",
                color: "inherit",
                opacity: 0.7,
                padding: 0,
                display: "grid",
                placeItems: "center",
              }}
            >
              <Icon name="close" size={14} />
            </button>
          </div>
        )}

        <section>
          <div
            style={{
              display: "flex",
              alignItems: "baseline",
              gap: 14,
              flexWrap: "wrap",
              marginBottom: 16,
            }}
          >
            <h2
              style={{
                margin: 0,
                fontFamily: "var(--font-heading)",
                fontWeight: 600,
                fontSize: 26,
              }}
            >
              Drives
            </h2>
            <span style={LABEL}>
              {drives.length === 1 ? "One drive" : `${drives.length} drives`}
            </span>
            <div style={{ marginLeft: "auto" }}>
              <button
                className="btn btn-primary"
                onClick={() => setCreating((v) => !v)}
                disabled={locked}
              >
                <Icon name={creating ? "close" : "plus"} size={14} />
                {creating ? "Cancel" : "New drive"}
              </button>
            </div>
          </div>

          {creating && (
            <CreateDrive
              locked={locked}
              busy={busy === "create"}
              onCreate={async (body) => {
                const done = await call(
                  "create",
                  "/api/drives",
                  {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify(body),
                  },
                  `Created ${body.name}. It answers at /${body.slug}.`
                );
                if (done) setCreating(false);
                return done;
              }}
              onCancel={() => setCreating(false)}
            />
          )}

          <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            {drives.map((brand) => (
              <DriveRow
                key={brand.key}
                brand={brand}
                open={editing === brand.key}
                locked={locked}
                savingId={busy}
                onToggle={() => setEditing(editing === brand.key ? null : brand.key)}
                onSave={async (patch) => {
                  if (Object.keys(patch).length === 0) {
                    setNote({ tone: "ok", text: "Nothing to save — no field changed." });
                    return true;
                  }
                  const moved = patch.slug
                    ? ` It answers at /${patch.slug} now, and its old address still works.`
                    : "";
                  const done = await call(
                    `save:${brand.key}`,
                    `/api/drives/${encodeURIComponent(brand.key)}`,
                    {
                      method: "PATCH",
                      headers: { "Content-Type": "application/json" },
                      body: JSON.stringify(patch),
                    },
                    `Saved ${patch.name ?? brand.name}.${moved}`
                  );
                  if (done) setEditing(null);
                  return done;
                }}
                onDelete={() =>
                  call(
                    `delete:${brand.key}`,
                    `/api/drives/${encodeURIComponent(brand.key)}`,
                    { method: "DELETE" },
                    `Removed ${brand.name} from the registry.`
                  )
                }
              />
            ))}
          </div>

          {drives.length === 0 && (
            <p style={{ margin: 0, fontSize: 14, opacity: 0.75 }}>
              No drives yet. The first one takes a name and nothing else.
            </p>
          )}
        </section>

        <div className="hr" style={{ margin: "44px 0 28px" }} />

        <section>
          <div
            style={{
              display: "flex",
              alignItems: "baseline",
              gap: 14,
              flexWrap: "wrap",
              marginBottom: 10,
            }}
          >
            <h2
              style={{
                margin: 0,
                fontFamily: "var(--font-heading)",
                fontWeight: 600,
                fontSize: 26,
              }}
            >
              Requests
            </h2>
            <span style={LABEL}>
              {waiting === 0
                ? "None waiting"
                : `${waiting} waiting${requests.length > waiting ? ` of ${requests.length}` : ""}`}
            </span>
          </div>

          <p style={{ margin: "0 0 20px", fontSize: 13, opacity: 0.75, maxWidth: "68ch" }}>
            Approving is bookkeeping — it marks the request as dealt with and grants nothing on
            its own. What actually opens a private drive is its passcode, so send that to the
            person yourself.
          </p>

          {requests.length === 0 ? (
            <p style={{ margin: 0, fontSize: 14, opacity: 0.75 }}>
              Nobody has asked for access yet.
            </p>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              {requests.map((request) => (
                <RequestRow
                  key={request.id}
                  request={request}
                  locked={locked}
                  savingId={busy}
                  onStatus={(status) =>
                    call(
                      `request:${request.id}`,
                      `/api/requests/${encodeURIComponent(request.id)}`,
                      {
                        method: "PATCH",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({ status }),
                      },
                      status === "approved"
                        ? `Marked ${request.name}'s request approved. Send them the passcode.`
                        : status === "dismissed"
                          ? `Dismissed ${request.name}'s request.`
                          : `Put ${request.name}'s request back on the waiting list.`
                    )
                  }
                  onDelete={() =>
                    call(
                      `request-delete:${request.id}`,
                      `/api/requests/${encodeURIComponent(request.id)}`,
                      { method: "DELETE" },
                      `Deleted ${request.name}'s request.`
                    )
                  }
                />
              ))}
            </div>
          )}
        </section>
      </main>
    </div>
  );
}

/* ── drives ──────────────────────────────────────────────────────────────── */

/**
 * One drive at rest: what it is called, where it answers, and the three facts
 * that decide who can see it. The editor is mounted only while it is open, so
 * every time it opens it is seeded from the freshest server data rather than
 * from whatever was typed and abandoned an hour ago.
 */
function DriveRow({
  brand,
  open,
  locked,
  savingId,
  onToggle,
  onSave,
  onDelete,
}: {
  brand: Brand;
  open: boolean;
  locked: boolean;
  savingId: string | null;
  onToggle: () => void;
  onSave: (patch: DrivePatch) => Promise<boolean>;
  onDelete: () => Promise<boolean>;
}) {
  const [confirming, setConfirming] = useState(false);
  const deleting = savingId === `delete:${brand.key}`;

  return (
    <div
      style={{
        border: "1px solid var(--color-divider)",
        borderTop: "2px solid var(--color-accent)",
        background: "var(--color-surface)",
        animation: "rise .35s both",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 14,
          padding: "14px 16px",
          flexWrap: "wrap",
        }}
      >
        <div
          style={{
            width: 32,
            height: 32,
            flex: "none",
            display: "grid",
            placeItems: "center",
            background: "var(--color-accent-100)",
            color: "var(--color-accent-700)",
            border: "1px solid var(--color-accent-300)",
          }}
        >
          <Icon name={brand.visibility === "private" ? "lock" : "drive"} size={16} />
        </div>

        <div style={{ minWidth: 180, flex: 1 }}>
          <div
            style={{
              fontFamily: "var(--font-heading)",
              fontWeight: 600,
              fontSize: 19,
              lineHeight: 1.15,
              letterSpacing: ".01em",
            }}
          >
            {brand.name}
          </div>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 10,
              flexWrap: "wrap",
              marginTop: 3,
              fontSize: 12,
            }}
          >
            <a href={brand.basePath}>{brand.basePath}</a>
            <span style={{ opacity: 0.5 }}>key {brand.key}</span>
          </div>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 7, flexWrap: "wrap" }}>
          <span
            className={brand.visibility === "private" ? "tag tag-outline" : "tag tag-neutral"}
            style={{ fontSize: 10 }}
          >
            {brand.visibility === "private" ? "PRIVATE" : "PUBLIC"}
          </span>
          {!brand.listed && (
            <span className="tag tag-neutral" style={{ fontSize: 10 }}>
              UNLISTED
            </span>
          )}
          {brand.hasPasscode && (
            <span className="tag tag-accent" style={{ fontSize: 10 }}>
              PASSCODE SET
            </span>
          )}
          {brand.legacyRoot && (
            <span className="tag tag-neutral" style={{ fontSize: 10 }}>
              OLD ROOT LINKS
            </span>
          )}
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
          <a className="btn btn-secondary btn-icon" href={brand.basePath} title="Open the drive">
            <Icon name="open" size={15} />
          </a>
          <button
            className="btn btn-secondary"
            onClick={onToggle}
            disabled={locked}
            aria-expanded={open}
          >
            <Icon name={open ? "close" : "edit"} size={14} />
            {open ? "Close" : "Edit"}
          </button>
          <button
            className="btn btn-secondary btn-icon"
            onClick={() => setConfirming(true)}
            disabled={locked || confirming}
            title="Delete this drive"
            aria-label="Delete this drive"
            style={{ color: DANGER }}
          >
            <Icon name="trash" size={15} />
          </button>
        </div>
      </div>

      {brand.visibility === "private" && !brand.hasPasscode && (
        <div
          style={{
            padding: "10px 16px",
            borderTop: "1px solid var(--color-divider)",
            fontSize: 13,
            color: DANGER,
            background: `color-mix(in srgb, ${DANGER} 6%, transparent)`,
          }}
        >
          This drive is private with no passcode set, so nobody but you can open it.
        </div>
      )}

      {confirming && (
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 12,
            flexWrap: "wrap",
            padding: "12px 16px",
            borderTop: "1px solid var(--color-divider)",
            background: `color-mix(in srgb, ${DANGER} 6%, transparent)`,
            fontSize: 13,
          }}
        >
          <span style={{ flex: 1, minWidth: 240 }}>
            Delete {brand.name}? Its folders and files are not touched — the registry row goes,
            and {brand.basePath} stops answering. A drive that still holds anything is refused.
          </span>
          <button
            className="btn btn-secondary"
            onClick={() => setConfirming(false)}
            disabled={deleting}
          >
            Keep it
          </button>
          <button
            className="btn btn-primary"
            onClick={async () => {
              const done = await onDelete();
              if (done) setConfirming(false);
            }}
            disabled={locked}
            style={{ background: DANGER, borderColor: DANGER, color: DANGER_TEXT }}
          >
            <Icon name="trash" size={14} />
            {deleting ? "Deleting…" : "Delete the drive"}
          </button>
        </div>
      )}

      {open && (
        <DriveEditor
          brand={brand}
          locked={locked}
          saving={savingId === `save:${brand.key}`}
          onSave={onSave}
          onCancel={onToggle}
        />
      )}
    </div>
  );
}

/**
 * The whole of a drive's identity in one form. It is a form rather than a set
 * of inline controls because most of these fields are read together — a name,
 * the line under it, the tab title — and changing one usually means looking at
 * the others.
 */
function DriveEditor({
  brand,
  locked,
  saving,
  onSave,
  onCancel,
}: {
  brand: Brand;
  locked: boolean;
  saving: boolean;
  onSave: (patch: DrivePatch) => Promise<boolean>;
  onCancel: () => void;
}) {
  const [form, setForm] = useState<DriveForm>(() => formOf(brand));
  const [mode, setMode] = useState<PasscodeMode>("keep");
  const [passcode, setPasscode] = useState("");

  const id = (field: string) => `drive-${brand.key}-${field}`;
  const set = <K extends keyof DriveForm>(field: K, value: DriveForm[K]) =>
    setForm((prev) => ({ ...prev, [field]: value }));

  const preview = slugifyDrive(form.slug.trim());
  // "Set a passcode" with the box left empty would reach the API as an empty
  // string, which it reads as "clear it" — the exact accident this control was
  // shaped to prevent. So the save waits rather than guessing which was meant.
  const blank = mode === "set" && !passcode.trim();
  // Clearing the passcode on a drive that stays private leaves it with no door
  // at all, and the API refuses exactly that. The form refuses it first, since
  // an admin reads a disabled button as a choice still to be made and a failed
  // save as something having gone wrong. The visibility read here is the one
  // the form is holding rather than the saved one, so clearing the passcode and
  // making the drive public in the same edit remains a legitimate thing to do.
  const shutOut = mode === "clear" && form.visibility === "private";

  async function submit(ev: React.FormEvent) {
    ev.preventDefault();
    if (blank || shutOut) return;
    await onSave(patchFor(brand, form, mode, passcode));
  }

  return (
    <form
      onSubmit={submit}
      style={{
        padding: "20px 16px 22px",
        borderTop: "1px solid var(--color-divider)",
        background: "color-mix(in srgb, var(--color-accent) 4%, var(--color-surface))",
        animation: "pop .12s ease-out both",
      }}
    >
      <div style={{ ...LABEL, marginBottom: 14 }}>Identity</div>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
          gap: 14,
        }}
      >
        <div className="field">
          <label htmlFor={id("name")}>Name</label>
          <input
            id={id("name")}
            className="input"
            value={form.name}
            onChange={(e) => set("name", e.target.value)}
            disabled={locked}
          />
        </div>

        <div className="field">
          <label htmlFor={id("tagline")}>Tagline</label>
          <input
            id={id("tagline")}
            className="input"
            value={form.tagline}
            onChange={(e) => set("tagline", e.target.value)}
            placeholder="The small line under the name"
            disabled={locked}
          />
        </div>

        <div className="field">
          <label htmlFor={id("title")}>Browser tab title</label>
          <input
            id={id("title")}
            className="input"
            value={form.title}
            onChange={(e) => set("title", e.target.value)}
            disabled={locked}
          />
        </div>

        <div className="field">
          <label htmlFor={id("shortName")}>Home-screen name</label>
          <input
            id={id("shortName")}
            className="input"
            value={form.shortName}
            onChange={(e) => set("shortName", e.target.value)}
            placeholder="Short — iOS truncates"
            disabled={locked}
          />
        </div>

        <div className="field" style={{ gridColumn: "1 / -1" }}>
          <label htmlFor={id("description")}>Description</label>
          <textarea
            id={id("description")}
            className="input"
            value={form.description}
            onChange={(e) => set("description", e.target.value)}
            rows={2}
            disabled={locked}
          />
        </div>

        <div className="field">
          <label htmlFor={id("poweredBy")}>Powered-by mark</label>
          <input
            id={id("poweredBy")}
            className="input"
            value={form.poweredBy}
            onChange={(e) => set("poweredBy", e.target.value)}
            placeholder="Leave empty for none"
            disabled={locked}
          />
        </div>

        <div className="field">
          <label htmlFor={id("slug")}>Address</label>
          <input
            id={id("slug")}
            className="input"
            value={form.slug}
            onChange={(e) => set("slug", e.target.value)}
            disabled={locked}
          />
          <div style={{ marginTop: 6, fontSize: 12, opacity: 0.7 }}>
            The drive will answer at <strong>/{preview}</strong>. Renaming it keeps the old
            address working, so links already shared still land, and the drive&rsquo;s key
            ({brand.key}) never changes whatever the address becomes.
          </div>
        </div>
      </div>

      <div className="hr" style={{ margin: "22px 0 18px" }} />

      <div style={{ ...LABEL, marginBottom: 14 }}>Who sees it</div>

      <div
        style={{
          display: "flex",
          gap: 26,
          flexWrap: "wrap",
          alignItems: "flex-start",
          marginBottom: 4,
        }}
      >
        <fieldset style={GROUP}>
          <legend style={GROUP_LABEL}>Visibility</legend>
          <Choice
            name={id("visibility")}
            value={form.visibility}
            disabled={locked}
            onChange={(next) => set("visibility", next)}
            options={[
              { value: "public", label: "Public" },
              { value: "private", label: "Private" },
            ]}
          />
        </fieldset>

        <fieldset style={GROUP}>
          <legend style={GROUP_LABEL}>On the dashboard</legend>
          <Choice
            name={id("listed")}
            value={form.listed ? "listed" : "unlisted"}
            disabled={locked}
            onChange={(next) => set("listed", next === "listed")}
            options={[
              { value: "listed", label: "Listed" },
              { value: "unlisted", label: "Unlisted" },
            ]}
          />
        </fieldset>

        <fieldset style={GROUP}>
          <legend style={GROUP_LABEL}>Folders</legend>
          <Choice
            name={id("numbered")}
            value={form.numbered ? "numbered" : "plain"}
            disabled={locked}
            onChange={(next) => set("numbered", next === "numbered")}
            options={[
              { value: "plain", label: "Plain" },
              { value: "numbered", label: "Numbered" },
            ]}
          />
        </fieldset>
      </div>

      <div className="hr" style={{ margin: "22px 0 18px" }} />

      <div style={{ ...LABEL, marginBottom: 6 }}>Passcode</div>
      <p style={{ margin: "0 0 12px", fontSize: 13, opacity: 0.75, maxWidth: "62ch" }}>
        {brand.hasPasscode
          ? "This drive has a passcode. It is stored hashed and cannot be read back, only replaced or removed."
          : "This drive has no passcode. A private drive needs one before it can be opened by anyone but you."}
      </p>

      <div
        role="radiogroup"
        aria-label="Passcode"
        style={{ display: "flex", flexDirection: "column", gap: 9 }}
      >
        <label className="radio">
          <input
            type="radio"
            name={id("passcode-mode")}
            checked={mode === "keep"}
            onChange={() => setMode("keep")}
            disabled={locked}
          />
          <span className="dot" />
          <span>Leave the passcode as it is</span>
        </label>

        <label className="radio">
          <input
            type="radio"
            name={id("passcode-mode")}
            checked={mode === "set"}
            onChange={() => setMode("set")}
            disabled={locked}
          />
          <span className="dot" />
          <span>{brand.hasPasscode ? "Replace it with a new one" : "Set a passcode"}</span>
        </label>

        {mode === "set" && (
          <div className="field" style={{ maxWidth: 320, marginLeft: 24 }}>
            <label htmlFor={id("passcode")}>New passcode</label>
            <input
              id={id("passcode")}
              className="input"
              type="text"
              autoComplete="off"
              value={passcode}
              onChange={(e) => setPasscode(e.target.value)}
              placeholder="What you will send the visitor"
              disabled={locked}
            />
          </div>
        )}

        <label className="radio" style={{ opacity: brand.hasPasscode ? 1 : 0.5 }}>
          <input
            type="radio"
            name={id("passcode-mode")}
            checked={mode === "clear"}
            onChange={() => setMode("clear")}
            disabled={locked || !brand.hasPasscode}
          />
          <span className="dot" />
          <span>Remove the passcode</span>
        </label>
      </div>

      {shutOut && (
        <div style={{ marginTop: 10, fontSize: 13, color: DANGER }}>
          Removing the passcode would shut this private drive to everyone, so the panel will not
          send it. Make the drive public first, or set a new passcode instead.
        </div>
      )}

      {blank && (
        <div style={{ marginTop: 10, fontSize: 13, color: DANGER }}>
          Type the new passcode, or choose to leave the current one alone.
        </div>
      )}

      <div style={{ display: "flex", gap: 9, marginTop: 24, flexWrap: "wrap" }}>
        <button className="btn btn-primary" type="submit" disabled={locked || blank || shutOut}>
          <Icon name="edit" size={14} />
          {saving ? "Saving…" : "Save changes"}
        </button>
        <button className="btn btn-secondary" type="button" onClick={onCancel} disabled={locked}>
          Cancel
        </button>
      </div>
    </form>
  );
}

/**
 * A new drive asks for as little as it can: a name, the address it will answer
 * at, and whether it is open. Everything else has a sensible default and is
 * easier to judge once the drive exists and can be looked at.
 */
function CreateDrive({
  locked,
  busy,
  onCreate,
  onCancel,
}: {
  locked: boolean;
  busy: boolean;
  onCreate: (body: {
    name: string;
    slug: string;
    visibility: DriveVisibility;
    passcode?: string;
  }) => Promise<boolean>;
  onCancel: () => void;
}) {
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [visibility, setVisibility] = useState<DriveVisibility>("public");
  const [passcode, setPasscode] = useState("");
  // The address follows the name until the admin writes one themselves, after
  // which typing the name no longer rewrites what they chose.
  const [slugTouched, setSlugTouched] = useState(false);

  // slugifyDrive answers "drive" for an empty string, which on an untouched
  // form would put an address nobody chose in the field and promise /drive
  // underneath it. Nothing is slugified until there is something to slugify, so
  // the field's placeholder stands until the drive is actually named.
  const typed = (slugTouched ? slug : name).trim();
  const preview = typed ? slugifyDrive(typed) : "";

  /**
   * Nothing is cleared on success because the panel closes this form when the
   * drive is created, and opening it again mounts an empty one. A failed
   * attempt keeps every field, so a rejected address can be corrected rather
   * than retyped.
   */
  async function submit(ev: React.FormEvent) {
    ev.preventDefault();
    // What the visitor types is trimmed before it is checked, so the passcode
    // is trimmed before it is stored. It also decides emptiness here: a
    // passcode of nothing but spaces would otherwise pass for one and open a
    // private drive that not even the person sent it could unlock.
    const secret = passcode.trim();
    await onCreate({
      name: name.trim(),
      slug: preview,
      visibility,
      // An empty passcode is left out entirely: the API reads its absence as
      // "no passcode", and refuses that on a private drive.
      ...(visibility === "private" && secret ? { passcode: secret } : {}),
    });
  }

  return (
    <form
      onSubmit={submit}
      className="blueprint"
      style={{
        padding: "26px 24px",
        marginBottom: 20,
        background: "var(--color-surface)",
        maxWidth: 620,
      }}
    >
      <i className="corner tl" />
      <i className="corner tr" />
      <i className="corner bl" />
      <i className="corner br" />

      <div
        style={{
          fontFamily: "var(--font-heading)",
          fontWeight: 600,
          fontSize: 22,
          lineHeight: 1.1,
          letterSpacing: ".02em",
        }}
      >
        A new drive
      </div>
      <div style={{ ...TAGLINE, marginTop: 2 }}>Live as soon as it is saved</div>
      <div
        style={{ height: 2, width: 58, background: "var(--color-accent)", margin: "16px 0 22px" }}
      />

      <div className="field" style={{ marginBottom: 14 }}>
        <label htmlFor="new-drive-name">Name</label>
        <input
          id="new-drive-name"
          className="input"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="What the drive is called"
          autoFocus
          disabled={locked}
        />
      </div>

      <div className="field" style={{ marginBottom: 14 }}>
        <label htmlFor="new-drive-slug">Address</label>
        <input
          id="new-drive-slug"
          className="input"
          value={slugTouched ? slug : preview}
          onChange={(e) => {
            setSlugTouched(true);
            setSlug(e.target.value);
          }}
          placeholder="Taken from the name"
          disabled={locked}
        />
        <div style={{ marginTop: 6, fontSize: 12, opacity: 0.7 }}>
          The drive will answer at <strong>/{preview || "…"}</strong>, and its key will be the
          same word — permanently, since every folder and file will carry it.
        </div>
      </div>

      <fieldset style={GROUP}>
        <legend style={GROUP_LABEL}>Visibility</legend>
        <Choice
          name="new-drive-visibility"
          value={visibility}
          disabled={locked}
          onChange={setVisibility}
          options={[
            { value: "public", label: "Public" },
            { value: "private", label: "Private" },
          ]}
        />
      </fieldset>

      {visibility === "private" && (
        <div className="field" style={{ marginTop: 16, maxWidth: 320 }}>
          <label htmlFor="new-drive-passcode">Passcode</label>
          <input
            id="new-drive-passcode"
            className="input"
            type="text"
            autoComplete="off"
            value={passcode}
            onChange={(e) => setPasscode(e.target.value)}
            placeholder="Required for a private drive"
            disabled={locked}
          />
        </div>
      )}

      <div style={{ display: "flex", gap: 9, marginTop: 22, flexWrap: "wrap" }}>
        <button className="btn btn-primary" type="submit" disabled={locked || !name.trim()}>
          <Icon name="plus" size={14} />
          {busy ? "Creating…" : "Create the drive"}
        </button>
        <button className="btn btn-secondary" type="button" onClick={onCancel} disabled={locked}>
          Cancel
        </button>
      </div>
    </form>
  );
}

/* ── requests ────────────────────────────────────────────────────────────── */

/**
 * One request, with everything the admin needs to answer it in front of them —
 * who asked, how to reach them, which drive, and what they said. The note is
 * shown in full rather than truncated: it is usually the only thing that says
 * why the person should be let in.
 */
function RequestRow({
  request,
  locked,
  savingId,
  onStatus,
  onDelete,
}: {
  request: DriveRequest;
  locked: boolean;
  savingId: string | null;
  onStatus: (status: "new" | "approved" | "dismissed") => Promise<boolean>;
  onDelete: () => Promise<boolean>;
}) {
  const [confirming, setConfirming] = useState(false);
  const working = savingId === `request:${request.id}`;
  const deleting = savingId === `request-delete:${request.id}`;

  const tag =
    request.status === "approved"
      ? { className: "tag tag-accent", text: "APPROVED" }
      : request.status === "dismissed"
        ? { className: "tag tag-neutral", text: "DISMISSED" }
        : { className: "tag tag-outline", text: "WAITING" };

  return (
    <div
      style={{
        border: "1px solid var(--color-divider)",
        background: "var(--color-surface)",
        opacity: request.status === "new" ? 1 : 0.8,
        animation: "rise .35s both",
      }}
    >
      <div style={{ padding: "14px 16px" }}>
        <div style={{ display: "flex", alignItems: "baseline", gap: 10, flexWrap: "wrap" }}>
          <span
            style={{
              fontFamily: "var(--font-heading)",
              fontWeight: 600,
              fontSize: 18,
              letterSpacing: ".01em",
            }}
          >
            {request.name}
          </span>
          <a href={`mailto:${request.email}`} style={{ fontSize: 13 }}>
            {request.email}
          </a>
          <span className={tag.className} style={{ fontSize: 10, marginLeft: "auto" }}>
            {tag.text}
          </span>
        </div>

        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 10,
            flexWrap: "wrap",
            marginTop: 6,
            fontSize: 12,
            opacity: 0.7,
          }}
        >
          <span>
            Asked for{" "}
            <strong style={{ opacity: 0.9 }}>
              {request.driveName ?? "a drive of their own"}
            </strong>
          </span>
          <span aria-hidden="true">—</span>
          <time dateTime={new Date(request.createdAt).toISOString()} suppressHydrationWarning>
            {when(request.createdAt)}
          </time>
          {request.handledAt !== null && (
            <>
              <span aria-hidden="true">—</span>
              <span suppressHydrationWarning>answered {when(request.handledAt)}</span>
            </>
          )}
        </div>

        {request.note && (
          <p
            style={{
              margin: "12px 0 0",
              padding: "10px 13px",
              fontSize: 13,
              whiteSpace: "pre-wrap",
              borderLeft: "2px solid var(--color-accent)",
              background: "color-mix(in srgb, var(--color-accent) 5%, transparent)",
            }}
          >
            {request.note}
          </p>
        )}

        <div style={{ display: "flex", gap: 7, marginTop: 14, flexWrap: "wrap" }}>
          {request.status !== "approved" && (
            <button
              className="btn btn-secondary"
              onClick={() => onStatus("approved")}
              disabled={locked}
              title="Mark this request as dealt with — the passcode is what grants access"
            >
              <Icon name="bookmark" size={14} />
              {working ? "Working…" : "Approve"}
            </button>
          )}
          {request.status !== "dismissed" && (
            <button
              className="btn btn-secondary"
              onClick={() => onStatus("dismissed")}
              disabled={locked}
            >
              <Icon name="close" size={14} />
              Dismiss
            </button>
          )}
          {request.status !== "new" && (
            <button
              className="btn btn-secondary"
              onClick={() => onStatus("new")}
              disabled={locked}
              title="Put it back on the waiting list"
            >
              <Icon name="restore" size={14} />
              Reopen
            </button>
          )}
          <button
            className="btn btn-secondary btn-icon"
            onClick={() => setConfirming(true)}
            disabled={locked || confirming}
            title="Delete this request"
            aria-label="Delete this request"
            style={{ marginLeft: "auto", color: DANGER }}
          >
            <Icon name="trash" size={15} />
          </button>
        </div>
      </div>

      {confirming && (
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 12,
            flexWrap: "wrap",
            padding: "12px 16px",
            borderTop: "1px solid var(--color-divider)",
            background: `color-mix(in srgb, ${DANGER} 6%, transparent)`,
            fontSize: 13,
          }}
        >
          <span style={{ flex: 1, minWidth: 220 }}>
            Delete this request for good? Dismissing keeps the record; deleting does not.
          </span>
          <button
            className="btn btn-secondary"
            onClick={() => setConfirming(false)}
            disabled={deleting}
          >
            Keep it
          </button>
          <button
            className="btn btn-primary"
            onClick={async () => {
              const done = await onDelete();
              if (done) setConfirming(false);
            }}
            disabled={locked}
            style={{ background: DANGER, borderColor: DANGER, color: DANGER_TEXT }}
          >
            <Icon name="trash" size={14} />
            {deleting ? "Deleting…" : "Delete"}
          </button>
        </div>
      )}
    </div>
  );
}

/* ── shared controls ─────────────────────────────────────────────────────── */

/**
 * A two-or-three way choice as the design system draws it: real radio inputs
 * inside a `.seg`, so it is a keyboard control and a form field rather than a
 * pair of buttons pretending to be one.
 */
function Choice<T extends string>({
  name,
  value,
  options,
  onChange,
  disabled,
}: {
  name: string;
  value: T;
  options: { value: T; label: string }[];
  onChange: (next: T) => void;
  disabled?: boolean;
}) {
  return (
    <div className="seg">
      {options.map((option) => (
        <label key={option.value} className="seg-opt">
          <input
            type="radio"
            name={name}
            value={option.value}
            checked={value === option.value}
            onChange={() => onChange(option.value)}
            disabled={disabled}
          />
          {option.label}
        </label>
      ))}
    </div>
  );
}
