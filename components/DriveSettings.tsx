"use client";

/**
 * The drive's own settings, over the drive they belong to.
 *
 * This is the half of the old admin panel that was never really the admin's:
 * what the drive is called, the line under the name, the address it answers
 * on, whether its folders are numbered. All of that is the drive, and the
 * drive belongs to whoever runs it — which is whoever is in it. What stayed
 * behind at /admin is the level above: which drives exist, who may enter each
 * one, and how much each may store.
 *
 * There is no sign-in here. There was, briefly, and it was wrong: it asked the
 * person whose drive it is for a second passcode the admin had to issue them
 * first, which is the dependency this split exists to remove. If you can open
 * the drive, it is yours to change, so the panel opens straight into the
 * settings.
 *
 * It is a panel over the drive rather than a page of its own for two reasons.
 * The owner is already looking at the drive these settings describe, and the
 * drive's own URL space is a tree of folder names: a /manage segment would
 * quietly shadow any folder somebody named "manage".
 */

import React, { useState } from "react";
import { Icon } from "./icons";
import Choice, { DANGER, GROUP, GROUP_LABEL, LABEL, TAGLINE } from "./Choice";
import { Brand, slugifyDrive } from "@/lib/brand";

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
}

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
  };
}

/**
 * The difference between the drive as it is and the form as it stands. Sending
 * the whole form instead would work, but it would also rewrite fields nobody
 * touched — and with two tabs open, that quietly reverts the other one's edit.
 */
function patchFor(brand: Brand, form: Form): Patch {
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

  return patch;
}

export default function DriveSettings({
  brand,
  onClose,
}: {
  brand: Brand;
  onClose: () => void;
}) {
  const [form, setForm] = useState<Form>(() => formOf(brand));
  const [note, setNote] = useState<{ tone: "ok" | "bad"; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const id = (field: string) => `drive-${brand.key}-${field}`;
  const set = <K extends keyof Form>(field: K, value: Form[K]) =>
    setForm((prev) => ({ ...prev, [field]: value }));

  const preview = slugifyDrive(form.slug.trim());

  async function save(ev: React.FormEvent) {
    ev.preventDefault();

    const patch = patchFor(brand, form);
    if (Object.keys(patch).length === 0) {
      setNote({ tone: "ok", text: "Nothing to save — no field changed." });
      return;
    }

    setBusy(true);
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
      setBusy(false);
    }
  }

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
      <form
        onSubmit={save}
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label={`Settings for ${brand.name}`}
        style={{
          width: "min(760px, 100%)",
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
            <Icon name="drive" size={16} />
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
            <div style={TAGLINE}>Drive settings</div>
          </div>
          <button
            className="btn btn-secondary btn-icon"
            type="button"
            onClick={onClose}
            title="Close"
            aria-label="Close"
          >
            <Icon name="close" size={15} />
          </button>
        </header>

        <div style={{ padding: "20px 18px 22px" }}>
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
                disabled={busy}
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
                disabled={busy}
              />
            </div>

            <div className="field">
              <label htmlFor={id("title")}>Browser tab title</label>
              <input
                id={id("title")}
                className="input"
                value={form.title}
                onChange={(e) => set("title", e.target.value)}
                disabled={busy}
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
                disabled={busy}
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
                disabled={busy}
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
                disabled={busy}
              />
            </div>

            <div className="field">
              <label htmlFor={id("slug")}>Address</label>
              <input
                id={id("slug")}
                className="input"
                value={form.slug}
                onChange={(e) => set("slug", e.target.value)}
                disabled={busy}
              />
              <div style={{ marginTop: 6, fontSize: 12, opacity: 0.7 }}>
                The drive answers at <strong>/{preview}</strong>. Renaming it keeps the old
                address working, so links already shared still land, and the drive&rsquo;s key
                ({brand.key}) never changes whatever the address becomes.
              </div>
            </div>
          </div>

          <div className="hr" style={{ margin: "22px 0 18px" }} />

          <div style={{ ...LABEL, marginBottom: 14 }}>Folders</div>

          <fieldset style={GROUP}>
            <legend style={GROUP_LABEL}>Numbering</legend>
            <Choice
              name={id("numbered")}
              value={form.numbered ? "numbered" : "plain"}
              disabled={busy}
              onChange={(next) => set("numbered", next === "numbered")}
              options={[
                { value: "plain", label: "Plain" },
                { value: "numbered", label: "Numbered" },
              ]}
            />
          </fieldset>

          {/*
            Who may enter the drive, and how much it may hold, are not here.
            They are the admin's — the first is how somebody is let into this
            drive in the first place, and a drive's user quietly changing the
            lock on a drive they were let into is not part of running it.
            Saying so is better than leaving a reader to wonder where the
            controls went.
          */}
          <p style={{ margin: "18px 0 0", fontSize: 12, opacity: 0.65, maxWidth: "62ch" }}>
            Whether this drive is private, who holds its passcode, whether the dashboard lists
            it, and how much it may store are set by the admin. Everything above is yours.
          </p>

          <div className="hr" style={{ margin: "22px 0 18px" }} />

          <div style={{ display: "flex", gap: 9, flexWrap: "wrap", alignItems: "center" }}>
            <button className="btn btn-primary" type="submit" disabled={busy}>
              <Icon name="edit" size={14} />
              {busy ? "Saving…" : "Save changes"}
            </button>
            <button
              className="btn btn-secondary"
              type="button"
              onClick={onClose}
              disabled={busy}
            >
              Cancel
            </button>
          </div>
        </div>
      </form>
    </div>
  );
}
