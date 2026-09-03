"use client";

/**
 * Admin sign-in. Built entirely from the Industry design system's own
 * grammar — a blueprint-framed card with registration marks, `.field` /
 * `.input` for the control, `.btn-primary` for the action — so it reads as
 * part of the drive rather than a bolted-on page.
 */

import React, { useState } from "react";
import { Icon } from "./icons";
import { Brand, DEFAULT_BRAND } from "@/lib/brand";

export default function LoginForm({
  brand = DEFAULT_BRAND,
}: {
  brand?: Brand;
}) {
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(ev: React.FormEvent) {
    ev.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body?.error || "Sign in failed");
      window.location.href = "/";
    } catch (e) {
      setError(e instanceof Error ? e.message : "Sign in failed");
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
          <div
            style={{
              width: 44,
              height: 44,
              flex: "none",
              display: "grid",
              placeItems: "center",
            }}
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              className="brand-bright"
              src="/assets/espark-bright.png"
              alt="eSpark"
              style={{
                gridArea: "1/1",
                width: "100%",
                height: "100%",
                objectFit: "contain",
              }}
            />
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              className="brand-dark"
              src="/assets/espark-dark.png"
              alt="eSpark"
              style={{
                gridArea: "1/1",
                width: "100%",
                height: "100%",
                objectFit: "contain",
              }}
            />
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
              Admin Panel
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

        <form onSubmit={submit}>
          <div className="field">
            <label htmlFor="admin-password">Password</label>
            <input
              id="admin-password"
              className="input"
              type="password"
              autoComplete="current-password"
              autoFocus
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Enter the admin password"
            />
          </div>

          {error && (
            <div style={{ marginTop: 12, fontSize: 12, color: "#c0492f" }}>
              {error}
            </div>
          )}

          <button
            className="btn btn-primary btn-block"
            type="submit"
            disabled={busy || !password}
            style={{ marginTop: 18, justifyContent: "center" }}
          >
            <Icon name="lock" size={14} />
            {busy ? "Signing in…" : "Sign in"}
          </button>
        </form>

        <a
          href="/"
          style={{
            display: "inline-block",
            marginTop: 18,
            fontSize: 12,
            opacity: 0.7,
          }}
        >
          ← Back to the drive
        </a>
      </div>
    </div>
  );
}
