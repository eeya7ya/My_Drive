"use client";

/**
 * The drive owner's panel, over the drive it belongs to.
 *
 * This is the half of the old admin panel that was never really the admin's:
 * what the drive is called, the line under the name, the address it answers
 * on, whether its folders are numbered, and the passcode its readers are
 * given. All of that is the drive, and the drive belongs to whoever runs it.
 * What stayed behind at /admin is the level above — which drives exist, who
 * owns each one, and how much each may store.
 *
 * It is a panel over the drive rather than a page of its own for two reasons.
 * The owner is already looking at the drive these settings describe, and the
 * drive's own URL space is a tree of folder names: a /manage segment would
 * quietly shadow any folder somebody named "manage".
 *
 * Two states, one component, because they are two halves of one errand —
 * "let me run this drive" and "here is the drive to run":
 *
 *   - not signed in: ask for the owner passcode. No shortcut for the admin —
 *     they set that passcode, and if they need to work inside the drive they
 *     use it like anybody else.
 *   - signed in: the settings, and the way back out of the seat.
 */

import React, { useState } from "react";
import { Icon } from "./icons";
import Choice, { DANGER, GROUP, GROUP_LABEL, LABEL, TAGLINE } from "./Choice";
import { Brand, DriveVisibility, slugifyDrive } from "@/lib/brand";

/** A drive's editable identity in the shape the controls hold it. */
interface Form {
  name: string;
  tagline: string;
  title: string;
  shortName: string;
  description: string;
  slug: string;
  numbered: boolean;
  poweredBy: string;
  visibility: DriveVisibility;
}

/** The body of a PATCH: absent means unchanged, so every field is optional. */
interface Patch {
  name?: string;
  tagline?: string;
  title?: string;
  shortName?: string;
  description?: string;
  slug?: string;
  numbered?: boolean;
  poweredBy?: string | null;
  visibility?: DriveVisibility;
  passcode?: string | null;
}

/** The three things an owner can mean by touching the readers' passcode. */
type PasscodeMode = "keep" | "set" | "clear";

function formOf(brand: Brand): Form {
  return {
    name: brand.name,
    tagline: brand.tagline,
    title: brand.title,
    shortName: brand.shortName,
    description: brand.description,
    slug: brand.slug,
    numbered: brand.numbered,
    poweredBy: brand.poweredBy ?? "",
    visibility: brand.visibility,
  };
}

/**
 * The difference between the drive as it is and the form as it stands. Sending
 * the whole form instead would work, but it would also rewrite fields nobody
 * touched — and with two tabs open, that quietly reverts the other one's edit.
 */
function patchFor(
  brand: Brand,
  form: Form,
  mode: PasscodeMode,
  passcode: string
): Patch {
  const patch: Patch = {};

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

  if (form.visibility !== brand.visibility) patch.visibility = form.visibility;

  // The unlock form trims what the visitor types and the server compares the
  // hashes exactly, so a passcode saved with a space around it could never be
  // entered again. It is trimmed on the way in as well, and the two ends agree.
  if (mode === "set") patch.passcode = passcode.trim();
  if (mode === "clear") patch.passcode = null;

  return patch;
}

export default function DriveSettings({
  brand,
  isUser,
  userName,
  isAdmin,
  onClose,
}: {
  brand: Brand;
  /** Whether this viewer is already signed in as one of the drive's users. */
  isUser: boolean;
  /** Who they are signed in as, shown so they can tell which account is open. */
  userName: string | null;
  /** Only decides whether the note about where passwords come from is shown. */
  isAdmin: boolean;
  onClose: () => void;
}) {
  return (
    <div
      onClick={onClose}
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 95,
        background: "color-mix(in srgb, #1B1E20 68%, transparent)",
        display: "grid",
        placeItems: "center",
        padding: 24,
        overflow: "auto",
        animation: "pop .12s ease-out both",
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label={isUser ? `Settings for ${brand.name}` : `Sign in to ${brand.name}`}
        style={{
          width: isUser ? "min(760px, 100%)" : "min(420px, 100%)",
          maxHeight: "100%",
          overflow: "auto",
          background: "var(--color-surface)",
          border: "1px solid var(--color-divider)",
          borderTop: "2px solid var(--color-accent)",
          boxShadow: "var(--shadow-lg)",
        }}
      >
        <header
          style={{
            display: "flex",
            alignItems: "center",
            gap: 12,
            padding: "14px 18px",
            borderBottom: "1px solid var(--color-divider)",
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
            <Icon name={isUser ? "drive" : "lock"} size={16} />
          </div>
          <div style={{ marginRight: "auto", minWidth: 0 }}>
            <div
              style={{
                fontFamily: "var(--font-heading)",
                fontWeight: 600,
                fontSize: 18,
                lineHeight: 1.15,
                letterSpacing: ".01em",
              }}
            >
              {brand.name}
            </div>
            <div style={TAGLINE}>
              {isUser ? (userName ?? "Drive settings") : "Sign in"}
            </div>
          </div>
          <button
            className="btn btn-secondary btn-icon"
            onClick={onClose}
            title="Close"
            aria-label="Close"
          >
            <Icon name="close" size={15} />
          </button>
        </header>

        {isUser ? (
          <DriveForm brand={brand} onClose={onClose} />
        ) : (
          <SignIn brand={brand} isAdmin={isAdmin} />
        )}
      </div>
    </div>
  );
}

/* ── signing in ──────────────────────────────────────────────────────────── */

/**
 * The owner's door, drawn as the twin of the private drive's passcode wall —
 * same field grammar, same wording of a refusal — because the two ask the same
 * thing of a person and differ only in what they hand back.
 *
 * A successful sign-in reloads rather than updating state in place. The page
 * was server-rendered for somebody who could not manage this drive; every
 * control that should now appear is decided on the server, so asking for the
 * page again is both simpler and the only thing that cannot disagree with it.
 */
function SignIn({ brand, isAdmin }: { brand: Brand; isAdmin: boolean }) {
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function send(body: Record<string, unknown>) {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/drives/${encodeURIComponent(brand.key)}/signin`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const answer: { error?: string } = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(answer?.error || "That password was not accepted");
      window.location.reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : "That password was not accepted");
      setBusy(false);
    }
  }

  return (
    <div style={{ padding: "20px 18px 22px" }}>
      <p style={{ margin: "0 0 16px", fontSize: 13, opacity: 0.75 }}>
        Adding folders, renaming and deleting belong to this drive&rsquo;s own users. Enter your
        password to sign in and manage {brand.name}.
      </p>

      {true && (
        <form
          onSubmit={(ev) => {
            ev.preventDefault();
            // Trimmed before sending, because the server compares hashes
            // exactly and a pasted code carries the whitespace it was copied
            // with.
            if (password.trim()) void send({ password: password.trim() });
          }}
        >
          <div className="field">
            <label htmlFor="drive-password">Your password</label>
            <input
              id="drive-password"
              className="input"
              type="password"
              autoComplete="current-password"
              autoFocus
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="The password the admin gave you"
              disabled={busy}
            />
          </div>

          <button
            className="btn btn-primary btn-block"
            type="submit"
            disabled={busy || !password.trim()}
            style={{ marginTop: 16, justifyContent: "center" }}
          >
            <Icon name="lock" size={14} />
            {busy ? "Signing in…" : "Sign in"}
          </button>
        </form>
      )}

      {error && (
        <div style={{ marginTop: 12, fontSize: 12, color: DANGER }} role="alert">
          {error}
        </div>
      )}

      {isAdmin && (
        <>
          <div className="hr" style={{ margin: "20px 0 14px" }} />
          <p style={{ margin: 0, fontSize: 12, opacity: 0.7 }}>
            You are signed in as the admin, which is not the same as running this drive. You set
            its owner passcode — in{" "}
            <a href="/admin" style={{ textDecoration: "underline" }}>
              the admin panel
            </a>{" "}
            — so if you need to work inside the drive yourself, use it here like anybody else.
          </p>
        </>
      )}
    </div>
  );
}

/* ── the settings themselves ─────────────────────────────────────────────── */

function DriveForm({ brand, onClose }: { brand: Brand; onClose: () => void }) {
  const [form, setForm] = useState<Form>(() => formOf(brand));
  const [mode, setMode] = useState<PasscodeMode>("keep");
  const [passcode, setPasscode] = useState("");
  const [note, setNote] = useState<{ tone: "ok" | "bad"; text: string } | null>(null);
  const [busy, setBusy] = useState<"save" | "leave" | null>(null);

  const id = (field: string) => `owner-${brand.key}-${field}`;
  const set = <K extends keyof Form>(field: K, value: Form[K]) =>
    setForm((prev) => ({ ...prev, [field]: value }));

  const preview = slugifyDrive(form.slug.trim());

  // "Set a passcode" with the box left empty would reach the API as an empty
  // string, which it reads as "clear it" — the exact accident this control was
  // shaped to prevent. So the save waits rather than guessing which was meant.
  const blank = mode === "set" && !passcode.trim();

  // Clearing the passcode on a drive that stays private leaves it with no door
  // at all, and the API refuses exactly that. The form refuses it first, since
  // a disabled button reads as a choice still to be made and a failed save
  // reads as something having gone wrong. The visibility read here is the one
  // the form is holding rather than the saved one, so clearing the passcode and
  // making the drive public in the same edit remains a legitimate thing to do.
  const shutOut = mode === "clear" && form.visibility === "private";

  async function save(ev: React.FormEvent) {
    ev.preventDefault();
    if (blank || shutOut) return;

    const patch = patchFor(brand, form, mode, passcode);
    if (Object.keys(patch).length === 0) {
      setNote({ tone: "ok", text: "Nothing to save — no field changed." });
      return;
    }

    setBusy("save");
    setNote(null);
    try {
      const res = await fetch(`/api/drives/${encodeURIComponent(brand.key)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      });
      const answer: { error?: string } = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(answer?.error || "That change did not go through.");

      // A renamed drive answers somewhere else now, so the browser is sent to
      // the new address rather than left on one that would redirect. Everything
      // else is a reload, because the identity on screen — the sidebar name,
      // the tab title, the numbering — was server-rendered from the row that
      // just changed.
      if (patch.slug && patch.slug !== brand.slug) window.location.href = `/${patch.slug}`;
      else window.location.reload();
    } catch (e) {
      setNote({
        tone: "bad",
        text: e instanceof Error ? e.message : "That change did not go through.",
      });
      setBusy(null);
    }
  }

  async function leave() {
    setBusy("leave");
    setNote(null);
    try {
      const res = await fetch(`/api/drives/${encodeURIComponent(brand.key)}/signin`, {
        method: "DELETE",
      });
      if (!res.ok) throw new Error("Could not step out of the owner's seat.");
      window.location.reload();
    } catch (e) {
      setNote({
        tone: "bad",
        text: e instanceof Error ? e.message : "Could not sign out.",
      });
      setBusy(null);
    }
  }

  const locked = busy !== null;

  return (
    <form onSubmit={save} style={{ padding: "20px 18px 22px" }}>
      {note && (
        <div
          role={note.tone === "bad" ? "alert" : "status"}
          style={{
            marginBottom: 18,
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
          {note.text}
        </div>
      )}

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
            The drive answers at <strong>/{preview}</strong>. Renaming it keeps the old address
            working, so links already shared still land, and the drive&rsquo;s key ({brand.key})
            never changes whatever the address becomes.
          </div>
        </div>
      </div>

      <div className="hr" style={{ margin: "22px 0 18px" }} />

      <div style={{ ...LABEL, marginBottom: 14 }}>Who sees it</div>

      <div style={{ display: "flex", gap: 26, flexWrap: "wrap", alignItems: "flex-start" }}>
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

      <p style={{ margin: "14px 0 0", fontSize: 12, opacity: 0.65, maxWidth: "62ch" }}>
        Whether the dashboard lists this drive, and how much it may store, are set by the admin —
        those are about the drive&rsquo;s place among the others rather than about the drive.
      </p>

      <div className="hr" style={{ margin: "22px 0 18px" }} />

      <div style={{ ...LABEL, marginBottom: 6 }}>Reader passcode</div>
      <p style={{ margin: "0 0 12px", fontSize: 13, opacity: 0.75, maxWidth: "62ch" }}>
        {brand.hasPasscode
          ? "This drive has a passcode. It is stored hashed and cannot be read back, only replaced or removed. It opens the drive for reading — it does not hand over these settings."
          : "This drive has no passcode. A private drive needs one before anyone but you can open it."}
      </p>

      <div
        role="radiogroup"
        aria-label="Reader passcode"
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
              placeholder="What you will send the reader"
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

      <div className="hr" style={{ margin: "22px 0 18px" }} />

      <div style={{ display: "flex", gap: 9, flexWrap: "wrap", alignItems: "center" }}>
        <button className="btn btn-primary" type="submit" disabled={locked || blank || shutOut}>
          <Icon name="edit" size={14} />
          {busy === "save" ? "Saving…" : "Save changes"}
        </button>
        <button className="btn btn-secondary" type="button" onClick={onClose} disabled={locked}>
          Cancel
        </button>
        <button
          className="btn btn-secondary"
          type="button"
          onClick={leave}
          disabled={locked}
          title="Sign out of this drive on this device"
          style={{ marginLeft: "auto" }}
        >
          <Icon name="logout" size={14} />
          {busy === "leave" ? "Signing out…" : "Sign out"}
        </button>
      </div>
    </form>
  );
}
