"use client";

/**
 * The page a drive shows instead of itself, until somebody signs in.
 *
 * Every drive has one. You are given a link and a password; the link brings you
 * here, the password takes you in, and once you are in the drive is yours — add,
 * rename, delete, upload, whatever you like. There is no version of this where a
 * link alone is enough, and no second, weaker password that would let somebody
 * look without touching. One door, one password, everything behind it.
 *
 * It is deliberately the twin of the admin sign-in card — same blueprint frame,
 * same registration marks, same field and button grammar — because the two
 * screens ask the same thing and should not feel like they came from different
 * sites. What it must not do is leak: a drive is allowed to say its name and its
 * tagline and nothing else, so there is no count of files, no folder list, no
 * hint of what is behind the password. The drive's identity is worn only so that
 * somebody who was handed a password can tell they are at the right door.
 *
 * A wrong password is a near miss far more often than a wrong person, so the
 * field keeps what was typed and the server's own message is shown as-is rather
 * than being softened into something unhelpful.
 */

import React, { useState } from "react";
import { Icon } from "./icons";
import { Brand } from "@/lib/brand";

export default function DriveSignIn({
  brand,
  next,
}: {
  brand: Brand;
  /** Where the visitor was heading — the deep link they arrived on. */
  next: string;
}) {
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // A deep link is worth honouring, but an empty one must still land somewhere,
  // and the drive's own root is the only address we know is inside it.
  const target = next || brand.basePath;

  async function submit(ev: React.FormEvent) {
    ev.preventDefault();
    setBusy(true);
    setError(null);
    try {
      // A pasted password usually carries the whitespace it was copied with,
      // and the server compares exactly, so the trim happens before it is sent.
      const res = await fetch(`/api/drives/${encodeURIComponent(brand.key)}/signin`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password: password.trim() }),
      });
      const body: { error?: string } = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body?.error || "That password was not accepted");
      window.location.href = target;
    } catch (e) {
      setError(e instanceof Error ? e.message : "That password was not accepted");
      setBusy(false);
    }
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
              {brand.tagline || "Sign in"}
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
          Enter your password to open this drive. Everything inside is yours — add folders,
          upload, rename, delete.
        </p>

        <form onSubmit={submit}>
          <div className="field">
            <label htmlFor="drive-password">Password</label>
            <input
              id="drive-password"
              className="input"
              type="password"
              autoComplete="current-password"
              autoFocus
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="The password you were given"
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
            disabled={busy || !password.trim()}
            style={{ marginTop: 18, justifyContent: "center" }}
          >
            <Icon name="lock" size={14} />
            {busy ? "Signing in…" : "Sign in"}
          </button>
        </form>

        <div style={{ marginTop: 18, fontSize: 12, opacity: 0.7 }}>
          {/* The dashboard is where the request form lives, so asking for
              access is a trip back to the front door rather than a second form
              kept in sync with it. */}
          Don&apos;t have one? <a href="/">Ask for access</a>
        </div>

        {/* The admin does not get in through here — they create the users and
            hand out the passwords, and looking inside a drive means being one
            of its users. This link is to their own panel, not a way around
            this one. */}
        <a
          href="/admin/login?next=%2Fadmin"
          style={{
            display: "inline-block",
            marginTop: 10,
            fontSize: 12,
            opacity: 0.55,
          }}
        >
          Admin? The panel is over here
        </a>
      </div>
    </div>
  );
}
