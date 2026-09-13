"use client";

/**
 * Choosing which notes go into a report.
 *
 * The report button used to take everything from where it was pressed
 * downwards — the whole folder and every folder under it — which is right when
 * that is what you want and useless when it is not. Wanting four notes out of a
 * folder of forty is the ordinary case, and there was no way to say so.
 *
 * So the button opens this instead: the same outline the report would print,
 * with a checkbox on every note and every folder. It starts with everything
 * ticked, so the old behaviour is still one press away — open, press Create —
 * and narrowing it is a matter of unticking.
 *
 * A folder's checkbox is the notes beneath it, all of them, at any depth. It
 * shows a dash rather than a tick when only some are chosen, so a collapsed
 * branch never lies about what it is contributing.
 *
 * Only notes are listed. The report has only ever been of notes, and showing
 * the drawings and spreadsheets beside them with no checkbox would raise a
 * question the report cannot answer.
 */

import React, { useMemo, useState } from "react";
import { Icon } from "./icons";
import { DANGER, LABEL, TAGLINE } from "./Choice";
import type { DriveFile, TreeNode } from "@/lib/types";

/** One line of the outline: a folder heading, or a note that can be picked. */
type Row =
  | { kind: "folder"; id: string; label: string; depth: number; notes: string[] }
  | { kind: "note"; id: string; label: string; depth: number };

/**
 * Flatten the tree the way the report lays it out — subfolders first, then the
 * folder's own notes — so what is ticked here appears in that order in the PDF.
 *
 * A folder with no notes anywhere beneath it is left out, exactly as the report
 * leaves it out, so the list never offers a heading that could contribute
 * nothing.
 */
function outline(
  nodes: TreeNode[],
  rootFiles: DriveFile[],
  isNote: (name: string) => boolean,
  numbered: boolean
): Row[] {
  const rows: Row[] = [];

  const notesUnder = (node: TreeNode): string[] => [
    ...node.children.flatMap(notesUnder),
    ...node.files.filter((f) => isNote(f.name)).map((f) => f.id),
  ];

  const walk = (node: TreeNode, depth: number) => {
    const mine = notesUnder(node);
    if (!mine.length) return;
    rows.push({
      kind: "folder",
      id: node.id,
      label: numbered && node.number ? `${node.number}  ${node.name}` : node.name,
      depth,
      notes: mine,
    });
    for (const child of node.children) walk(child, depth + 1);
    for (const file of node.files.filter((f) => isNote(f.name))) {
      rows.push({ kind: "note", id: file.id, label: file.name, depth: depth + 1 });
    }
  };

  for (const node of nodes) walk(node, 0);
  for (const file of rootFiles.filter((f) => isNote(f.name))) {
    rows.push({ kind: "note", id: file.id, label: file.name, depth: 0 });
  }
  return rows;
}

export default function ReportPicker({
  tree,
  rootFiles,
  isNote,
  numbered,
  where,
  onCancel,
  onBuild,
}: {
  /** The subtree the report button was pressed in. */
  tree: TreeNode[];
  /** Notes sitting loose at that level. */
  rootFiles: DriveFile[];
  isNote: (name: string) => boolean;
  /** Whether this drive numbers its folders, so the list reads like the PDF. */
  numbered: boolean;
  /** Where the picker was opened — the breadcrumb, for the heading. */
  where: string;
  onCancel: () => void;
  onBuild: (noteIds: string[]) => void;
}) {
  const rows = useMemo(
    () => outline(tree, rootFiles, isNote, numbered),
    [tree, rootFiles, isNote, numbered]
  );

  /** Every note on offer, in the order the report will print them. */
  const all = useMemo(
    () => rows.filter((r): r is Extract<Row, { kind: "note" }> => r.kind === "note").map((r) => r.id),
    [rows]
  );

  // Everything, to begin with: the button used to take everything, and opening
  // this should not quietly change what pressing straight through does.
  const [picked, setPicked] = useState<Set<string>>(() => new Set(all));

  const toggle = (ids: string[], on: boolean) =>
    setPicked((prev) => {
      const next = new Set(prev);
      for (const id of ids) {
        if (on) next.add(id);
        else next.delete(id);
      }
      return next;
    });

  const count = picked.size;

  return (
    <div
      onClick={onCancel}
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 110,
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
          if (!count) return;
          // In report order rather than click order, so the PDF's contents and
          // this list agree however the ticks were made.
          onBuild(all.filter((id) => picked.has(id)));
        }}
        role="dialog"
        aria-modal="true"
        aria-label="Choose what goes in the report"
        style={{
          width: "min(560px, 100%)",
          maxHeight: "100%",
          display: "flex",
          flexDirection: "column",
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
            flex: "none",
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
            <Icon name="book" size={16} />
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
              Notes report
            </div>
            <div
              style={{
                ...TAGLINE,
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              }}
            >
              {where}
            </div>
          </div>
          <button
            className="btn btn-secondary btn-icon"
            type="button"
            onClick={onCancel}
            title="Close"
            aria-label="Close"
          >
            <Icon name="close" size={15} />
          </button>
        </header>

        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 10,
            flexWrap: "wrap",
            padding: "11px 18px",
            borderBottom: "1px solid var(--color-divider)",
            flex: "none",
          }}
        >
          <span style={LABEL}>
            {count} of {all.length} {all.length === 1 ? "note" : "notes"}
          </span>
          <div style={{ display: "flex", gap: 7, marginLeft: "auto" }}>
            <button
              className="btn btn-secondary"
              type="button"
              onClick={() => toggle(all, true)}
              disabled={count === all.length}
            >
              All
            </button>
            <button
              className="btn btn-secondary"
              type="button"
              onClick={() => toggle(all, false)}
              disabled={count === 0}
            >
              None
            </button>
          </div>
        </div>

        {/* The list scrolls and the buttons do not, so Create is reachable on a
            phone without scrolling past forty notes to find it. */}
        <div style={{ overflow: "auto", flex: 1, minHeight: 120, padding: "8px 0" }}>
          {rows.map((row) => {
            const ids = row.kind === "folder" ? row.notes : [row.id];
            const on = ids.every((id) => picked.has(id));
            const some = !on && ids.some((id) => picked.has(id));
            const folder = row.kind === "folder";

            return (
              <label
                key={`${row.kind}:${row.id}`}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 10,
                  padding: "7px 18px",
                  paddingLeft: 18 + row.depth * 18,
                  cursor: "pointer",
                  fontSize: 13.5,
                  fontWeight: folder ? 600 : 400,
                  opacity: on || some ? 1 : 0.55,
                }}
              >
                <input
                  type="checkbox"
                  checked={on}
                  // A folder half-chosen shows a dash, so a branch never reads
                  // as contributing all of itself or none of itself when it is
                  // doing neither.
                  ref={(el) => {
                    if (el) el.indeterminate = some;
                  }}
                  onChange={(e) => toggle(ids, e.target.checked)}
                  style={{ width: 16, height: 16, flex: "none", accentColor: "var(--color-accent)" }}
                />
                <Icon
                  name={folder ? "folder" : "file"}
                  size={14}
                  style={{ flex: "none", opacity: 0.7 }}
                />
                <span
                  style={{
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                  }}
                >
                  {row.label}
                </span>
                {folder && (
                  <span style={{ marginLeft: "auto", fontSize: 11, opacity: 0.55 }}>
                    {ids.filter((id) => picked.has(id)).length}/{ids.length}
                  </span>
                )}
              </label>
            );
          })}
        </div>

        <div
          style={{
            display: "flex",
            gap: 9,
            padding: "13px 18px",
            borderTop: "1px solid var(--color-divider)",
            flexWrap: "wrap",
            alignItems: "center",
            flex: "none",
          }}
        >
          {count === 0 && (
            <span style={{ fontSize: 12, color: DANGER, flexBasis: "100%" }}>
              Tick at least one note to build a report.
            </span>
          )}
          <button
            className="btn btn-primary"
            type="submit"
            disabled={!count}
            style={{ marginLeft: "auto" }}
          >
            <Icon name="book" size={14} />
            Create the PDF
          </button>
          <button className="btn btn-secondary" type="button" onClick={onCancel}>
            Cancel
          </button>
        </div>
      </form>
    </div>
  );
}
