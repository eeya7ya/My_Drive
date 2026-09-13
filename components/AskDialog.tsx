"use client";

/**
 * The app's own prompt and confirm, replacing the browser's.
 *
 * `window.prompt` and `window.confirm` work, and that is all that can be said
 * for them: they announce the hostname ("www.esparktools.com says"), they wear
 * the browser's chrome rather than the drive's, they cannot say which folder
 * is about to be deleted in anything but plain text, and on a phone they are a
 * system sheet dropped on top of an otherwise finished design. Naming a folder
 * is the most common thing anybody does in this drive; it should look like the
 * drive.
 *
 * Shaped from the same parts as everything else — the blueprint frame with its
 * registration marks, `.field` / `.input`, the accent rule, the one red for
 * destructive answers — so it reads as the same application rather than an
 * interruption from somewhere else.
 *
 * Kept faithful to what it replaces in the ways that matter:
 *
 *   - Escape cancels and Enter accepts, as in the native dialogs.
 *   - the text is selected when a prompt opens, so typing over a suggested
 *     name works exactly as it did.
 *   - it returns a promise resolving to the typed string, or null for cancel,
 *     so a call site reads the same as `window.prompt` did with an await in
 *     front of it.
 */

import React, { useEffect, useRef, useState } from "react";
import { Icon } from "./icons";
import { DANGER, DANGER_TEXT, TAGLINE } from "./Choice";

export interface AskRequest {
  kind: "prompt" | "confirm";
  /** The question. One line for a prompt; a sentence or two for a confirm. */
  title: string;
  /** Starting text, for a prompt. */
  value?: string;
  /** The word on the accepting button. Defaults to Save / OK. */
  confirmLabel?: string;
  /** Paints the accepting button red, for an answer that destroys something. */
  danger?: boolean;
}

export default function AskDialog({
  request,
  onAnswer,
}: {
  request: AskRequest;
  /** The typed text, or null when cancelled. A confirm answers "" or null. */
  onAnswer: (value: string | null) => void;
}) {
  const [value, setValue] = useState(request.value ?? "");
  const input = useRef<HTMLInputElement>(null);
  const accept = useRef<HTMLButtonElement>(null);

  // A prompt opens with its suggestion selected, so typing replaces it — the
  // behaviour of the native dialog, and the reason "New Folder" was ever a
  // useful default. A confirm has nothing to type, so the button takes focus
  // and the keyboard does not come up on a phone.
  useEffect(() => {
    if (request.kind === "prompt") input.current?.select();
    else accept.current?.focus();
  }, [request.kind]);

  // Escape cancels from anywhere in the dialog, as it does in the browser's.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onAnswer(null);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onAnswer]);

  const confirming = request.kind === "confirm";
  // A prompt with nothing in it has no answer to give, and the native dialog's
  // habit of returning an empty string only ever produced an error further on.
  const ready = confirming || value.trim().length > 0;

  return (
    <div
      // Pressing outside cancels, which is what tapping away from a sheet
      // means on a phone and costs nothing here — no answer is lost, because
      // there is nothing to lose until the button is pressed.
      onClick={() => onAnswer(null)}
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 120,
        background: "color-mix(in srgb, #1B1E20 68%, transparent)",
        display: "grid",
        placeItems: "center",
        padding: 20,
        animation: "pop .12s ease-out both",
      }}
    >
      <form
        onClick={(e) => e.stopPropagation()}
        onSubmit={(e) => {
          e.preventDefault();
          if (!ready) return;
          onAnswer(confirming ? "" : value.trim());
        }}
        role="dialog"
        aria-modal="true"
        aria-label={request.title}
        className="blueprint"
        style={{
          width: "100%",
          maxWidth: 400,
          padding: "26px 24px 24px",
          background: "var(--color-surface)",
        }}
      >
        <i className="corner tl" />
        <i className="corner tr" />
        <i className="corner bl" />
        <i className="corner br" />

        <div style={{ display: "flex", alignItems: "center", gap: 11, marginBottom: 6 }}>
          <div
            style={{
              width: 30,
              height: 30,
              flex: "none",
              display: "grid",
              placeItems: "center",
              border: "1px solid var(--color-divider)",
              color: request.danger ? DANGER : "var(--color-accent-700)",
            }}
          >
            <Icon name={request.danger ? "trash" : confirming ? "info" : "edit"} size={15} />
          </div>
          <div style={TAGLINE}>{confirming ? "Confirm" : "Name it"}</div>
        </div>

        <div
          style={{
            height: 2,
            width: 44,
            background: request.danger ? DANGER : "var(--color-accent)",
            margin: "10px 0 16px",
          }}
        />

        <p
          style={{
            margin: 0,
            fontSize: confirming ? 15 : 13,
            lineHeight: 1.5,
            color: confirming
              ? "var(--color-text)"
              : "color-mix(in srgb, var(--color-text) 65%, transparent)",
          }}
        >
          {request.title}
        </p>

        {!confirming && (
          <div className="field" style={{ marginTop: 14, marginBottom: 0 }}>
            <input
              ref={input}
              className="input"
              autoFocus
              value={value}
              onChange={(e) => setValue(e.target.value)}
              // A folder name is a proper noun more often than not, and a phone
              // that capitalises it and offers spelling corrections gets in the
              // way of both.
              autoComplete="off"
              autoCorrect="off"
              spellCheck={false}
            />
          </div>
        )}

        <div
          style={{
            display: "flex",
            gap: 9,
            marginTop: 20,
            flexWrap: "wrap",
            justifyContent: "flex-end",
          }}
        >
          <button className="btn btn-secondary" type="button" onClick={() => onAnswer(null)}>
            Cancel
          </button>
          <button
            ref={accept}
            className="btn btn-primary"
            type="submit"
            disabled={!ready}
            style={
              request.danger
                ? { background: DANGER, borderColor: DANGER, color: DANGER_TEXT }
                : undefined
            }
          >
            {request.danger && <Icon name="trash" size={14} />}
            {request.confirmLabel ?? (confirming ? "OK" : "Save")}
          </button>
        </div>
      </form>
    </div>
  );
}
