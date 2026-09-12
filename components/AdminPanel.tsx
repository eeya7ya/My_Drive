"use client";

/**
 * The admin panel: the level above the drives.
 *
 * Which drives exist, who runs each one, and how much each may store. It is
 * deliberately not where a drive's folders are added or its name is changed —
 * those belong to the drive's owner and are done from inside the drive, behind
 * the header's own control. The admin hands a drive to somebody and sets the
 * ceiling on what it can hold; what happens inside is theirs.
 *
 * It is an operator's tool, not a separate application, so it is assembled
 * from the same parts as everything else — blueprint frames with registration
 * marks, `.field` / `.input` controls, the letterspaced micro-label, the
 * accent rule under a heading. Somebody who arrives here from a drive should
 * recognise where they are.
 *
 * Two decisions shape the rest of the file. Every write sends only the fields
 * that actually changed and then calls router.refresh(), so the server render
 * stays the single copy of the truth; a panel that patched its own list would
 * drift from the database the first time a save half succeeded, and the admin
 * would have no way to tell. And each passcode is a three-way choice rather
 * than a text box, because the API has three cases — leave it, set it, clear
 * it — and a blank field that silently means "leave it" is how people lock
 * themselves out of their own drive.
 */

import React, { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Icon } from "./icons";
import Choice, {
  DANGER,
  DANGER_TEXT,
  GROUP,
  GROUP_LABEL,
  LABEL,
  TAGLINE,
} from "./Choice";
import { Brand, DriveVisibility, SITE, slugifyDrive } from "@/lib/brand";
import { humanSizeTrim } from "@/lib/types";
import type { DriveRequest } from "@/lib/drives";
import type { DriveMember } from "@/lib/types";

/**
 * What the panel says after a write. A confirmation and a refusal share one
 * slot deliberately: whatever happened, the answer appears in the same place,
 * so there is no state in which the admin has to guess whether a change
 * landed.
 */
type Note = { tone: "ok" | "bad"; text: string } | null;

/** One gibibyte, the unit the quota field is typed in. */
const GIB = 1024 * 1024 * 1024;

/**
 * The body of a PATCH the admin is allowed to send. The drive's identity is
 * absent on purpose — the API refuses those fields from an admin, because they
 * are the owner's, and a form that could not send them cannot accidentally try.
 */
interface DrivePatch {
  listed?: boolean;
  ownerName?: string;
  ownerEmail?: string;
  ownerPasscode?: string | null;
  quotaBytes?: number;
}

/** What the admin holds about one drive while editing it. */
interface MemberForm {
  ownerName: string;
  ownerEmail: string;
  listed: boolean;
  /** Typed in GB, because bytes are not a number anybody chooses in. */
  quotaGb: string;
}

/** The three things an admin can mean by touching an owner passcode. */
type PasscodeMode = "keep" | "set" | "clear";

function formOf(member: DriveMember, brand: Brand): MemberForm {
  return {
    ownerName: member.ownerName,
    ownerEmail: member.ownerEmail,
    listed: brand.listed,
    // Trailing zeros are trimmed so a round 200 GB reads as "200" rather than
    // "200.00", and a quota that is not a whole number of GB still round-trips.
    quotaGb: String(Number((member.quotaBytes / GIB).toFixed(2))),
  };
}

/**
 * The difference between the drive as it is and the form as it stands. Sending
 * the whole form instead would work, but it would also rewrite fields nobody
 * touched — and with two admins, or two tabs, that quietly reverts the other
 * one's edit.
 */
function patchFor(
  member: DriveMember,
  brand: Brand,
  form: MemberForm,
  mode: PasscodeMode,
  passcode: string
): DrivePatch {
  const patch: DrivePatch = {};

  const ownerName = form.ownerName.trim();
  if (ownerName !== member.ownerName) patch.ownerName = ownerName;

  const ownerEmail = form.ownerEmail.trim();
  if (ownerEmail !== member.ownerEmail) patch.ownerEmail = ownerEmail;

  if (form.listed !== brand.listed) patch.listed = form.listed;

  // Compared in bytes rather than in the typed text, so re-saving a form that
  // was never touched sends nothing even though "200" and "200.00" differ.
  const gb = Number(form.quotaGb);
  if (Number.isFinite(gb) && gb > 0) {
    const bytes = Math.round(gb * GIB);
    if (bytes !== member.quotaBytes) patch.quotaBytes = bytes;
  }

  // The sign-in forms trim what is typed and the server compares the hashes
  // exactly, so a passcode saved with a space around it could never be entered
  // again. It is trimmed on the way in as well, and the two ends agree.
  if (mode === "set") patch.ownerPasscode = passcode.trim();
  if (mode === "clear") patch.ownerPasscode = null;

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
  members,
  requests,
}: {
  drives: Brand[];
  /**
   * One entry per drive, in the same order: who runs it and what it may store.
   * Read on the server beside `drives` rather than fetched here, which is what
   * lets every write end with router.refresh().
   */
  members: DriveMember[];
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
  const byKey = new Map(members.map((m) => [m.key, m]));
  const unowned = drives.filter((d) => !d.hasOwner).length;

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
            Drives, owners &amp; storage
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
            fixed at creation because every folder and file row carries it. What this panel sets
            is who runs each drive and how much it may hold; the drive&rsquo;s own name, address
            and folders are its owner&rsquo;s, and are changed from inside the drive.
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
              {unowned > 0 &&
                ` · ${unowned === 1 ? "one has" : `${unowned} have`} no owner`}
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
                member={
                  byKey.get(brand.key) ?? {
                    key: brand.key,
                    name: brand.name,
                    slug: brand.slug,
                    ownerName: "",
                    ownerEmail: "",
                    hasOwner: brand.hasOwner,
                    usedBytes: 0,
                    quotaBytes: 200 * GIB,
                  }
                }
                open={editing === brand.key}
                locked={locked}
                savingId={busy}
                onToggle={() => setEditing(editing === brand.key ? null : brand.key)}
                onSave={async (patch) => {
                  if (Object.keys(patch).length === 0) {
                    setNote({ tone: "ok", text: "Nothing to save — no field changed." });
                    return true;
                  }
                  const handed =
                    patch.ownerPasscode === null
                      ? ` Its owner passcode is cleared, so nobody can manage it until you set a new one.`
                      : patch.ownerPasscode
                        ? ` Send the new owner passcode to ${patch.ownerName ?? byKey.get(brand.key)?.ownerName ?? "its owner"} — the previous one no longer works.`
                        : "";
                  const done = await call(
                    `save:${brand.key}`,
                    `/api/drives/${encodeURIComponent(brand.key)}`,
                    {
                      method: "PATCH",
                      headers: { "Content-Type": "application/json" },
                      body: JSON.stringify(patch),
                    },
                    `Saved ${brand.name}.${handed}`
                  );
                  if (done) setEditing(null);
                  return done;
                }}
                onTakeOver={() =>
                  call(
                    `seat:${brand.key}`,
                    `/api/drives/${encodeURIComponent(brand.key)}/owner`,
                    {
                      method: "POST",
                      headers: { "Content-Type": "application/json" },
                      body: JSON.stringify({ takeOver: true }),
                    },
                    `You hold ${brand.name}'s owner seat now. Open the drive to add folders or change its identity.`
                  )
                }
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
            its own. What opens a private drive is its reader passcode, which its owner sets from
            inside the drive; what lets somebody run a drive is the owner passcode you set here.
            Send whichever one you meant, and only that one.
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
 * One drive at rest: who runs it, what it holds, and the facts that decide who
 * can find it. What it is *called* is here too, but only as a label — changing
 * it is the owner's, from inside the drive.
 *
 * The editor is mounted only while it is open, so every time it opens it is
 * seeded from the freshest server data rather than from whatever was typed and
 * abandoned an hour ago.
 */
function DriveRow({
  brand,
  member,
  open,
  locked,
  savingId,
  onToggle,
  onSave,
  onTakeOver,
  onDelete,
}: {
  brand: Brand;
  member: DriveMember;
  open: boolean;
  locked: boolean;
  savingId: string | null;
  onToggle: () => void;
  onSave: (patch: DrivePatch) => Promise<boolean>;
  onTakeOver: () => Promise<boolean>;
  onDelete: () => Promise<boolean>;
}) {
  const [confirming, setConfirming] = useState(false);
  const deleting = savingId === `delete:${brand.key}`;
  const seating = savingId === `seat:${brand.key}`;

  const full = member.quotaBytes > 0 ? member.usedBytes / member.quotaBytes : 0;
  // Three bands rather than a gradient: the bar is read at a glance, and what
  // it has to answer is "is this drive fine, filling up, or a problem".
  const barColour = full >= 0.9 ? DANGER : full >= 0.7 ? "var(--color-accent-600)" : "var(--color-accent)";

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
            {/* The owner in the same breath as the address, because "whose
                drive is that?" is the question this panel exists to answer. */}
            <span style={{ opacity: 0.75 }}>
              {member.ownerName || member.ownerEmail ? (
                <>
                  run by <strong style={{ opacity: 0.9 }}>{member.ownerName || member.ownerEmail}</strong>
                </>
              ) : brand.hasOwner ? (
                "owner unnamed"
              ) : (
                <span style={{ color: DANGER }}>no owner</span>
              )}
            </span>
          </div>
        </div>

        {/* Storage, as the number and the bar the drive's own sidebar shows.
            It is the other half of what this panel manages, so it sits in the
            row rather than behind the editor. */}
        <div style={{ width: 168, flex: "none" }}>
          <div style={{ fontSize: 12, display: "flex", justifyContent: "space-between", gap: 8 }}>
            <span>{humanSizeTrim(member.usedBytes)}</span>
            <span style={{ opacity: 0.6 }}>of {humanSizeTrim(member.quotaBytes)}</span>
          </div>
          <div
            style={{
              height: 4,
              marginTop: 5,
              background: "color-mix(in srgb, var(--color-text) 12%, transparent)",
            }}
          >
            <div
              style={{
                height: "100%",
                width: `${Math.min(100, Math.round(full * 100))}%`,
                background: barColour,
              }}
            />
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
            {open ? "Close" : "Manage"}
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

      {!brand.hasOwner && (
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 12,
            flexWrap: "wrap",
            padding: "10px 16px",
            borderTop: "1px solid var(--color-divider)",
            fontSize: 13,
            background: `color-mix(in srgb, ${DANGER} 6%, transparent)`,
          }}
        >
          <span style={{ flex: 1, minWidth: 260 }}>
            Nobody can add a folder to this drive until it has an owner. Set an owner passcode
            below and send it to them — or take the seat yourself.
          </span>
          <button className="btn btn-secondary" onClick={onTakeOver} disabled={locked}>
            <Icon name="shield" size={14} />
            {seating ? "Taking…" : "Take the seat"}
          </button>
        </div>
      )}

      {brand.visibility === "private" && !brand.hasPasscode && (
        <div
          style={{
            padding: "10px 16px",
            borderTop: "1px solid var(--color-divider)",
            fontSize: 13,
            opacity: 0.85,
          }}
        >
          This drive is private with no reader passcode, so only its owner and you can open it.
          Setting one is the owner&rsquo;s to do, from inside the drive.
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
        <DriveMembership
          brand={brand}
          member={member}
          locked={locked}
          saving={savingId === `save:${brand.key}`}
          onSave={onSave}
          onTakeOver={onTakeOver}
          onCancel={onToggle}
        />
      )}
    </div>
  );
}

/**
 * Everything the admin decides about one drive, in one form: who runs it, how
 * much it may store, and whether the dashboard names it.
 *
 * What is conspicuously not here is the drive's identity — its name, tagline,
 * address and numbering. Those used to live in this form, and moving them into
 * the drive is the whole point: the person who runs a drive should not have to
 * ask the person who minds the quotas to rename a folder.
 */
function DriveMembership({
  brand,
  member,
  locked,
  saving,
  onSave,
  onTakeOver,
  onCancel,
}: {
  brand: Brand;
  member: DriveMember;
  locked: boolean;
  saving: boolean;
  onSave: (patch: DrivePatch) => Promise<boolean>;
  onTakeOver: () => Promise<boolean>;
  onCancel: () => void;
}) {
  const [form, setForm] = useState<MemberForm>(() => formOf(member, brand));
  const [mode, setMode] = useState<PasscodeMode>("keep");
  const [passcode, setPasscode] = useState("");

  const id = (field: string) => `drive-${brand.key}-${field}`;
  const set = <K extends keyof MemberForm>(field: K, value: MemberForm[K]) =>
    setForm((prev) => ({ ...prev, [field]: value }));

  // "Set a passcode" with the box left empty would reach the API as an empty
  // string, which it reads as "clear it" — the exact accident this control was
  // shaped to prevent. So the save waits rather than guessing which was meant.
  const blank = mode === "set" && !passcode.trim();

  const gb = Number(form.quotaGb);
  const badQuota = form.quotaGb.trim() !== "" && (!Number.isFinite(gb) || gb <= 0);
  // The server refuses a quota below what the drive already holds; saying so
  // here means the admin sees it while the number is still in front of them.
  const belowUsed =
    !badQuota && Number.isFinite(gb) && gb > 0 && Math.round(gb * GIB) < member.usedBytes;

  const stopped = blank || badQuota || belowUsed;

  async function submit(ev: React.FormEvent) {
    ev.preventDefault();
    if (stopped) return;
    await onSave(patchFor(member, brand, form, mode, passcode));
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
      <div style={{ ...LABEL, marginBottom: 14 }}>Who runs it</div>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
          gap: 14,
        }}
      >
        <div className="field">
          <label htmlFor={id("owner-name")}>Owner</label>
          <input
            id={id("owner-name")}
            className="input"
            value={form.ownerName}
            onChange={(e) => set("ownerName", e.target.value)}
            placeholder="Who you handed the drive to"
            disabled={locked}
          />
        </div>

        <div className="field">
          <label htmlFor={id("owner-email")}>Owner email</label>
          <input
            id={id("owner-email")}
            className="input"
            type="email"
            value={form.ownerEmail}
            onChange={(e) => set("ownerEmail", e.target.value)}
            placeholder="Where to send the passcode"
            disabled={locked}
          />
        </div>
      </div>

      <p style={{ margin: "12px 0 0", fontSize: 12, opacity: 0.65, maxWidth: "62ch" }}>
        These two are a record for you, not a login. What actually lets somebody run the drive is
        the owner passcode below.
      </p>

      <div className="hr" style={{ margin: "22px 0 18px" }} />

      <div style={{ ...LABEL, marginBottom: 6 }}>Owner passcode</div>
      <p style={{ margin: "0 0 12px", fontSize: 13, opacity: 0.75, maxWidth: "62ch" }}>
        {brand.hasOwner
          ? "This drive has an owner passcode. It is stored hashed and cannot be read back, only replaced or removed — and replacing it signs the current owner out of the drive's controls straight away."
          : "This drive has no owner passcode, so nobody can add folders to it or change what it is called. Set one and send it to whoever is to run the drive."}
      </p>

      <div
        role="radiogroup"
        aria-label="Owner passcode"
        style={{ display: "flex", flexDirection: "column", gap: 9 }}
      >
        <label className="radio">
          <input
            type="radio"
            name={id("owner-mode")}
            checked={mode === "keep"}
            onChange={() => setMode("keep")}
            disabled={locked}
          />
          <span className="dot" />
          <span>Leave the owner passcode as it is</span>
        </label>

        <label className="radio">
          <input
            type="radio"
            name={id("owner-mode")}
            checked={mode === "set"}
            onChange={() => setMode("set")}
            disabled={locked}
          />
          <span className="dot" />
          <span>{brand.hasOwner ? "Hand the drive over with a new one" : "Set an owner passcode"}</span>
        </label>

        {mode === "set" && (
          <div className="field" style={{ maxWidth: 320, marginLeft: 24 }}>
            <label htmlFor={id("owner-passcode")}>New owner passcode</label>
            <input
              id={id("owner-passcode")}
              className="input"
              type="text"
              autoComplete="off"
              value={passcode}
              onChange={(e) => setPasscode(e.target.value)}
              placeholder="What you will send the owner"
              disabled={locked}
            />
          </div>
        )}

        <label className="radio" style={{ opacity: brand.hasOwner ? 1 : 0.5 }}>
          <input
            type="radio"
            name={id("owner-mode")}
            checked={mode === "clear"}
            onChange={() => setMode("clear")}
            disabled={locked || !brand.hasOwner}
          />
          <span className="dot" />
          <span>Take the drive back — remove its owner passcode</span>
        </label>
      </div>

      {mode === "clear" && (
        <div style={{ marginTop: 10, fontSize: 13, opacity: 0.8 }}>
          The drive and everything in it stay exactly as they are. Nobody will be able to add or
          rename anything in it until you name the next owner.
        </div>
      )}

      {blank && (
        <div style={{ marginTop: 10, fontSize: 13, color: DANGER }}>
          Type the new owner passcode, or choose to leave the current one alone.
        </div>
      )}

      <div className="hr" style={{ margin: "22px 0 18px" }} />

      <div style={{ ...LABEL, marginBottom: 14 }}>How much it may store</div>

      <div style={{ display: "flex", gap: 26, flexWrap: "wrap", alignItems: "flex-start" }}>
        <div className="field" style={{ maxWidth: 200 }}>
          <label htmlFor={id("quota")}>Quota</label>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <input
              id={id("quota")}
              className="input"
              type="number"
              min="1"
              step="1"
              inputMode="decimal"
              value={form.quotaGb}
              onChange={(e) => set("quotaGb", e.target.value)}
              disabled={locked}
              style={{ width: 120 }}
            />
            <span style={{ fontSize: 13, opacity: 0.7 }}>GB</span>
          </div>
          <div style={{ marginTop: 6, fontSize: 12, opacity: 0.7 }}>
            {humanSizeTrim(member.usedBytes)} in use. This is the number the drive&rsquo;s own
            sidebar counts against, and uploads are refused once it is reached.
          </div>
        </div>

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
      </div>

      {badQuota && (
        <div style={{ marginTop: 10, fontSize: 13, color: DANGER }}>
          A quota has to be a positive number of gigabytes.
        </div>
      )}

      {belowUsed && (
        <div style={{ marginTop: 10, fontSize: 13, color: DANGER }}>
          {brand.name} already stores {humanSizeTrim(member.usedBytes)}. A quota under that would
          refuse every upload while the drive sat over a limit it was under a moment ago — raise
          the number, or have its owner clear some files first.
        </div>
      )}

      <div style={{ display: "flex", gap: 9, marginTop: 24, flexWrap: "wrap", alignItems: "center" }}>
        <button className="btn btn-primary" type="submit" disabled={locked || stopped}>
          <Icon name="edit" size={14} />
          {saving ? "Saving…" : "Save changes"}
        </button>
        <button className="btn btn-secondary" type="button" onClick={onCancel} disabled={locked}>
          Cancel
        </button>
        {/* Offered on every drive, not only an unowned one: an admin sometimes
            has to go in and fix something, and this is the honest way to do it
            — a seat taken deliberately rather than an admin who was quietly
            every drive's owner all along. */}
        <button
          className="btn btn-secondary"
          type="button"
          onClick={onTakeOver}
          disabled={locked}
          title="Hold this drive's owner seat yourself"
          style={{ marginLeft: "auto" }}
        >
          <Icon name="shield" size={14} />
          Take the owner&rsquo;s seat
        </button>
      </div>
    </form>
  );
}

/**
 * A new drive asks for as little as it can: a name, the address it will answer
 * at, whether it is open, and who is to run it. Everything else — the tagline,
 * the tab title, the numbering — has a sensible default and is the owner's to
 * judge once the drive exists and can be looked at.
 *
 * The owner is asked for here rather than left for later because a drive
 * without one is a drive nobody can put a folder in, and the admin who has
 * just made it is the only person who can fix that.
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
    ownerName?: string;
    ownerEmail?: string;
    ownerPasscode?: string;
    quotaBytes?: number;
  }) => Promise<boolean>;
  onCancel: () => void;
}) {
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [visibility, setVisibility] = useState<DriveVisibility>("public");
  const [passcode, setPasscode] = useState("");
  const [ownerName, setOwnerName] = useState("");
  const [ownerEmail, setOwnerEmail] = useState("");
  const [ownerPasscode, setOwnerPasscode] = useState("");
  const [quotaGb, setQuotaGb] = useState("200");
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
    const ownerSecret = ownerPasscode.trim();
    const gb = Number(quotaGb);
    await onCreate({
      name: name.trim(),
      slug: preview,
      visibility,
      // An empty passcode is left out entirely: the API reads its absence as
      // "no passcode", and refuses that on a private drive.
      ...(visibility === "private" && secret ? { passcode: secret } : {}),
      ...(ownerName.trim() ? { ownerName: ownerName.trim() } : {}),
      ...(ownerEmail.trim() ? { ownerEmail: ownerEmail.trim() } : {}),
      ...(ownerSecret ? { ownerPasscode: ownerSecret } : {}),
      // Left out when the field is empty or nonsense, so the drive takes the
      // default rather than being created with a quota nobody meant.
      ...(Number.isFinite(gb) && gb > 0 ? { quotaBytes: Math.round(gb * GIB) } : {}),
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
          <label htmlFor="new-drive-passcode">Reader passcode</label>
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
          <div style={{ marginTop: 6, fontSize: 12, opacity: 0.7 }}>
            What a reader is given. The owner can change it later from inside the drive.
          </div>
        </div>
      )}

      <div className="hr" style={{ margin: "22px 0 18px" }} />

      <div style={{ ...LABEL, marginBottom: 14 }}>Who will run it</div>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))",
          gap: 14,
        }}
      >
        <div className="field">
          <label htmlFor="new-drive-owner-name">Owner</label>
          <input
            id="new-drive-owner-name"
            className="input"
            value={ownerName}
            onChange={(e) => setOwnerName(e.target.value)}
            placeholder="Who the drive is for"
            disabled={locked}
          />
        </div>

        <div className="field">
          <label htmlFor="new-drive-owner-email">Owner email</label>
          <input
            id="new-drive-owner-email"
            className="input"
            type="email"
            value={ownerEmail}
            onChange={(e) => setOwnerEmail(e.target.value)}
            placeholder="Where to send the passcode"
            disabled={locked}
          />
        </div>

        <div className="field">
          <label htmlFor="new-drive-owner-passcode">Owner passcode</label>
          <input
            id="new-drive-owner-passcode"
            className="input"
            type="text"
            autoComplete="off"
            value={ownerPasscode}
            onChange={(e) => setOwnerPasscode(e.target.value)}
            placeholder="What its owner will sign in with"
            disabled={locked}
          />
        </div>

        <div className="field">
          <label htmlFor="new-drive-quota">Quota</label>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <input
              id="new-drive-quota"
              className="input"
              type="number"
              min="1"
              step="1"
              inputMode="decimal"
              value={quotaGb}
              onChange={(e) => setQuotaGb(e.target.value)}
              disabled={locked}
              style={{ width: 110 }}
            />
            <span style={{ fontSize: 13, opacity: 0.7 }}>GB</span>
          </div>
        </div>
      </div>

      {/*
        A drive with no owner passcode is a drive nobody can put a folder in,
        which is not a state worth reaching by leaving a field blank. It is
        still allowed — an admin may genuinely not know yet who a drive is for
        — but it is called out as the exception rather than described as an
        ordinary choice.
      */}
      {ownerPasscode.trim() ? (
        <p style={{ margin: "12px 0 0", fontSize: 12, opacity: 0.7, maxWidth: "62ch" }}>
          Send this to {ownerName.trim() || "its owner"}. They open the drive, click the padlock
          in its header, and from then on add their own folders — you never have to.
        </p>
      ) : (
        <p style={{ margin: "12px 0 0", fontSize: 12, color: DANGER, maxWidth: "62ch" }}>
          Without an owner passcode the drive exists but nobody can add a folder to it —
          including you, until you take its seat. Set one unless you mean to decide later.
        </p>
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
