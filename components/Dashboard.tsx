"use client";

/**
 * The dashboard — the site's front door.
 *
 * A drive used to be the whole site: whatever the address, you landed inside
 * one. Now the root names them all, so this page has to do in a single screen
 * what a drive's sidebar does over a whole session — say whose drive it is and
 * what it holds — before the visitor has committed to opening anything. Each
 * card therefore repeats the sidebar's own block, the name over a letterspaced
 * tagline, so a drive is recognisable the moment it opens rather than looking
 * like somewhere else entirely.
 *
 * A drive whose only question is whether to open it is one large link; a locked
 * one, and an unlocked private one that can also hand its pass back, are panels
 * with labelled controls instead. The distinction is deliberate: a card that
 * navigated straight to a passcode prompt would read as having opened the drive
 * and then changed its mind, and a button buried inside a card-sized link has no
 * honest way to be pressed. Both shapes sit in the same grid, so what differs is
 * only what can be clicked.
 */

import React, { useEffect, useRef, useState } from "react";
import { Icon } from "./icons";
import { SITE } from "@/lib/brand";
import { DriveCard } from "@/lib/types";

/** The design's recurring micro-label: 11px, uppercase, letterspaced, accent. */
const LABEL: React.CSSProperties = {
  fontSize: 11,
  letterSpacing: ".12em",
  textTransform: "uppercase",
  color: "var(--color-accent-700)",
};

/** The sidebar's small line under a drive's name, at card scale. */
const TAGLINE: React.CSSProperties = {
  fontSize: 10,
  letterSpacing: ".18em",
  textTransform: "uppercase",
  color: "var(--color-accent-700)",
};

export default function Dashboard({
  drives,
  isAdmin,
}: {
  drives: DriveCard[];
  isAdmin: boolean;
}) {
  // The drive keeps its light/dark choice in component state and writes it to
  // the body, which is where every token flips. The dashboard is a sibling
  // screen, not a second app, so it does exactly the same thing.
  const [theme, setTheme] = useState<"light" | "dark">("light");

  const [driveChoice, setDriveChoice] = useState("");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState<string | null>(null);

  const formRef = useRef<HTMLFormElement>(null);
  const nameRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    document.body.setAttribute("data-theme", theme);
  }, [theme]);

  /**
   * "Request access" on a card is the same form as the one at the foot of the
   * page — it only arrives with the drive already chosen, so nobody has to
   * find their drive again in a list they just clicked.
   */
  function askFor(card: DriveCard) {
    setDriveChoice(card.key);
    setSent(null);
    setError(null);
    formRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
    nameRef.current?.focus({ preventScroll: true });
  }

  async function submit(ev: React.FormEvent) {
    ev.preventDefault();
    setBusy(true);
    setError(null);
    setSent(null);
    try {
      const res = await fetch("/api/requests", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          // The empty option means "a drive of my own", which the API reads as
          // a request attached to no existing drive.
          driveKey: driveChoice || null,
          name,
          email,
          note,
        }),
      });
      const body: { error?: string } = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body?.error || "Could not send the request");
      const asked = drives.find((d) => d.key === driveChoice);
      setSent(asked ? asked.name : "a drive of your own");
      // Only a request that actually landed is cleared; a failed one keeps
      // everything typed so it can be sent again without being retyped.
      setName("");
      setEmail("");
      setNote("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not send the request");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{ minHeight: "100vh", display: "flex", flexDirection: "column" }}>
      <header
        className="dc-header dc-pad"
        style={{
          display: "flex",
          alignItems: "center",
          gap: 14,
          padding: "16px 27px",
          borderBottom: "1px solid var(--color-divider)",
          flexWrap: "wrap",
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 12,
            marginRight: "auto",
          }}
        >
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
            <Icon name="hdd" size={17} />
          </div>
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
        </div>

        <button
          className="btn btn-secondary btn-icon"
          onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
          title="Toggle dark mode"
          aria-label="Toggle dark mode"
        >
          {theme === "dark" ? <Icon name="sun" size={15} /> : <Icon name="moon" size={15} />}
        </button>

        {isAdmin ? (
          <a className="btn btn-secondary" href="/admin" title="Admin panel">
            <Icon name="shield" size={14} />
            Admin
          </a>
        ) : (
          <a
            className="btn btn-secondary btn-icon"
            href="/admin/login?next=%2F"
            title="Admin sign in"
            aria-label="Admin sign in"
          >
            <Icon name="lock" size={15} />
          </a>
        )}
      </header>

      <main
        className="dc-pad"
        style={{
          flex: 1,
          width: "100%",
          maxWidth: 1120,
          margin: "0 auto",
          padding: "36px 27px 56px",
        }}
      >
        <div style={{ display: "flex", flexDirection: "column", gap: 10, marginBottom: 34 }}>
          <h1 className="dc-title" style={{ margin: 0, fontSize: 42 }}>
            {SITE.title}
          </h1>
          <div
            style={{
              height: 2,
              width: 58,
              background: "var(--color-accent)",
              animation: "sweepIn .55s cubic-bezier(.2,.7,.3,1) both",
            }}
          />
          <p style={{ margin: 0, fontSize: 15, opacity: 0.75, maxWidth: "62ch" }}>
            {SITE.description}
          </p>
        </div>

        {drives.length === 0 ? (
          <div
            className="blueprint"
            style={{
              padding: "26px 24px",
              background: "var(--color-surface)",
              maxWidth: 560,
            }}
          >
            <i className="corner tl" />
            <i className="corner tr" />
            <i className="corner bl" />
            <i className="corner br" />
            <div style={{ ...LABEL, marginBottom: 8 }}>Nothing here yet</div>
            <p style={{ margin: 0, fontSize: 14, opacity: 0.8 }}>
              {isAdmin
                ? "No drives exist yet. The admin panel creates the first one — it takes a name and nothing else."
                : "No drives are listed. Ask below and the request goes to the admin."}
            </p>
            {isAdmin && (
              <a className="btn btn-secondary" href="/admin" style={{ marginTop: 16 }}>
                <Icon name="plus" size={14} />
                Create a drive
              </a>
            )}
          </div>
        ) : (
          <>
            <div style={{ ...LABEL, marginBottom: 12 }}>
              {drives.length === 1 ? "One drive" : `${drives.length} drives`}
            </div>
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fill, minmax(min(100%, 268px), 1fr))",
                gap: 20,
              }}
            >
              {drives.map((d, i) => (
                <DriveTile
                  key={d.key}
                  drive={d}
                  isAdmin={isAdmin}
                  delay={`${i * 45}ms`}
                  onRequest={() => askFor(d)}
                />
              ))}
            </div>
          </>
        )}

        <div className="hr" style={{ margin: "44px 0 28px" }} />

        <form
          ref={formRef}
          onSubmit={submit}
          className="blueprint"
          style={{
            padding: "30px 28px",
            background: "var(--color-surface)",
            maxWidth: 560,
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
            Ask for access
          </div>
          <div style={{ ...TAGLINE, marginTop: 2 }}>The admin decides</div>
          <div
            style={{
              height: 2,
              width: 58,
              background: "var(--color-accent)",
              margin: "16px 0 22px",
            }}
          />

          <div className="field" style={{ marginBottom: 14 }}>
            <label htmlFor="req-drive">Which drive</label>
            <select
              id="req-drive"
              className="input"
              value={driveChoice}
              onChange={(e) => setDriveChoice(e.target.value)}
            >
              <option value="">A drive of my own</option>
              {drives.map((d) => (
                <option key={d.key} value={d.key}>
                  {d.name}
                </option>
              ))}
            </select>
          </div>

          <div className="field" style={{ marginBottom: 14 }}>
            <label htmlFor="req-name">Your name</label>
            <input
              id="req-name"
              ref={nameRef}
              className="input"
              type="text"
              autoComplete="name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Who is asking"
            />
          </div>

          <div className="field" style={{ marginBottom: 14 }}>
            <label htmlFor="req-email">Email</label>
            <input
              id="req-email"
              className="input"
              type="email"
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="Where the answer should go"
            />
          </div>

          <div className="field">
            <label htmlFor="req-note">Note (optional)</label>
            <textarea
              id="req-note"
              className="input"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Anything the admin should know"
            />
          </div>

          {error && (
            <div style={{ marginTop: 12, fontSize: 12, color: "#c0492f" }} role="alert">
              {error}
            </div>
          )}

          {sent && (
            <div
              style={{ marginTop: 12, fontSize: 12, color: "var(--color-accent-700)" }}
              role="status"
            >
              Sent — your request for {sent} is with the admin.
            </div>
          )}

          <button
            className="btn btn-primary btn-block"
            type="submit"
            disabled={busy || !name.trim() || !email.trim()}
            style={{ marginTop: 18, justifyContent: "center" }}
          >
            <Icon name="upload" size={14} />
            {busy ? "Sending…" : "Send request"}
          </button>
        </form>
      </main>
    </div>
  );
}

/**
 * One drive in the grid. The card is the link when opening it is the only thing
 * on offer, and a plain panel carrying its own controls when it is not — see the
 * note at the top of the file for why the two are not the same shape.
 */
function DriveTile({
  drive,
  isAdmin,
  delay,
  onRequest,
}: {
  drive: DriveCard;
  isAdmin: boolean;
  delay: string;
  onRequest: () => void;
}) {
  const isPrivate = drive.visibility === "private";
  // A private drive with no passcode set has no way in at all, so offering to
  // enter one would send the visitor to a door that cannot open.
  const shut = isPrivate && !drive.unlocked && !drive.hasPasscode;

  const [locking, setLocking] = useState(false);
  const [lockError, setLockError] = useState<string | null>(null);

  /**
   * The pass is a thirty-day cookie, and this card is the only place a viewer
   * ever sees they are still holding one, so it is also where they can give it
   * back. A reload afterwards is deliberate: whether a drive is open is decided
   * on the server, and asking again is the only way to be sure the page and the
   * cookie agree. Only a failure lets the button go live again — a call that
   * worked is replaced by the reload, and re-enabling it first would flicker.
   */
  async function lockAgain() {
    setLocking(true);
    setLockError(null);
    try {
      const res = await fetch(`/api/drives/${encodeURIComponent(drive.key)}/unlock`, {
        method: "DELETE",
      });
      const body: { error?: string } = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body?.error || "Could not lock this drive again");
      window.location.reload();
    } catch (e) {
      setLockError(e instanceof Error ? e.message : "Could not lock this drive again");
      setLocking(false);
    }
  }

  const badges = (
    <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap", justifyContent: "flex-end" }}>
      {isPrivate &&
        (drive.unlocked ? (
          <span className="tag tag-accent" style={{ fontSize: 10 }}>
            Open
          </span>
        ) : (
          <span
            className="tag tag-outline"
            style={{ fontSize: 10, display: "inline-flex", alignItems: "center", gap: 5 }}
          >
            <Icon name="lock" size={10} />
            Private
          </span>
        ))}
      {/* Only the admin is shown a drive the dashboard hides, so the marker
          tells them which of these rows the public is not seeing. */}
      {isAdmin && !drive.listed && (
        <span className="tag tag-outline" style={{ fontSize: 10 }}>
          Unlisted
        </span>
      )}
    </div>
  );

  const identity = (
    <div>
      <div
        style={{
          fontFamily: "var(--font-heading)",
          fontWeight: 600,
          fontSize: 21,
          lineHeight: 1.1,
          letterSpacing: ".02em",
        }}
      >
        {drive.name}
      </div>
      {drive.tagline && <div style={{ ...TAGLINE, marginTop: 3 }}>{drive.tagline}</div>}
      {drive.description && (
        <p style={{ margin: "10px 0 0", fontSize: 13, opacity: 0.75, lineHeight: 1.5 }}>
          {drive.description}
        </p>
      )}
    </div>
  );

  const head = (
    <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 10 }}>
      <div
        style={{
          width: 46,
          height: 46,
          flex: "none",
          display: "grid",
          placeItems: "center",
          background: "var(--color-accent-100)",
          color: "var(--color-accent-700)",
          border: "1px solid var(--color-accent-300)",
        }}
      >
        <Icon name={isPrivate && !drive.unlocked ? "lock" : "drive"} size={22} />
      </div>
      {badges}
    </div>
  );

  if (isPrivate && drive.unlocked) {
    return (
      <div className="dc-card" style={{ animationDelay: delay, cursor: "default" }}>
        {head}
        {identity}
        {lockError && (
          <div style={{ fontSize: 12, color: "#c0492f" }} role="alert">
            {lockError}
          </div>
        )}
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: "auto" }}>
          <a className="btn btn-primary" href={drive.basePath}>
            Open drive
            <Icon name="chevron" size={13} />
          </a>
          <button
            type="button"
            className="btn btn-secondary"
            onClick={lockAgain}
            disabled={locking}
            title="Hand this drive's pass back"
          >
            <Icon name="logout" size={13} />
            {locking ? "Locking…" : "Lock again"}
          </button>
        </div>
      </div>
    );
  }

  if (drive.unlocked) {
    return (
      <a
        className="dc-card"
        href={drive.basePath}
        style={{ animationDelay: delay, textDecoration: "none", color: "inherit" }}
      >
        {head}
        {identity}
        <div
          style={{
            ...LABEL,
            marginTop: "auto",
            display: "flex",
            alignItems: "center",
            gap: 6,
          }}
        >
          Open drive
          <Icon name="chevron" size={12} />
        </div>
      </a>
    );
  }

  return (
    <div className="dc-card" style={{ animationDelay: delay, cursor: "default" }}>
      {head}
      {identity}
      {shut && (
        <div style={{ fontSize: 12, opacity: 0.65 }}>
          This drive has no passcode yet, so asking is the only way in.
        </div>
      )}
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: "auto" }}>
        {!shut && (
          // The drive's own address serves the unlock screen, so the locked
          // card and the drive link go to exactly the same place — one route,
          // one code path, whichever way the visitor arrives.
          <a className="btn btn-primary" href={drive.basePath}>
            <Icon name="lock" size={13} />
            Enter passcode
          </a>
        )}
        <button type="button" className="btn btn-secondary" onClick={onRequest}>
          Request access
        </button>
      </div>
    </div>
  );
}
