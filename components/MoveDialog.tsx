"use client";

/**
 * "Move to…" — pick the folder a file should live in.
 *
 * The same frame as AskDialog, because it is the same kind of question: one
 * answer, Escape or a tap outside to back out. What it asks for is a place
 * rather than a word, so instead of a text field it shows the drive's folders
 * as an indented outline, with the file's current folder marked and not
 * choosable. A filter at the top narrows a long tree to the folders whose
 * names match, each shown with the path above it so two "Testing" folders can
 * still be told apart.
 */

import React, { useEffect, useMemo, useState } from "react";
import { Icon } from "./icons";
import { TAGLINE } from "./Choice";
import type { TreeNode } from "@/lib/types";

interface Row {
  /** null is the drive's root. */
  id: string | null;
  label: string;
  depth: number;
  icon: string;
  /** The labels above it, for telling apart matches when filtering. */
  trail: string[];
}

export default function MoveDialog({
  fileName,
  tree,
  rootLabel,
  labelOf,
  currentFolderId,
  onAnswer,
}: {
  fileName: string;
  tree: TreeNode[];
  rootLabel: string;
  labelOf: (n: TreeNode) => string;
  /** Where the file is now; null for the root. */
  currentFolderId: string | null;
  /** The chosen folder id (null for the root), or undefined when cancelled. */
  onAnswer: (folderId: string | null | undefined) => void;
}) {
  const [query, setQuery] = useState("");
  // Nothing is chosen at first: the file's own folder is the one place it
  // cannot go, and preselecting anything else would be a guess.
  const [choice, setChoice] = useState<string | null | undefined>(undefined);

  const rows = useMemo(() => {
    const out: Row[] = [{ id: null, label: rootLabel, depth: 0, icon: "hdd", trail: [] }];
    const walk = (nodes: TreeNode[], depth: number, trail: string[]) => {
      for (const n of nodes) {
        const label = labelOf(n);
        out.push({ id: n.id, label, depth, icon: n.icon || "folder", trail });
        walk(n.children, depth + 1, [...trail, label]);
      }
    };
    walk(tree, 1, [rootLabel]);
    return out;
  }, [tree, rootLabel, labelOf]);

  const q = query.trim().toLowerCase();
  const shown = q ? rows.filter((r) => r.label.toLowerCase().includes(q)) : rows;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onAnswer(undefined);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onAnswer]);

  const ready = choice !== undefined && choice !== currentFolderId;

  return (
    <div
      onClick={() => onAnswer(undefined)}
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 120,
        background: "color-mix(in srgb, #1B1E20 68%, transparent)",
        display: "grid",
        // A fixed track rather than an auto one: the ellipsised path over a
        // filtered match is nowrap, and an auto track grew to fit it, pushing
        // the dialog off the side of a phone.
        gridTemplateColumns: "minmax(0, 1fr)",
        placeItems: "center",
        padding: 20,
        animation: "pop .12s ease-out both",
      }}
    >
      <form
        onClick={(e) => e.stopPropagation()}
        onSubmit={(e) => {
          e.preventDefault();
          if (ready) onAnswer(choice);
        }}
        role="dialog"
        aria-modal="true"
        aria-label={`Move ${fileName}`}
        className="blueprint"
        style={{
          width: "100%",
          maxWidth: 440,
          maxHeight: "calc(100svh - 40px)",
          display: "flex",
          flexDirection: "column",
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
              color: "var(--color-accent-700)",
            }}
          >
            <Icon name="folder" size={15} />
          </div>
          <div style={TAGLINE}>Move to</div>
        </div>

        <div
          style={{
            height: 2,
            width: 44,
            background: "var(--color-accent)",
            margin: "10px 0 16px",
          }}
        />

        <p
          style={{
            margin: 0,
            fontSize: 13,
            lineHeight: 1.5,
            color: "color-mix(in srgb, var(--color-text) 65%, transparent)",
            overflowWrap: "anywhere",
          }}
        >
          Choose a folder for “{fileName}”.
        </p>

        <div style={{ position: "relative", marginTop: 14 }}>
          <Icon
            name="search"
            size={14}
            style={{
              position: "absolute",
              left: 11,
              top: "50%",
              transform: "translateY(-50%)",
              opacity: 0.5,
            }}
          />
          <input
            className="input"
            style={{ paddingLeft: 32 }}
            placeholder="Find a folder"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            autoComplete="off"
            autoCorrect="off"
            spellCheck={false}
            aria-label="Find a folder"
          />
        </div>

        <div
          role="listbox"
          aria-label="Folders"
          style={{
            marginTop: 10,
            flex: "1 1 auto",
            minHeight: 120,
            maxHeight: 340,
            overflowY: "auto",
            border: "1px solid var(--color-divider)",
          }}
        >
          {shown.length === 0 && (
            <div style={{ padding: "14px 12px", fontSize: 13, opacity: 0.6 }}>
              No folder matches “{query.trim()}”.
            </div>
          )}
          {shown.map((r) => {
            const here = r.id === currentFolderId;
            const picked = r.id === choice;
            return (
              <button
                key={r.id ?? "root"}
                type="button"
                role="option"
                aria-selected={picked}
                disabled={here}
                onClick={() => setChoice(r.id)}
                onDoubleClick={() => !here && onAnswer(r.id)}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  width: "100%",
                  minHeight: 38,
                  padding: "7px 10px",
                  paddingLeft: q ? 10 : 10 + r.depth * 16,
                  border: "none",
                  borderLeft: picked
                    ? "2px solid var(--color-accent)"
                    : "2px solid transparent",
                  background: picked ? "var(--color-accent-100)" : "transparent",
                  color: picked ? "var(--color-accent-800)" : "var(--color-text)",
                  font: "inherit",
                  fontSize: 14,
                  textAlign: "left",
                  cursor: here ? "default" : "pointer",
                  opacity: here ? 0.5 : 1,
                }}
              >
                <Icon name={r.icon} size={14} style={{ flex: "none", opacity: 0.7 }} />
                <span style={{ minWidth: 0, flex: 1 }}>
                  {q && r.trail.length > 0 && (
                    <span
                      style={{
                        display: "block",
                        fontSize: 11,
                        opacity: 0.55,
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                      }}
                    >
                      {r.trail.join(" › ")}
                    </span>
                  )}
                  <span style={{ display: "block", overflowWrap: "anywhere" }}>{r.label}</span>
                </span>
                {here && (
                  <span style={{ fontSize: 11, letterSpacing: ".06em", flex: "none" }}>
                    Current
                  </span>
                )}
              </button>
            );
          })}
        </div>

        <div
          style={{
            display: "flex",
            gap: 9,
            marginTop: 20,
            flexWrap: "wrap",
            justifyContent: "flex-end",
          }}
        >
          <button className="btn btn-secondary" type="button" onClick={() => onAnswer(undefined)}>
            Cancel
          </button>
          <button className="btn btn-primary" type="submit" disabled={!ready}>
            <Icon name="open" size={14} />
            Move here
          </button>
        </div>
      </form>
    </div>
  );
}
