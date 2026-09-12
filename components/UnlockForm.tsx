"use client";

/**
 * The passcode gate a private drive shows instead of itself.
 *
 * It is deliberately the twin of the admin sign-in card — same blueprint
 * frame, same registration marks, same field and button grammar — because the
 * two screens ask the same thing of a visitor and should not feel like they
 * came from different sites. What it must not do is leak: a locked drive is
 * allowed to say its name and its tagline and nothing else, so there is no
 * count of files, no folder list, no hint of what is behind the code. The
 * drive's identity is worn only so that someone who was handed a passcode can
 * tell they are at the right door.
 *
 * A wrong code is a near miss far more often than a wrong person, so the field
 * keeps what was typed and the server's own message is shown as-is rather than
 * being softened into something unhelpful.
 *
 * One card, two keys. A private drive's own owner arrives at this wall like
 * everybody else, and the settings panel they would otherwise sign in through
 * is behind it — so the form flips to ask for the owner passcode instead, and
 * posts to the owner's door rather than the reader's. Which one is being asked
 * for is always stated, because the two grant very different things and being
 * handed the wrong one is the ordinary mistake here.
 */

import React, { useState } from "react";
import { Icon } from "./icons";
import { Brand } from "@/lib/brand";

export default function UnlockForm({
  brand,
  next,
}: {
  brand: Brand;
  /** Where the visitor was heading — the deep link they arrived on. */
  next: string;
}) {
  const [passcode, setPasscode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  /** Whether the field is asking for the owner's passcode rather than a reader's. */
  const [asOwner, setAsOwner] = useState(false);

  // A deep link is worth honouring, but an empty one must still land somewhere,
  // and the drive's own root is the only address we know is inside it.
  const target = next || brand.basePath;

  async function submit(ev: React.FormEvent) {
    ev.preventDefault();
    setBusy(true);
    setError(null);
    try {
      // A pasted code usually carries the whitespace it was copied with, and
      // the server compares exactly, so the trim happens before it is sent.
      const res = await fetch(
        `/api/drives/${encodeURIComponent(brand.key)}/${asOwner ? "owner" : "unlock"}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ passcode: passcode.trim() }),
        },
      );
      const body: { error?: string } = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body?.error || "That passcode was not accepted");
      window.location.href = target;
    } catch (e) {
      setError(e instanceof Error ? e.message : "That passcode was not accepted");
      setBusy(false);
    }
  }

  /** Swapping keys clears the field and the refusal that belonged to the other one. */
  function swap(next: boolean) {
    setAsOwner(next);
    setPasscode("");
    setError(null);
  }

  return (
    <div
      style={{
        minHeight: "100vh",
        display: "grid",
        placeItems: "center",
        padding: 24,
      }}
    >
      <div
        className="blueprint"
        style={{
          width: "100%",
          maxWidth: 380,
          padding: "36px 34px",
          background: "var(--color-surface)",
        }}
      >
        <i className="corner tl" />
        <i className="corner tr" />
        <i className="corner bl" />
        <i className="corner br" />

        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 12,
            marginBottom: 26,
          }}
        >
          {/* A drive carries no logo of its own, so the padlock stands in for
              one — framed on the same hairline the card is drawn with. */}
          <div
            style={{
              width: 34,
              height: 34,
              flex: "none",
              display: "grid",
              placeItems: "center",
              border: "1px solid var(--color-divider)",
              color: "var(--color-accent-700)",
            }}
          >
            <Icon name="lock" size={16} />
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
              {brand.name}
            </div>
            <div
              style={{
                fontSize: 10,
                letterSpacing: ".18em",
                textTransform: "uppercase",
                color: "var(--color-accent-700)",
              }}
            >
              {asOwner ? "Owner sign in" : brand.tagline || "Private drive"}
            </div>
          </div>
        </div>

        <div
          style={{
            height: 2,
            width: 58,
            background: "var(--color-accent)",
            marginBottom: 22,
          }}
        />

        <p
          style={{
            fontSize: 13,
            marginBottom: 18,
            color: "color-mix(in srgb, var(--color-text) 65%, transparent)",
          }}
        >
          {asOwner
            ? "Enter this drive's owner passcode to open it and manage what is in it."
            : "This drive is private. Enter its passcode to open it."}
        </p>

        <form onSubmit={submit}>
          <div className="field">
            <label htmlFor="drive-passcode">
              {asOwner ? "Owner passcode" : "Passcode"}
            </label>
            <input
              id="drive-passcode"
              className="input"
              type="password"
              autoComplete="current-password"
              autoFocus
              value={passcode}
              onChange={(e) => setPasscode(e.target.value)}
              placeholder={
                asOwner ? "What the admin sent you" : "Enter the drive passcode"
              }
            />
          </div>

          {error && (
            <div
              style={{ marginTop: 12, fontSize: 12, color: "var(--color-danger)" }}
              role="alert"
            >
              {error}
            </div>
          )}

          <button
            className="btn btn-primary btn-block"
            type="submit"
            disabled={busy || !passcode.trim()}
            style={{ marginTop: 18, justifyContent: "center" }}
          >
            <Icon name={asOwner ? "drive" : "lock"} size={14} />
            {busy
              ? asOwner
                ? "Signing in…"
                : "Unlocking…"
              : asOwner
                ? "Sign in as owner"
                : "Unlock"}
          </button>
        </form>

        <div style={{ marginTop: 18, fontSize: 12, opacity: 0.7 }}>
          {/* The dashboard is where the request form lives, so asking for
              access is a trip back to the front door rather than a second
              form kept in sync with it. */}
          Don&apos;t have it? <a href="/">Ask for access</a>
        </div>

        {/* A button rather than a link: it changes which door this form knocks
            on, and goes nowhere. Offered even on a drive with no owner set —
            the reply says so, and hiding it would tell a stranger which drives
            are unclaimed. */}
        <button
          type="button"
          onClick={() => swap(!asOwner)}
          style={{
            display: "inline-block",
            marginTop: 10,
            padding: 0,
            fontSize: 12,
            opacity: 0.55,
            background: "transparent",
            border: "none",
            color: "var(--color-accent)",
            cursor: "pointer",
            textDecoration: "underline",
          }}
        >
          {asOwner
            ? "Not the owner? Use the reader passcode"
            : "Own this drive? Sign in to manage it"}
        </button>
      </div>
    </div>
  );
}
