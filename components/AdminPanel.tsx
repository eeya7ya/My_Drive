"use client";

/**
 * The admin panel: users, and how much each drive may store.
 *
 * That is the whole of it, and the shortness is the point. The admin creates a
 * person, gives them a password, and says which drive is theirs. From then on
 * that person signs in on their own drive and does everything in it — adds
 * folders, renames them, uploads, manages revisions, edits the drive's name and
 * address — without coming back here. Nothing on this page adds a folder,
 * because adding folders is not the admin's job.
 *
 * It is an operator's tool, not a separate application, so it is assembled from
 * the same parts as everything else — blueprint frames with registration marks,
 * `.field` / `.input` controls, the letterspaced micro-label, the accent rule
 * under a heading. Somebody who arrives here from a drive should recognise
 * where they are.
 *
 * Two decisions shape the rest of the file. Every write sends only the fields
 * that actually changed and then calls router.refresh(), so the server render
 * stays the single copy of the truth; a panel that patched its own list would
 * drift from the database the first time a save half succeeded, and the admin
 * would have no way to tell. And a password is write-only everywhere: it is
 * never read back, never shown, and the form says so — the only thing anyone
 * can do with a forgotten password is replace it.
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
import { Brand, SITE, slugifyDrive } from "@/lib/brand";
import { humanSizeTrim } from "@/lib/types";
import type { DriveRequest } from "@/lib/drives";
import type { DriveUser } from "@/lib/users";
import type { DriveMember } from "@/lib/types";

/**
 * What the panel says after a write. A confirmation and a refusal share one
 * slot deliberately: whatever happened, the answer appears in the same place,
 * so there is no state in which the admin has to guess whether a change landed.
 */
type Note = { tone: "ok" | "bad"; text: string } | null;

/** One gibibyte, the unit the quota field is typed in. */
const GIB = 1024 * 1024 * 1024;

/** The body of a PATCH to /api/users. Absent means unchanged. */
interface UserPatch {
  name?: string;
  email?: string;
  driveKey?: string;
  password?: string;
}

/** The body of a PATCH to /api/drives/[key] that an admin may send. */
interface DrivePatch {
  listed?: boolean;
  quotaBytes?: number;
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
  users,
  requests,
}: {
  drives: Brand[];
  /** One entry per drive, in the same order: how full it is against its quota. */
  members: DriveMember[];
  /** Every user, across every drive. Grouped per drive for display. */
  users: DriveUser[];
  requests: DriveRequest[];
}) {
  const router = useRouter();

  // The drive keeps its light/dark choice in component state and writes it to
  // the body, which is where every token flips. This screen is a sibling of
  // that one, so it does exactly the same thing.
  const [theme, setTheme] = useState<"light" | "dark">("light");

  const [note, setNote] = useState<Note>(null);
  // The action in flight, if any. One at a time: a panel that could run two
  // writes against the same row would refresh into a result neither describes.
  const [busy, setBusy] = useState<string | null>(null);
  const [addingUser, setAddingUser] = useState(false);
  const [creatingDrive, setCreatingDrive] = useState(false);
  const [editingUser, setEditingUser] = useState<string | null>(null);
  const [editingDrive, setEditingDrive] = useState<string | null>(null);

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
  const nameOfDrive = new Map(drives.map((d) => [d.key, d.name]));
  // A drive nobody has been given is a drive nobody can add a folder to, which
  // is the one state on this page that needs acting on rather than reading.
  const unassigned = drives.filter((d) => !users.some((u) => u.driveKey === d.key));

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
            Users &amp; storage
          </h1>
          <div
            style={{
              height: 2,
              width: 58,
              background: "var(--color-accent)",
              animation: "sweepIn .55s cubic-bezier(.2,.7,.3,1) both",
            }}
          />
          <p style={{ margin: 0, fontSize: 15, opacity: 0.75, maxWidth: "66ch" }}>
            Create a user, give them a password, and say which drive is theirs. Send them the
            password and you are done: they sign in on their own drive and do everything in it —
            folders, files, revisions, and the drive&rsquo;s own name and address — without
            coming back here. The other half of this page is how much each drive may store.
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

        {/* ── users ────────────────────────────────────────────────────── */}

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
              Users
            </h2>
            <span style={LABEL}>
              {users.length === 0
                ? "None yet"
                : users.length === 1
                  ? "One user"
                  : `${users.length} users`}
            </span>
            <div style={{ marginLeft: "auto" }}>
              <button
                className="btn btn-primary"
                onClick={() => setAddingUser((v) => !v)}
                disabled={locked || drives.length === 0}
                title={drives.length === 0 ? "Add a drive first" : "Create a user"}
              >
                <Icon name={addingUser ? "close" : "plus"} size={14} />
                {addingUser ? "Cancel" : "New user"}
              </button>
            </div>
          </div>

          {/* The one thing on this page that is actually broken, said once at
              the top rather than repeated on every drive's row below. */}
          {unassigned.length > 0 && (
            <div
              style={{
                display: "flex",
                alignItems: "flex-start",
                gap: 9,
                marginBottom: 16,
                padding: "10px 13px",
                fontSize: 13,
                border: `1px solid color-mix(in srgb, ${DANGER} 45%, transparent)`,
                background: `color-mix(in srgb, ${DANGER} 7%, transparent)`,
                color: DANGER,
              }}
            >
              <Icon name="info" size={15} style={{ flex: "none", marginTop: 2 }} />
              <span>
                {unassigned.map((d) => d.name).join(", ")}{" "}
                {unassigned.length === 1 ? "has" : "have"} no user yet, so nobody can add a
                folder there — not even you. Create one against{" "}
                {unassigned.length === 1 ? "it" : "each"} below.
              </span>
            </div>
          )}

          {addingUser && (
            <UserForm
              drives={drives}
              locked={locked}
              busy={busy === "create-user"}
              submitLabel="Create the user"
              onSubmit={async (body) => {
                const done = await call(
                  "create-user",
                  "/api/users",
                  {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify(body),
                  },
                  `Created ${body.name ?? "the user"}. Send them their password — they sign in at /${
                    drives.find((d) => d.key === body.driveKey)?.slug ?? ""
                  } and the drive is theirs.`
                );
                if (done) setAddingUser(false);
                return done;
              }}
              onCancel={() => setAddingUser(false)}
            />
          )}

          {users.length === 0 && !addingUser ? (
            <p style={{ margin: 0, fontSize: 14, opacity: 0.75 }}>
              Nobody can change anything in any drive until a user exists. The first one takes a
              name, a password, and the drive it is for.
            </p>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              {users.map((user) => (
                <UserRow
                  key={user.id}
                  user={user}
                  driveName={nameOfDrive.get(user.driveKey) ?? user.driveKey}
                  drives={drives}
                  open={editingUser === user.id}
                  locked={locked}
                  savingId={busy}
                  onToggle={() => setEditingUser(editingUser === user.id ? null : user.id)}
                  onSave={async (patch) => {
                    if (Object.keys(patch).length === 0) {
                      setNote({ tone: "ok", text: "Nothing to save — no field changed." });
                      return true;
                    }
                    const done = await call(
                      `user:${user.id}`,
                      `/api/users/${encodeURIComponent(user.id)}`,
                      {
                        method: "PATCH",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify(patch),
                      },
                      patch.password
                        ? `Saved ${patch.name ?? user.name}. Send them the new password — the old one stopped working just now.`
                        : `Saved ${patch.name ?? user.name}.`
                    );
                    if (done) setEditingUser(null);
                    return done;
                  }}
                  onDelete={() =>
                    call(
                      `user-delete:${user.id}`,
                      `/api/users/${encodeURIComponent(user.id)}`,
                      { method: "DELETE" },
                      `Removed ${user.name}. Their drive and everything in it is untouched.`
                    )
                  }
                />
              ))}
            </div>
          )}
        </section>

        <div className="hr" style={{ margin: "44px 0 28px" }} />

        {/* ── drives ───────────────────────────────────────────────────── */}

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
                className="btn btn-secondary"
                onClick={() => setCreatingDrive((v) => !v)}
                disabled={locked}
              >
                <Icon name={creatingDrive ? "close" : "plus"} size={14} />
                {creatingDrive ? "Cancel" : "New drive"}
              </button>
            </div>
          </div>

          <p style={{ margin: "0 0 18px", fontSize: 13, opacity: 0.75, maxWidth: "66ch" }}>
            A drive added here appears on the dashboard straight away — no deploy. Its key is
            fixed at creation because every folder and file row carries it. What you set here is
            its storage limit and whether the dashboard names it; everything else about a drive —
            its name, tagline, address, numbering — belongs to its users and is changed from
            inside the drive.
          </p>

          {creatingDrive && (
            <CreateDrive
              locked={locked}
              busy={busy === "create-drive"}
              onCreate={async (body) => {
                const done = await call(
                  "create-drive",
                  "/api/drives",
                  {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify(body),
                  },
                  `Created ${body.name} at /${body.slug}. Now create a user for it, or nobody can put anything in it.`
                );
                if (done) setCreatingDrive(false);
                return done;
              }}
              onCancel={() => setCreatingDrive(false)}
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
                    users: 0,
                    usedBytes: 0,
                    quotaBytes: 200 * GIB,
                  }
                }
                open={editingDrive === brand.key}
                locked={locked}
                savingId={busy}
                onToggle={() =>
                  setEditingDrive(editingDrive === brand.key ? null : brand.key)
                }
                onSave={async (patch) => {
                  if (Object.keys(patch).length === 0) {
                    setNote({ tone: "ok", text: "Nothing to save — no field changed." });
                    return true;
                  }
                  const done = await call(
                    `drive:${brand.key}`,
                    `/api/drives/${encodeURIComponent(brand.key)}`,
                    {
                      method: "PATCH",
                      headers: { "Content-Type": "application/json" },
                      body: JSON.stringify(patch),
                    },
                    `Saved ${brand.name}.`
                  );
                  if (done) setEditingDrive(null);
                  return done;
                }}
                onDelete={() =>
                  call(
                    `drive-delete:${brand.key}`,
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

        {/* ── requests ─────────────────────────────────────────────────── */}

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
            its own. The grant is creating the person a user above and sending them their
            password.
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
                        ? `Marked ${request.name}'s request approved. Create them a user above.`
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

/* ── users ───────────────────────────────────────────────────────────────── */

/**
 * One person: their name, the drive that is theirs, and how to reach them. The
 * form is mounted only while it is open, so every time it opens it is seeded
 * from the freshest server data rather than from whatever was typed and
 * abandoned an hour ago.
 */
function UserRow({
  user,
  driveName,
  drives,
  open,
  locked,
  savingId,
  onToggle,
  onSave,
  onDelete,
}: {
  user: DriveUser;
  driveName: string;
  drives: Brand[];
  open: boolean;
  locked: boolean;
  savingId: string | null;
  onToggle: () => void;
  onSave: (patch: UserPatch) => Promise<boolean>;
  onDelete: () => Promise<boolean>;
}) {
  const [confirming, setConfirming] = useState(false);
  // Setting a password has its own control rather than living only inside the
  // edit form. It is the thing an admin comes to this row to do — somebody has
  // forgotten theirs, or is being handed the drive — and burying it behind a
  // button labelled "Edit" meant it read as though there was no way to do it.
  const [settingPassword, setSettingPassword] = useState(false);
  const [password, setPassword] = useState("");
  const deleting = savingId === `user-delete:${user.id}`;
  const saving = savingId === `user:${user.id}`;
  const drive = drives.find((d) => d.key === user.driveKey);

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
          <Icon name="cap" size={16} />
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
            {user.name}
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
            <span style={{ opacity: 0.75 }}>
              runs <strong style={{ opacity: 0.9 }}>{driveName}</strong>
            </span>
            {drive && <a href={drive.basePath}>{drive.basePath}</a>}
            {user.email && (
              <a href={`mailto:${user.email}`} style={{ opacity: 0.75 }}>
                {user.email}
              </a>
            )}
          </div>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
          <button
            className="btn btn-secondary"
            onClick={() => {
              setSettingPassword((v) => !v);
              setPassword("");
            }}
            disabled={locked}
            aria-expanded={settingPassword}
            title={`Give ${user.name} a new password`}
          >
            <Icon name={settingPassword ? "close" : "lock"} size={14} />
            {settingPassword ? "Cancel" : "Set password"}
          </button>
          <button
            className="btn btn-secondary btn-icon"
            onClick={onToggle}
            disabled={locked}
            aria-expanded={open}
            title="Edit this user's name, email or drive"
            aria-label="Edit this user"
          >
            <Icon name={open ? "close" : "edit"} size={15} />
          </button>
          <button
            className="btn btn-secondary btn-icon"
            onClick={() => setConfirming(true)}
            disabled={locked || confirming}
            title="Remove this user"
            aria-label="Remove this user"
            style={{ color: DANGER }}
          >
            <Icon name="trash" size={15} />
          </button>
        </div>
      </div>

      {settingPassword && (
        <form
          onSubmit={async (ev) => {
            ev.preventDefault();
            // Trimmed here because the sign-in page trims what is typed and the
            // server compares hashes exactly: a password saved with a space
            // around it could never be entered again.
            const next = password.trim();
            if (!next) return;
            const done = await onSave({ password: next });
            if (done) {
              setSettingPassword(false);
              setPassword("");
            }
          }}
          style={{
            display: "flex",
            alignItems: "flex-end",
            gap: 12,
            flexWrap: "wrap",
            padding: "14px 16px",
            borderTop: "1px solid var(--color-divider)",
            background: "color-mix(in srgb, var(--color-accent) 5%, transparent)",
            animation: "pop .12s ease-out both",
          }}
        >
          <div className="field" style={{ flex: 1, minWidth: 240, marginBottom: 0 }}>
            <label htmlFor={`pw-${user.id}`}>New password for {user.name}</label>
            <input
              id={`pw-${user.id}`}
              className="input"
              type="text"
              autoComplete="off"
              autoFocus
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="What you will send them"
              disabled={locked}
            />
          </div>
          <button className="btn btn-primary" type="submit" disabled={locked || !password.trim()}>
            <Icon name="lock" size={14} />
            {saving ? "Saving…" : "Set it"}
          </button>
          <p style={{ flexBasis: "100%", margin: 0, fontSize: 12, opacity: 0.7 }}>
            Copy it before you save — it is stored hashed and can never be read back, only
            replaced. Setting it signs {user.name} out of the drive straight away, and the old
            password stops working at once.
          </p>
        </form>
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
            Remove {user.name}? Their password stops working at once. {driveName} and everything
            in it stays exactly as it is — only the person goes.
          </span>
          <button
            className="btn btn-secondary"
            onClick={() => setConfirming(false)}
            disabled={deleting}
          >
            Keep them
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
            {deleting ? "Removing…" : "Remove the user"}
          </button>
        </div>
      )}

      {open && (
        <UserForm
          drives={drives}
          user={user}
          locked={locked}
          busy={savingId === `user:${user.id}`}
          submitLabel="Save changes"
          onSubmit={onSave}
          onCancel={onToggle}
        />
      )}
    </div>
  );
}

/**
 * One form for creating a user and for editing one, because they ask for the
 * same four things and a second copy would drift.
 *
 * The password is the field worth looking at. On a new user it is required —
 * a user who cannot sign in is a note to self, not an account. On an existing
 * one it is a replacement or nothing: the stored hash cannot be turned back
 * into a password, so there is nothing to prefill and nothing to show, and the
 * form says that rather than presenting an empty box that might mean "blank it".
 */
function UserForm({
  drives,
  user,
  locked,
  busy,
  submitLabel,
  onSubmit,
  onCancel,
}: {
  drives: Brand[];
  /** Absent when creating. */
  user?: DriveUser;
  locked: boolean;
  busy: boolean;
  submitLabel: string;
  /**
   * Creating sends all four fields; editing sends only what changed, so two
   * admins editing two fields of the same user do not overwrite each other.
   */
  onSubmit: (body: UserPatch) => Promise<boolean>;
  onCancel: () => void;
}) {
  const [name, setName] = useState(user?.name ?? "");
  const [email, setEmail] = useState(user?.email ?? "");
  const [driveKey, setDriveKey] = useState(user?.driveKey ?? drives[0]?.key ?? "");
  const [password, setPassword] = useState("");

  const editing = Boolean(user);
  const id = (field: string) => `user-${user?.id ?? "new"}-${field}`;
  const drive = drives.find((d) => d.key === driveKey);

  // What is trimmed here is trimmed on the server too, and the server compares
  // hashes exactly — a password saved with a space around it could never be
  // typed back in.
  const cleanName = name.trim();
  const cleanPassword = password.trim();
  const ready = Boolean(cleanName && driveKey && (editing || cleanPassword));

  async function submit(ev: React.FormEvent) {
    ev.preventDefault();
    if (!ready) return;

    if (!user) {
      await onSubmit({
        name: cleanName,
        email: email.trim(),
        driveKey,
        password: cleanPassword,
      });
      return;
    }

    const patch: UserPatch = {};
    if (cleanName !== user.name) patch.name = cleanName;
    if (email.trim() !== user.email) patch.email = email.trim();
    if (driveKey !== user.driveKey) patch.driveKey = driveKey;
    // An empty box means "keep the current password", which is the only
    // reading that does not risk blanking somebody's access by accident.
    if (cleanPassword) patch.password = cleanPassword;
    await onSubmit(patch);
  }

  return (
    <form
      onSubmit={submit}
      className={editing ? undefined : "blueprint"}
      style={{
        padding: editing ? "20px 16px 22px" : "26px 24px",
        marginBottom: editing ? 0 : 20,
        maxWidth: editing ? undefined : 660,
        borderTop: editing ? "1px solid var(--color-divider)" : undefined,
        background: editing
          ? "color-mix(in srgb, var(--color-accent) 4%, var(--color-surface))"
          : "var(--color-surface)",
        animation: "pop .12s ease-out both",
      }}
    >
      {!editing && (
        <>
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
            A new user
          </div>
          <div style={{ ...TAGLINE, marginTop: 2 }}>They run one drive, on their own</div>
          <div
            style={{
              height: 2,
              width: 58,
              background: "var(--color-accent)",
              margin: "16px 0 22px",
            }}
          />
        </>
      )}

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
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Who they are"
            autoFocus={!editing}
            disabled={locked}
          />
        </div>

        <div className="field">
          <label htmlFor={id("email")}>Email</label>
          <input
            id={id("email")}
            className="input"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="Optional — where to send the password"
            disabled={locked}
          />
        </div>

        <div className="field">
          <label htmlFor={id("drive")}>Their drive</label>
          <select
            id={id("drive")}
            className="input"
            value={driveKey}
            onChange={(e) => setDriveKey(e.target.value)}
            disabled={locked}
          >
            {drives.map((d) => (
              <option key={d.key} value={d.key}>
                {d.name}
              </option>
            ))}
          </select>
          {drive && (
            <div style={{ marginTop: 6, fontSize: 12, opacity: 0.7 }}>
              They sign in at <strong>{drive.basePath}</strong> and manage everything there. Their
              password does nothing on any other drive.
            </div>
          )}
        </div>

        <div className="field">
          <label htmlFor={id("password")}>{editing ? "New password" : "Password"}</label>
          <input
            id={id("password")}
            className="input"
            type="text"
            autoComplete="off"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder={editing ? "Leave empty to keep the current one" : "What you will send them"}
            disabled={locked}
          />
          <div style={{ marginTop: 6, fontSize: 12, opacity: 0.7 }}>
            {editing
              ? "Stored hashed and never readable, so a forgotten password is replaced rather than looked up. Setting a new one signs them out of the drive straight away."
              : "Shown here once. It is stored hashed and cannot be read back afterwards, so copy it before you save."}
          </div>
        </div>
      </div>

      <div style={{ display: "flex", gap: 9, marginTop: 22, flexWrap: "wrap" }}>
        <button className="btn btn-primary" type="submit" disabled={locked || !ready}>
          <Icon name={editing ? "edit" : "plus"} size={14} />
          {busy ? "Saving…" : submitLabel}
        </button>
        <button className="btn btn-secondary" type="button" onClick={onCancel} disabled={locked}>
          Cancel
        </button>
      </div>
    </form>
  );
}

/* ── drives ──────────────────────────────────────────────────────────────── */

/**
 * One drive at rest: what it is called, where it answers, how full it is, and
 * how many people run it. Its name and address are shown but not editable —
 * those belong to its users and are changed from inside the drive.
 */
function DriveRow({
  brand,
  member,
  open,
  locked,
  savingId,
  onToggle,
  onSave,
  onDelete,
}: {
  brand: Brand;
  member: DriveMember;
  open: boolean;
  locked: boolean;
  savingId: string | null;
  onToggle: () => void;
  onSave: (patch: DrivePatch) => Promise<boolean>;
  onDelete: () => Promise<boolean>;
}) {
  const [confirming, setConfirming] = useState(false);
  const deleting = savingId === `drive-delete:${brand.key}`;

  const full = member.quotaBytes > 0 ? member.usedBytes / member.quotaBytes : 0;
  // Three bands rather than a gradient: the bar is read at a glance, and what
  // it has to answer is "is this drive fine, filling up, or a problem".
  const barColour =
    full >= 0.9 ? DANGER : full >= 0.7 ? "var(--color-accent-600)" : "var(--color-accent)";

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
          <Icon name="drive" size={16} />
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
            <span style={{ opacity: member.users ? 0.75 : 1, color: member.users ? undefined : DANGER }}>
              {member.users === 0
                ? "no user"
                : member.users === 1
                  ? "1 user"
                  : `${member.users} users`}
            </span>
          </div>
        </div>

        {/* Storage, as the number and the bar the drive's own sidebar shows.
            It is half of what this panel manages, so it sits in the row rather
            than behind the form. */}
        <div style={{ width: 168, flex: "none" }}>
          <div
            style={{ fontSize: 12, display: "flex", justifyContent: "space-between", gap: 8 }}
          >
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
            {open ? "Close" : "Storage"}
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
            its users go with it, and {brand.basePath} stops answering. A drive that still holds
            anything is refused.
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
        <DriveStorage
          brand={brand}
          member={member}
          locked={locked}
          saving={savingId === `drive:${brand.key}`}
          onSave={onSave}
          onCancel={onToggle}
        />
      )}
    </div>
  );
}

/**
 * The two things about a drive that are the admin's: how much it may hold, and
 * whether the dashboard names it.
 *
 * Everything else a drive has — its name, tagline, tab title, address,
 * numbering, the passcode a visitor is given — used to live in this form, and
 * moving it into the drive is the point: the person who uses a drive should not
 * have to ask the person who minds the quotas to rename a folder.
 */
function DriveStorage({
  brand,
  member,
  locked,
  saving,
  onSave,
  onCancel,
}: {
  brand: Brand;
  member: DriveMember;
  locked: boolean;
  saving: boolean;
  onSave: (patch: DrivePatch) => Promise<boolean>;
  onCancel: () => void;
}) {
  // Trailing zeros are trimmed so a round 200 GB reads as "200" rather than
  // "200.00", and a quota that is not a whole number of GB still round-trips.
  const [quotaGb, setQuotaGb] = useState(() =>
    String(Number((member.quotaBytes / GIB).toFixed(2)))
  );
  const [listed, setListed] = useState(brand.listed);

  const id = (field: string) => `drive-${brand.key}-${field}`;

  const gb = Number(quotaGb);
  const badQuota = quotaGb.trim() !== "" && (!Number.isFinite(gb) || gb <= 0);
  // The server refuses a quota below what the drive already holds; saying so
  // here means the admin sees it while the number is still in front of them.
  const belowUsed =
    !badQuota && Number.isFinite(gb) && gb > 0 && Math.round(gb * GIB) < member.usedBytes;
  const stopped = badQuota || belowUsed;

  async function submit(ev: React.FormEvent) {
    ev.preventDefault();
    if (stopped) return;

    const patch: DrivePatch = {};
    if (listed !== brand.listed) patch.listed = listed;
    // Compared in bytes rather than in the typed text, so re-saving a form that
    // was never touched sends nothing even though "200" and "200.00" differ.
    if (Number.isFinite(gb) && gb > 0) {
      const bytes = Math.round(gb * GIB);
      if (bytes !== member.quotaBytes) patch.quotaBytes = bytes;
    }
    await onSave(patch);
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
      <div style={{ ...LABEL, marginBottom: 14 }}>How much it may store</div>

      <div style={{ display: "flex", gap: 26, flexWrap: "wrap", alignItems: "flex-start" }}>
        <div className="field" style={{ maxWidth: 220 }}>
          <label htmlFor={id("quota")}>Quota</label>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <input
              id={id("quota")}
              className="input"
              type="number"
              min="1"
              step="1"
              inputMode="decimal"
              value={quotaGb}
              onChange={(e) => setQuotaGb(e.target.value)}
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
            value={listed ? "listed" : "unlisted"}
            disabled={locked}
            onChange={(next) => setListed(next === "listed")}
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
          the number, or have its users clear some files first.
        </div>
      )}

      <p style={{ margin: "18px 0 0", fontSize: 12, opacity: 0.65, maxWidth: "62ch" }}>
        The drive&rsquo;s name, tagline, address, numbering and the passcode a visitor is given
        are its users&rsquo;, and are changed from inside the drive.
      </p>

      <div style={{ display: "flex", gap: 9, marginTop: 22, flexWrap: "wrap" }}>
        <button className="btn btn-primary" type="submit" disabled={locked || stopped}>
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
 * easier to judge once the drive exists and its user can look at it.
 */
function CreateDrive({
  locked,
  busy,
  onCreate,
  onCancel,
}: {
  locked: boolean;
  busy: boolean;
  onCreate: (body: { name: string; slug: string }) => Promise<boolean>;
  onCancel: () => void;
}) {
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  // The address follows the name until the admin writes one themselves, after
  // which typing the name no longer rewrites what they chose.
  const [slugTouched, setSlugTouched] = useState(false);

  // slugifyDrive answers "drive" for an empty string, which on an untouched
  // form would put an address nobody chose in the field and promise /drive
  // underneath it. Nothing is slugified until there is something to slugify.
  const typed = (slugTouched ? slug : name).trim();
  const preview = typed ? slugifyDrive(typed) : "";

  async function submit(ev: React.FormEvent) {
    ev.preventDefault();
    await onCreate({ name: name.trim(), slug: preview });
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
          same word — permanently, since every folder and file will carry it. Its user can move
          the address later; the key never changes.
        </div>
      </div>

      <p style={{ margin: "18px 0 0", fontSize: 12, opacity: 0.7, maxWidth: "62ch" }}>
        Every drive sits behind a sign-in. This one has nobody who can get into it yet — create
        a user against it next, and send them their password.
      </p>

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
