"use client";

/**
 * The drive UI, ported from the design canvas
 * ("Yahya Khaled - Drive.dc.html") element for element.
 *
 * The canvas held its folder tree in a constructor array; here the same shape
 * is fetched from D1 and mutations go to the API. Everything visual — markup
 * order, inline styles, animation timings, icon set, copy — is the design's.
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Icon } from "./icons";
import FileViewer from "./FileViewer";
import { kindFor } from "@/lib/preview";
import { useLongPress } from "@/lib/longpress";
import { hrefFor, resolveSegments, segmentsOf, slugify, stripBasePath } from "@/lib/paths";
import { Brand, DEFAULT_BRAND } from "@/lib/brand";
import {
  DrivePayload,
  DriveFile,
  DriveFileVersion,
  TreeNode,
  humanSizeTrim,
} from "@/lib/types";

/** "order" is tree order — the order the outline numbers count in. */
type SortKey = "order" | "newest" | "oldest" | "name";

/** Depth-first lookup by folder id. */
function findNode(nodes: TreeNode[], id: string): TreeNode | null {
  for (const n of nodes) {
    if (n.id === id) return n;
    const hit = findNode(n.children, id);
    if (hit) return hit;
  }
  return null;
}

/** The design's recurring micro-label: 11px, uppercase, letterspaced, accent. */
const LABEL: React.CSSProperties = {
  fontSize: 11,
  letterSpacing: ".12em",
  textTransform: "uppercase",
  color: "var(--color-accent-700)",
};

type MenuItem =
  | { sep: true }
  | {
      sep?: false;
      label: string;
      icon: string;
      danger?: boolean;
      action: () => void;
    };

interface MenuState {
  x: number;
  y: number;
  items: MenuItem[];
}

const EMPTY: DrivePayload = {
  tree: [],
  rootFiles: [],
  usedBytes: 0,
  quotaBytes: 214748364800,
  isAdmin: false,
};

export default function Drive({
  defaultTheme = "light",
  defaultView = "grid",
  brand = DEFAULT_BRAND,
}: {
  defaultTheme?: "light" | "dark";
  defaultView?: "grid" | "list";
  /** Which drive this page shows; chosen by the route that renders it. */
  brand?: Brand;
}) {
  // Every request and every link carries the drive, so this component can
  // only ever see and touch one drive's rows.
  const driveKey = brand.key;
  const basePath = brand.basePath;
  // On a numbered drive every folder label carries its outline number, and
  // the listing keeps tree order by default so the numbers read in sequence.
  const numbered = brand.numbered;
  const defaultSort: SortKey = numbered ? "order" : "name";
  const labelOf = useCallback(
    (n: { number: string; name: string }) =>
      numbered && n.number ? `${n.number} ${n.name}` : n.name,
    [numbered]
  );

  const [data, setData] = useState<DrivePayload>(EMPTY);
  const [loaded, setLoaded] = useState(false);
  const [path, setPath] = useState<string[]>([]);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [view, setView] = useState<"grid" | "list">(defaultView);
  const [theme, setTheme] = useState<"light" | "dark">(defaultTheme);
  const [query, setQuery] = useState("");
  const [menu, setMenu] = useState<MenuState | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  // A server-side condition the operator should act on, e.g. a pending
  // migration. Distinct from `error`, which reports a failed action.
  const [notice, setNotice] = useState<string | null>(null);

  // Sort and date filter run entirely on the payload already in memory, so
  // changing them costs no D1 reads.
  const [sort, setSort] = useState<SortKey>(defaultSort);
  const [filtersOpen, setFiltersOpen] = useState(false);
  // Below the mobile breakpoint the sidebar is a drawer rather than a column.
  const [navOpen, setNavOpen] = useState(false);
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");

  // The file open in the viewer, with the revision being shown.
  const [viewing, setViewing] = useState<{
    file: DriveFile;
    versionId: string | null;
    label: string | null;
  } | null>(null);

  // A file deep-linked to, highlighted until the next navigation.
  const [focusFile, setFocusFile] = useState<string | null>(null);
  // Guards the first URL resolution so it runs once, after data lands.
  const urlApplied = useRef(false);

  // Revision history is fetched per file, only when opened.
  const [openHistory, setOpenHistory] = useState<string | null>(null);
  const [versions, setVersions] = useState<Record<string, DriveFileVersion[]>>({});
  const [loadingHistory, setLoadingHistory] = useState<string | null>(null);

  const fileRef = useRef<HTMLInputElement>(null);
  const uploadTarget = useRef<string[]>([]);
  // enter() builds hrefs from the tree; a ref keeps it from re-creating on
  // every data change and re-triggering effects that depend on it.
  const treeRef = useRef<TreeNode[]>([]);
  const pathRef = useRef<string[]>([]);

  /* ── data ─────────────────────────────────────────────────────────────── */

  /**
   * Reload the drive.
   *
   * `keepError` matters: an upload that fails still refreshes afterwards to
   * pick up whatever did succeed, and clearing the error there would erase the
   * only report of why the upload failed before it could be read. Callers that
   * just failed pass true.
   */
  const refresh = useCallback(async (keepError = false) => {
    try {
      const res = await fetch(`/api/drive?drive=${encodeURIComponent(driveKey)}`, {
        cache: "no-store",
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body?.error || "Could not load the drive");
      setData(body as DrivePayload);
      setNotice(typeof body?.notice === "string" ? body.notice : null);
      if (!keepError) setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load the drive");
    } finally {
      setLoaded(true);
    }
  }, [driveKey]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  useEffect(() => {
    document.body.setAttribute("data-theme", theme);
  }, [theme]);

  useEffect(() => {
    treeRef.current = data.tree;
  }, [data.tree]);

  useEffect(() => {
    pathRef.current = path;
  }, [path]);

  // Expand the top level once the tree arrives, matching the canvas's
  // `expanded: { 'Master Degree': true }` starting state.
  const seeded = useRef(false);
  useEffect(() => {
    if (seeded.current || !data.tree.length) return;
    seeded.current = true;
    setExpanded({ [data.tree[0].id]: true });
  }, [data.tree]);

  /* ── tree helpers (ported from the canvas) ────────────────────────────── */

  const nodeAt = useCallback(
    (p: string[]): TreeNode | null => {
      let list = data.tree;
      let node: TreeNode | null = null;
      for (const id of p) {
        const found: TreeNode | undefined = list.find((n) => n.id === id);
        if (!found) return null;
        node = found;
        list = found.children;
      }
      return node;
    },
    [data.tree]
  );

  const listAt = useCallback(
    (p: string[]): TreeNode[] => {
      const n = nodeAt(p);
      return p.length ? (n ? n.children : []) : data.tree;
    },
    [nodeAt, data.tree]
  );

  const filesAt = useCallback(
    (p: string[]): DriveFile[] => {
      if (!p.length) return data.rootFiles;
      const n = nodeAt(p);
      return n ? n.files : [];
    },
    [nodeAt, data.rootFiles]
  );

  const flatten = useCallback(
    (
      list: TreeNode[],
      base: string[],
      out: { node: TreeNode; path: string[] }[]
    ) => {
      for (const n of list) {
        const p = [...base, n.id];
        out.push({ node: n, path: p });
        flatten(n.children, p, out);
      }
      return out;
    },
    []
  );

  /**
   * Navigate to a folder and reflect it in the address bar.
   *
   * pushState rather than the Next router on purpose: the whole drive is
   * already in memory, so a client-side URL change needs no server round trip
   * and no further D1 reads.
   */
  const enter = useCallback(
    (p: string[], opts?: { replace?: boolean; fileName?: string | null }) => {
      const exp: Record<string, boolean> = {};
      p.forEach((id) => {
        exp[id] = true;
      });
      setExpanded((prev) => ({ ...prev, ...exp }));
      setPath(p);
      setQuery("");
      setMenu(null);
      setNavOpen(false);
      if (!opts?.fileName) setFocusFile(null);

      if (typeof window !== "undefined") {
        const href = hrefFor(treeRef.current, p, opts?.fileName ?? null, basePath);
        if (href !== window.location.pathname) {
          if (opts?.replace) window.history.replaceState({}, "", href);
          else window.history.pushState({}, "", href);
        }
      }
    },
    [basePath]
  );

  // A folder that disappeared (deleted in another tab) must not strand the
  // view on a path that no longer resolves.
  useEffect(() => {
    if (!loaded || !path.length) return;
    if (!nodeAt(path)) setPath([]);
  }, [loaded, path, nodeAt]);

  /* ── prompts, exactly as the canvas asks ──────────────────────────────── */

  const ask = (title: string, def: string) => {
    try {
      return window.prompt(title, def);
    } catch {
      return def;
    }
  };
  const confirmAsk = (msg: string) => {
    try {
      return window.confirm(msg);
    } catch {
      return true;
    }
  };

  /* ── mutations ────────────────────────────────────────────────────────── */

  const call = useCallback(
    async (url: string, init?: RequestInit) => {
      const res = await fetch(url, {
        ...init,
        headers: { "Content-Type": "application/json", ...(init?.headers || {}) },
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body?.error || `Request failed (${res.status})`);
      return body;
    },
    []
  );

  const run = useCallback(
    async (label: string, fn: () => Promise<void>) => {
      setBusy(label);
      setError(null);
      try {
        await fn();
        await refresh();
      } catch (e) {
        setError(e instanceof Error ? e.message : "Something went wrong");
      } finally {
        setBusy(null);
      }
    },
    [refresh]
  );

  const addFolder = useCallback(
    (p: string[]) => {
      const name = ask("New folder name", "New Folder");
      if (name === null) return;
      const parentId = p.length ? p[p.length - 1] : null;
      run("Creating folder", async () => {
        await call("/api/folders", {
          method: "POST",
          body: JSON.stringify({
            drive: driveKey,
            parentId,
            name: name.trim() || "New Folder",
          }),
        });
      });
    },
    [call, run, driveKey]
  );

  const renameNode = useCallback(
    (p: string[]) => {
      const node = nodeAt(p);
      if (!node) return;
      const nn = ask("Rename folder", node.name);
      if (nn === null || !nn.trim()) return;
      run("Renaming folder", async () => {
        await call(`/api/folders/${node.id}`, {
          method: "PATCH",
          body: JSON.stringify({ name: nn.trim() }),
        });
      });
    },
    [nodeAt, call, run]
  );

  const deleteNode = useCallback(
    (p: string[]) => {
      const node = nodeAt(p);
      if (!node) return;
      if (
        (node.children.length || node.files.length) &&
        !confirmAsk("Delete “" + node.name + "” and everything inside it?")
      ) {
        return;
      }
      run("Deleting folder", async () => {
        await call(`/api/folders/${node.id}`, { method: "DELETE" });
        const cur = path.join("/");
        const del = p.join("/");
        if (cur === del || cur.startsWith(del + "/")) setPath(p.slice(0, -1));
      });
    },
    [nodeAt, call, run, path]
  );

  /** Step a folder up or down among its siblings — how a number changes. */
  const moveNode = useCallback(
    (p: string[], direction: "up" | "down") => {
      const node = nodeAt(p);
      if (!node) return;
      run(direction === "up" ? "Moving folder up" : "Moving folder down", async () => {
        await call(`/api/folders/${node.id}`, {
          method: "PATCH",
          body: JSON.stringify({ move: direction }),
        });
      });
    },
    [nodeAt, call, run]
  );

  const triggerUpload = useCallback((p: string[]) => {
    uploadTarget.current = p;
    fileRef.current?.click();
  }, []);

  /**
   * Upload straight to R2 with a presigned PUT: file bytes never pass through
   * the Vercel function, which caps request bodies around 4.5 MB.
   */
  const onUpload = useCallback(
    async (ev: React.ChangeEvent<HTMLInputElement>) => {
      const picked = Array.from(ev.target.files || []);
      ev.target.value = "";
      if (!picked.length) return;

      const target = uploadTarget.current;
      const folderId = target.length ? target[target.length - 1] : null;

      setError(null);
      let failed = false;
      for (let i = 0; i < picked.length; i++) {
        const file = picked[i];
        setBusy(
          picked.length > 1
            ? `Uploading ${i + 1} of ${picked.length} — ${file.name}`
            : `Uploading ${file.name}`
        );
        try {
          const { fileId, versionId, version, uploadUrl } = await call(
            "/api/files",
            {
              method: "POST",
              body: JSON.stringify({
                drive: driveKey,
                folderId,
                name: file.name,
                size: file.size,
                contentType: file.type || "application/octet-stream",
              }),
            }
          );
          if (version > 1) {
            setBusy(`Uploading ${file.name} — revision ${version}`);
          }

          const put = await fetch(uploadUrl, {
            method: "PUT",
            body: file,
            headers: {
              "Content-Type": file.type || "application/octet-stream",
            },
          });
          if (!put.ok) {
            throw new Error(
              `R2 rejected the upload (${put.status}). Check the bucket's CORS rules.`
            );
          }

          await call(`/api/files/${fileId}/confirm`, {
            method: "POST",
            body: JSON.stringify({ versionId }),
          });
        } catch (e) {
          failed = true;
          setError(
            `${file.name}: ${e instanceof Error ? e.message : "upload failed"}`
          );
          break;
        }
      }

      setBusy(null);
      await refresh(failed);
    },
    [call, refresh, driveKey]
  );

  const renameFileAction = useCallback(
    (file: DriveFile) => {
      const nn = ask("Rename file", file.name);
      if (nn === null || !nn.trim()) return;
      run("Renaming file", async () => {
        await call(`/api/files/${file.id}`, {
          method: "PATCH",
          body: JSON.stringify({ name: nn.trim() }),
        });
      });
    },
    [call, run]
  );

  const deleteFileAction = useCallback(
    (file: DriveFile) => {
      if (!confirmAsk("Delete “" + file.name + "”?")) return;
      run("Deleting file", async () => {
        await call(`/api/files/${file.id}`, { method: "DELETE" });
      });
    },
    [call, run]
  );

  const downloadFile = useCallback((file: DriveFile) => {
    window.location.href = `/api/files/${file.id}/download`;
  }, []);

  /** Put a shareable absolute URL on the clipboard. */
  const copyLink = useCallback(
    async (folderPath: string[], fileName?: string | null) => {
      const href = hrefFor(treeRef.current, folderPath, fileName ?? null, basePath);
      const url = window.location.origin + href;
      try {
        await navigator.clipboard.writeText(url);
        setBusy("Link copied");
        window.setTimeout(() => setBusy(null), 1400);
      } catch {
        // Clipboard access can be refused (insecure context, denied
        // permission). Show the URL so it can still be copied by hand.
        window.prompt("Copy this link", url);
      }
    },
    [basePath]
  );

  /** Open a file in the in-app viewer instead of downloading it. */
  const openFile = useCallback(
    (file: DriveFile, versionId: string | null = null, label: string | null = null) => {
      setViewing({ file, versionId, label });
    },
    []
  );

  const downloadVersion = useCallback((fileId: string, versionId: string) => {
    window.location.href = `/api/files/${fileId}/download?version=${versionId}`;
  }, []);

  /** Fetch a file's history the first time it is opened, then cache it. */
  const loadVersions = useCallback(
    async (fileId: string) => {
      if (versions[fileId]) return;
      setLoadingHistory(fileId);
      try {
        const body = await call(`/api/files/${fileId}/versions`);
        setVersions((v) => ({ ...v, [fileId]: body.versions }));
      } catch (e) {
        setError(e instanceof Error ? e.message : "Could not load revisions");
      } finally {
        setLoadingHistory(null);
      }
    },
    [versions, call]
  );

  const toggleHistory = useCallback(
    (fileId: string) => {
      if (openHistory === fileId) {
        setOpenHistory(null);
        return;
      }
      setOpenHistory(fileId);
      loadVersions(fileId);
    },
    [openHistory, loadVersions]
  );

  /** Any write to a file's history invalidates the cached list. */
  const refreshHistory = useCallback(
    async (fileId: string) => {
      setVersions((v) => {
        const next = { ...v };
        delete next[fileId];
        return next;
      });
      if (openHistory === fileId) {
        setLoadingHistory(fileId);
        try {
          const body = await call(`/api/files/${fileId}/versions`);
          setVersions((v) => ({ ...v, [fileId]: body.versions }));
        } finally {
          setLoadingHistory(null);
        }
      }
    },
    [openHistory, call]
  );

  const restoreVersionAction = useCallback(
    (fileId: string, v: DriveFileVersion) => {
      if (!confirmAsk(`Make revision ${v.version} the current one?`)) return;
      run("Restoring revision", async () => {
        await call(`/api/files/${fileId}/versions/${v.id}/restore`, {
          method: "POST",
        });
        await refreshHistory(fileId);
      });
    },
    [call, run, refreshHistory]
  );

  const deleteVersionAction = useCallback(
    (fileId: string, v: DriveFileVersion) => {
      if (!confirmAsk(`Delete revision ${v.version} permanently?`)) return;
      run("Deleting revision", async () => {
        await call(`/api/files/${fileId}/versions/${v.id}`, { method: "DELETE" });
        await refreshHistory(fileId);
      });
    },
    [call, run, refreshHistory]
  );

  const signOut = useCallback(() => {
    run("Signing out", async () => {
      await call("/api/auth/logout", { method: "POST" });
    });
  }, [call, run]);

  /** Point the view at whatever the current URL names. */
  const applyUrl = useCallback(
    (pathname: string) => {
      const segs = segmentsOf(stripBasePath(pathname, basePath));
      if (!segs.length) {
        setPath([]);
        setFocusFile(null);
        return;
      }

      const r = resolveSegments(data.tree, data.rootFiles, segs);
      const exp: Record<string, boolean> = {};
      r.folderPath.forEach((id) => {
        exp[id] = true;
      });
      setExpanded((prev) => ({ ...prev, ...exp }));
      setPath(r.folderPath);
      setFocusFile(r.fileId);

      // A link to a file opens the file — that is what the person who sent it
      // meant. The history goes with it, so the revision on screen is clear.
      if (r.fileId) {
        setOpenHistory(r.fileId);
        loadVersions(r.fileId);
        const folder = r.folderPath.length
          ? r.folderPath[r.folderPath.length - 1]
          : null;
        const list = folder
          ? (findNode(data.tree, folder)?.files ?? [])
          : data.rootFiles;
        const target = list.find((f) => f.id === r.fileId);
        if (target) setViewing({ file: target, versionId: null, label: null });
      }

      if (!r.exact) {
        setError(
          "That link no longer matches a folder — showing the closest match. A folder may have been renamed."
        );
      }
    },
    [data.tree, data.rootFiles, loadVersions, basePath]
  );

  // Resolve the address bar once, after the first payload arrives.
  useEffect(() => {
    if (!loaded || urlApplied.current) return;
    urlApplied.current = true;
    applyUrl(window.location.pathname);
  }, [loaded, applyUrl]);

  // Back and forward move through the drive without refetching anything.
  useEffect(() => {
    const onPop = () => applyUrl(window.location.pathname);
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, [applyUrl]);

  /* ── context menus ────────────────────────────────────────────────────── */

  const openMenu = useCallback(
    (ev: React.MouseEvent, items: MenuItem[]) => {
      ev.preventDefault();
      ev.stopPropagation();
      const w = 210;
      const h =
        items.filter((i) => !i.sep).length * 40 +
        items.filter((i) => i.sep).length * 11 +
        12;
      const x = Math.max(8, Math.min(ev.clientX, window.innerWidth - w - 8));
      const y = Math.max(8, Math.min(ev.clientY, window.innerHeight - h - 8));
      setMenu({ x, y, items });
    },
    []
  );

  const closeMenu = useCallback(() => setMenu(null), []);

  const isAdmin = data.isAdmin;

  const folderMenu = useCallback(
    (ev: React.MouseEvent, p: string[]) => {
      const items: MenuItem[] = [
        { label: "Open", icon: "open", action: () => enter(p) },
        { label: "Copy link", icon: "link", action: () => copyLink(p) },
      ];
      items.push({
        label: "Upload file",
        icon: "upload",
        action: () => triggerUpload(p),
      });
      if (isAdmin) {
        items.push(
          { label: "New folder", icon: "plus", action: () => addFolder(p) },
          { sep: true },
          { label: "Rename", icon: "edit", action: () => renameNode(p) }
        );
        // Reordering only matters where the order is visible — on a numbered
        // drive it is the number itself.
        if (numbered) {
          const siblings = listAt(p.slice(0, -1));
          const idx = siblings.findIndex((n) => n.id === p[p.length - 1]);
          if (idx > 0) {
            items.push({ label: "Move up", icon: "up", action: () => moveNode(p, "up") });
          }
          if (idx >= 0 && idx < siblings.length - 1) {
            items.push({ label: "Move down", icon: "down", action: () => moveNode(p, "down") });
          }
        }
        items.push({
          label: "Delete",
          icon: "trash",
          danger: true,
          action: () => deleteNode(p),
        });
      }
      openMenu(ev, items);
    },
    [isAdmin, numbered, listAt, enter, copyLink, addFolder, triggerUpload, renameNode, moveNode, deleteNode, openMenu]
  );

  const fileMenu = useCallback(
    (ev: React.MouseEvent, file: DriveFile) => {
      const items: MenuItem[] = [
        { label: "Open", icon: "eye", action: () => openFile(file) },
        { label: "Download", icon: "download", action: () => downloadFile(file) },
        {
          label: "Copy link",
          icon: "link",
          action: () => copyLink(pathRef.current, file.name),
        },
      ];
      if (file.versionCount > 1) {
        items.push({
          label: `Revisions (${file.versionCount})`,
          icon: "history",
          action: () => toggleHistory(file.id),
        });
      }
      if (isAdmin) {
        items.push(
          { sep: true },
          { label: "Rename", icon: "edit", action: () => renameFileAction(file) },
          {
            label: "Delete",
            icon: "trash",
            danger: true,
            action: () => deleteFileAction(file),
          }
        );
      }
      openMenu(ev, items);
    },
    [isAdmin, openFile, downloadFile, copyLink, toggleHistory, renameFileAction, deleteFileAction, openMenu]
  );

  const canvasMenu = useCallback(
    (ev: React.MouseEvent) => {
      const items: MenuItem[] = [
        { label: "Upload file", icon: "upload", action: () => triggerUpload(path) },
      ];
      if (isAdmin) {
        items.push({ label: "New folder", icon: "plus", action: () => addFolder(path) });
      }
      openMenu(ev, items);
    },
    [isAdmin, openMenu, addFolder, triggerUpload, path]
  );

  const rootMenu = useCallback(
    (ev: React.MouseEvent) => {
      const items: MenuItem[] = [
        { label: "Upload file", icon: "upload", action: () => triggerUpload([]) },
      ];
      if (isAdmin) {
        items.push({ label: "New folder", icon: "plus", action: () => addFolder([]) });
      }
      openMenu(ev, items);
    },
    [isAdmin, openMenu, addFolder, triggerUpload]
  );

  // Touch equivalents of right-click. Declared here so each has its menu
  // builder already in scope.
  const canvasPress = useLongPress(canvasMenu);

  /* ── derived view model (the canvas's renderVals) ─────────────────────── */

  const searching = query.trim().length > 0;

  /**
   * Sort and date-filter here, in the browser, over the payload already
   * fetched. The whole drive arrives in one /api/drive call, so none of this
   * costs another D1 row read no matter how often it changes.
   */
  const fromMs = useMemo(() => (from ? new Date(from + "T00:00:00").getTime() : null), [from]);
  const toMs = useMemo(() => (to ? new Date(to + "T23:59:59.999").getTime() : null), [to]);
  const dateFiltered = fromMs !== null || toMs !== null;
  /** Anything narrowing or reordering the listing, so the button can say so. */
  const filterActive = dateFiltered || sort !== defaultSort;

  const inRange = useCallback(
    (ms: number) =>
      (fromMs === null || ms >= fromMs) && (toMs === null || ms <= toMs),
    [fromMs, toMs]
  );


  const entries = useMemo(() => {
    if (searching) {
      const q = query.trim().toLowerCase();
      return flatten(data.tree, [], []).filter((e) =>
        e.node.name.toLowerCase().includes(q)
      );
    }
    return listAt(path).map((n) => ({ node: n, path: [...path, n.id] }));
  }, [searching, query, flatten, data.tree, listAt, path]);

  /** Folders get the same in-memory sort and date filter as files. */
  const shownEntries = useMemo(() => {
    let list = entries;
    if (dateFiltered) list = list.filter((e) => inRange(e.node.modifiedMs));
    // Entries already arrive in tree order, which is what "order" means.
    if (sort === "order") return list;
    if (sort === "name") {
      return [...list].sort((a, b) => a.node.name.localeCompare(b.node.name));
    }
    const dir = sort === "newest" ? -1 : 1;
    return [...list].sort(
      (a, b) => (a.node.modifiedMs - b.node.modifiedMs) * dir
    );
  }, [entries, dateFiltered, inRange, sort]);

  const nameOf = useCallback(
    (id: string) => nodeAt([id])?.name ?? "",
    [nodeAt]
  );

  // One long-press binding shared by every card and row: the menu builder is
  // read from a ref at fire time, so a single hook covers a changing list
  // without breaking the rules of hooks.
  const pressTarget = useRef<((ev: React.MouseEvent) => void) | null>(null);
  const itemPress = useLongPress(
    useCallback((ev: React.MouseEvent) => pressTarget.current?.(ev), [])
  );
  const bindPress = useCallback(
    (open: (ev: React.MouseEvent) => void) => ({
      handlers: {
        ...itemPress.handlers,
        onTouchStart: (e: React.TouchEvent) => {
          pressTarget.current = open;
          itemPress.handlers.onTouchStart(e);
        },
      },
      suppressClick: itemPress.suppressClick,
    }),
    [itemPress]
  );

  const folders = shownEntries.map((e, idx) => {
    const parentNames = e.path
      .slice(0, -1)
      .map((id, i) => {
        const n = nodeAt(e.path.slice(0, i + 1));
        return n ? labelOf(n) : "";
      })
      .filter(Boolean);
    return {
      key: e.node.id,
      name: e.node.name,
      number: e.node.number,
      // The design's reference slot: the folder code, or on a numbered drive
      // the outline number, which is the reference that means something there.
      code: numbered ? e.node.number : e.node.code,
      modified: e.node.modified,
      delay: Math.min(idx * 55, 500) + "ms",
      icon: e.node.icon,
      meta: searching
        ? "In " + (parentNames.length ? parentNames.join(" / ") : "My Drive")
        : e.node.children.length
          ? e.node.children.length +
            (e.node.children.length === 1 ? " folder" : " folders")
          : e.node.files.length
            ? e.node.files.length + (e.node.files.length === 1 ? " file" : " files")
            : "Empty",
      open: () => enter(e.path),
      menu: (ev: React.MouseEvent) => folderMenu(ev, e.path),
      press: bindPress((ev: React.MouseEvent) => folderMenu(ev, e.path)),
    };
  });

  const fileList = useMemo(() => {
    if (searching) return [] as DriveFile[];
    let list = filesAt(path);
    if (dateFiltered) list = list.filter((f) => inRange(f.uploadedAtMs));
    // Files carry no outline number, so tree order for them is name order.
    if (sort === "name" || sort === "order") {
      return [...list].sort((a, b) => a.name.localeCompare(b.name));
    }
    const dir = sort === "newest" ? -1 : 1;
    return [...list].sort((a, b) => (a.uploadedAtMs - b.uploadedAtMs) * dir);
  }, [searching, filesAt, path, dateFiltered, inRange, sort]);

  const files = fileList.map((f, idx) => ({
    key: f.id,
    file: f,
    name: f.name,
    extTag: (f.ext || "file").toUpperCase(),
    sub: f.size + "  ·  " + f.uploadedAt,
    version: f.version,
    versionCount: f.versionCount,
    delay: Math.min(idx * 45, 300) + "ms",
    press: bindPress((ev: React.MouseEvent) => fileMenu(ev, f)),
  }));

  const crumbs = [
    {
      key: "__root",
      name: "My Drive",
      notFirst: false,
      open: () => enter([]),
      color: path.length ? "inherit" : "var(--color-accent-700)",
      weight: path.length ? 400 : 600,
    },
    ...path.map((id, idx) => {
      const last = idx === path.length - 1;
      const node = nodeAt(path.slice(0, idx + 1));
      return {
        key: id,
        name: node ? labelOf(node) : "",
        notFirst: true,
        open: () => enter(path.slice(0, idx + 1)),
        color: last ? "var(--color-accent-700)" : "inherit",
        weight: last ? 600 : 400,
      };
    }),
  ];

  const current = nodeAt(path);
  const hasFolders = folders.length > 0;
  const hasFiles = files.length > 0;
  const isEmpty = !hasFolders && !hasFiles;

  const title = searching ? "Search results" : current ? labelOf(current) : "My Drive";
  const countLabel = searching
    ? folders.length + " matches for “" + query.trim() + "”"
    : [
        hasFolders ? folders.length + (folders.length === 1 ? " folder" : " folders") : "",
        hasFiles ? files.length + (files.length === 1 ? " file" : " files") : "",
      ]
        .filter(Boolean)
        .join(" · ") || "Empty";

  // Anyone may add to the drive; only the admin may restructure it.
  const showUpload = !searching;
  const showNewFolder = !searching && isAdmin;
  const showActions = showUpload || showNewFolder;
  const showSectionLabel = view === "grid" && !searching && hasFolders && hasFiles;
  const showGrid = hasFolders && view === "grid";
  const showList = hasFolders && view === "list";

  const active = "var(--color-accent)";
  const activeFg = "var(--color-bg)";

  const usedPct = data.quotaBytes
    ? Math.min(100, (data.usedBytes / data.quotaBytes) * 100)
    : 0;

  /* ── sidebar rows (the canvas's buildRows) ────────────────────────────── */

  const treeRows = useMemo(() => {
    const rows: {
      key: string;
      name: string;
      /** Outline number, shown before the name on a numbered drive. */
      number: string;
      count: string;
      indent: string;
      icon: string;
      iconColor: string;
      color: string;
      weight: number;
      bg: string;
      rule: string;
      chevOpacity: number;
      chevRot: string;
      toggle: (ev: React.MouseEvent) => void;
      open: () => void;
      menu: (ev: React.MouseEvent) => void;
    }[] = [];

    const rootOpen = expanded.__root !== false;
    const rootActive = path.length === 0;

    rows.push({
      key: "__root",
      name: "My Drive",
      number: "",
      count: String(data.tree.length),
      indent: "8px",
      icon: "drive",
      iconColor: rootActive ? "var(--side-active-icon)" : "var(--side-icon)",
      color: rootActive ? "var(--side-active-fg)" : "var(--side-fg)",
      weight: rootActive ? 600 : 400,
      bg: rootActive ? "var(--side-active-bg)" : "transparent",
      rule: "2px solid transparent",
      chevOpacity: 0.55,
      chevRot: rootOpen ? "rotate(90deg)" : "none",
      toggle: (ev) => {
        ev.stopPropagation();
        setExpanded((p) => ({ ...p, __root: !rootOpen }));
      },
      open: () => enter([]),
      menu: (ev) => rootMenu(ev),
    });

    const walk = (list: TreeNode[], depth: number, ppath: string[]) => {
      for (const n of list) {
        const p = [...ppath, n.id];
        const isOpen = !!expanded[n.id];
        const isActive = path.join("/") === p.join("/");
        const hasKids = n.children.length > 0;

        rows.push({
          key: n.id,
          name: n.name,
          number: numbered ? n.number : "",
          count: hasKids ? String(n.children.length) : "",
          indent: 8 + depth * 15 + "px",
          icon: n.icon,
          iconColor: isActive ? "var(--side-active-icon)" : "var(--side-icon)",
          color: isActive ? "var(--side-active-fg)" : "var(--side-fg)",
          weight: isActive ? 600 : 400,
          bg: isActive ? "var(--side-active-bg)" : "transparent",
          rule: depth > 1 ? "1px solid var(--side-rule)" : "2px solid transparent",
          chevOpacity: hasKids ? 0.55 : 0,
          chevRot: isOpen ? "rotate(90deg)" : "none",
          toggle: (ev) => {
            ev.stopPropagation();
            if (hasKids) setExpanded((prev) => ({ ...prev, [n.id]: !isOpen }));
          },
          // Opening a folder also unfolds it (enter expands the whole path).
          // A second click on the folder already open folds it back, so the
          // row itself is enough to browse the tree without hunting for the
          // chevron.
          open: () => {
            if (isActive && hasKids) {
              setExpanded((prev) => ({ ...prev, [n.id]: !isOpen }));
              return;
            }
            enter(p);
          },
          menu: (ev) => folderMenu(ev, p),
        });

        if (hasKids && isOpen) walk(n.children, depth + 1, p);
      }
    };

    if (rootOpen) walk(data.tree, 1, []);
    return rows;
  }, [expanded, path, data.tree, numbered, enter, rootMenu, folderMenu]);

  /* ── render ───────────────────────────────────────────────────────────── */

  return (
    <div style={{ display: "flex", minHeight: "100vh", alignItems: "stretch" }}>
      {navOpen && (
        <div className="dc-scrim" onClick={() => setNavOpen(false)} />
      )}
      <aside
        className={navOpen ? "dc-sidebar dc-open" : "dc-sidebar"}
        style={{
          width: 270,
          flex: "none",
          display: "flex",
          flexDirection: "column",
          gap: 24,
          padding: "27px 20px",
          background: "var(--side-bg)",
          color: "var(--side-fg)",
          borderRight: "1px solid var(--side-border)",
          transition: "background .35s, color .35s",
        }}
      >
        {/* Out to the dashboard. A plain anchor, not the router: this is the
            one link that leaves the drive entirely, so a full navigation is
            what it should be. */}
        <a
          href="/"
          className="dc-tree-row"
          style={
            {
              "--row-indent": "8px",
              "--row-color": "var(--side-fg-dim)",
              "--row-bg": "transparent",
              "--row-rule": "2px solid transparent",
              marginBottom: -14,
              fontSize: 12,
              letterSpacing: ".12em",
              textTransform: "uppercase",
              textDecoration: "none",
            } as React.CSSProperties
          }
        >
          <Icon name="up" size={14} />
          All drives
        </a>

        <div className="dc-brand" onClick={() => enter([])}>
          {/* The mark is a tall path, roughly 1:2, cropped to its own bounds
              (espark-mark-*.png) so the box can match its shape. In the square
              brand image it fills a third of the width and shrank to a scribble
              beside the name. */}
          <div
            style={{
              width: 34,
              height: 72,
              flex: "none",
              display: "grid",
              placeItems: "center",
            }}
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              className="brand-bright"
              src="/assets/espark-mark-bright.png"
              alt="eSpark"
              style={{
                gridArea: "1/1",
                width: "100%",
                height: "100%",
                objectFit: "contain",
                objectPosition: "center",
              }}
            />
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              className="brand-dark"
              src="/assets/espark-mark-dark.png"
              alt="eSpark"
              style={{
                gridArea: "1/1",
                width: "100%",
                height: "100%",
                objectFit: "contain",
                objectPosition: "center",
              }}
            />
          </div>
          <div>
            <div
              style={{
                fontFamily: "var(--font-heading)",
                fontWeight: 600,
                fontSize: brand.numbered ? 24 : 19,
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
                color: "var(--side-label)",
              }}
            >
              {brand.tagline}
            </div>
          </div>
        </div>

        <nav style={{ display: "flex", flexDirection: "column" }}>
          <div
            style={{
              fontSize: 10,
              letterSpacing: ".14em",
              textTransform: "uppercase",
              color: "var(--side-label)",
              marginBottom: 8,
            }}
          >
            Folder tree
          </div>
          {treeRows.map((r) => (
            <div
              key={r.key}
              className="dc-tree-row"
              onClick={r.open}
              onContextMenu={r.menu}
              style={
                {
                  "--row-indent": r.indent,
                  "--row-color": r.color,
                  "--row-bg": r.bg,
                  "--row-rule": r.rule,
                } as React.CSSProperties
              }
            >
              {/* The chevron only folds or unfolds; the rest of the row —
                  icon, name, count and the padding between — opens the folder,
                  so a click lands wherever the pointer happens to be. */}
              <span
                onClick={r.toggle}
                style={{
                  display: "inline-flex",
                  width: 14,
                  flex: "none",
                  justifyContent: "center",
                  opacity: r.chevOpacity,
                  transform: r.chevRot,
                  transition: "transform .15s",
                }}
              >
                <Icon name="chevron" size={13} />
              </span>
              <span
                style={{ display: "inline-flex", flex: "none", color: r.iconColor }}
              >
                <Icon name={r.icon} size={15} />
              </span>
              <span
                style={{
                  flex: 1,
                  whiteSpace: "nowrap",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  fontWeight: r.weight,
                }}
              >
                {r.number && (
                  <span
                    style={{
                      marginRight: 6,
                      opacity: 0.6,
                      fontVariantNumeric: "tabular-nums",
                    }}
                  >
                    {r.number}
                  </span>
                )}
                {r.name}
              </span>
              <span style={{ fontSize: 10, opacity: 0.4 }}>{r.count}</span>
            </div>
          ))}
        </nav>

        <div
          style={{
            marginTop: "auto",
            display: "flex",
            flexDirection: "column",
            gap: 8,
          }}
        >
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              fontSize: 11,
              letterSpacing: ".1em",
              textTransform: "uppercase",
              color: "var(--side-label)",
            }}
          >
            <Icon name="hdd" size={14} />
            Storage
          </div>
          <div
            style={{
              height: 9,
              position: "relative",
              background: "var(--side-track)",
              border: "1px solid var(--side-track-border)",
            }}
          >
            <div
              style={{
                position: "absolute",
                inset: "1px auto 1px 1px",
                width: usedPct + "%",
                background: "var(--color-accent)",
                animation: "grow 1.1s cubic-bezier(.2,.7,.3,1) both",
              }}
            />
          </div>
          <div style={{ fontSize: 12, color: "var(--side-fg-dim)" }}>
            {humanSizeTrim(data.usedBytes)} of {humanSizeTrim(data.quotaBytes)} used
          </div>
        </div>
      </aside>

      <main
        style={{
          flex: 1,
          minWidth: 0,
          display: "flex",
          flexDirection: "column",
        }}
      >
        <input
          type="file"
          multiple
          ref={fileRef}
          onChange={onUpload}
          style={{ display: "none" }}
        />

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
          <button
            className="btn btn-secondary btn-icon dc-menu-btn"
            onClick={() => setNavOpen(true)}
            title="Folders"
          >
            <Icon name="menu" size={15} />
          </button>
          <div
            className="dc-search"
            style={{
              flex: 1,
              minWidth: 220,
              maxWidth: 460,
              position: "relative",
            }}
          >
            <Icon
              name="search"
              size={15}
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
              style={{ paddingLeft: 34 }}
              placeholder="Search folders"
              value={query}
              onChange={(ev) => setQuery(ev.target.value)}
            />
          </div>
          <div className="seg">
            <label
              className="seg-opt"
              style={{ cursor: "pointer" }}
              onClick={() => setView("grid")}
            >
              <span
                style={{
                  display: "inline-flex",
                  background: view === "grid" ? active : "transparent",
                  color: view === "grid" ? activeFg : "inherit",
                  margin: "-7px -12px",
                  padding: "7px 12px",
                }}
              >
                <Icon name="grid" size={15} />
              </span>
            </label>
            <label
              className="seg-opt"
              style={{ cursor: "pointer" }}
              onClick={() => setView("list")}
            >
              <span
                style={{
                  display: "inline-flex",
                  background: view === "list" ? active : "transparent",
                  color: view === "list" ? activeFg : "inherit",
                  margin: "-7px -12px",
                  padding: "7px 12px",
                }}
              >
                <Icon name="list" size={15} />
              </span>
            </label>
          </div>
          {/* Sort and date filter live behind this, the way a data grid hides
              them until asked. The dot marks a filter that is still applied,
              so a short listing is never a mystery. */}
          <div style={{ position: "relative" }}>
            <button
              className="btn btn-secondary btn-icon"
              onClick={() => setFiltersOpen((v) => !v)}
              title="Sort and filter"
              style={
                filterActive
                  ? {
                      borderColor: "var(--color-accent)",
                      color: "var(--color-accent-700)",
                    }
                  : undefined
              }
            >
              <Icon name="filter" size={15} />
              {filterActive && (
                <span
                  style={{
                    position: "absolute",
                    top: 5,
                    right: 5,
                    width: 6,
                    height: 6,
                    background: "var(--color-accent)",
                  }}
                />
              )}
            </button>

            {filtersOpen && (
              <>
                <div
                  onClick={() => setFiltersOpen(false)}
                  style={{ position: "fixed", inset: 0, zIndex: 70 }}
                />
                <div
                  className="dc-filter-pop"
                  style={{
                    position: "absolute",
                    top: "calc(100% + 6px)",
                    right: 0,
                    zIndex: 71,
                    minWidth: 300,
                    padding: 14,
                    display: "flex",
                    flexDirection: "column",
                    gap: 14,
                    background: "var(--color-surface)",
                    border: "1px solid var(--color-divider)",
                    boxShadow: "var(--shadow-lg)",
                    animation: "pop .12s ease-out both",
                  }}
                >
                  <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
                    <span style={LABEL}>Sort</span>
                    <div className="seg">
                      {(
                        [
                          ...(numbered ? [["order", "Number"]] : []),
                          ["name", "Name"],
                          ["newest", "Newest"],
                          ["oldest", "Oldest"],
                        ] as [SortKey, string][]
                      ).map(([key, label]) => (
                        <label
                          key={key}
                          className="seg-opt"
                          style={{ cursor: "pointer" }}
                          onClick={() => setSort(key)}
                        >
                          <span
                            style={{
                              display: "inline-flex",
                              background: sort === key ? active : "transparent",
                              color: sort === key ? activeFg : "inherit",
                              margin: "-7px -12px",
                              padding: "7px 12px",
                              fontSize: 12,
                            }}
                          >
                            {label}
                          </span>
                        </label>
                      ))}
                    </div>
                  </div>

                  <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
                    <span style={LABEL}>Uploaded between</span>
                    <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
                      <input
                        className="input"
                        type="date"
                        value={from}
                        max={to || undefined}
                        onChange={(e) => setFrom(e.target.value)}
                        style={{ flex: 1, fontSize: 13, padding: "5px 8px" }}
                        aria-label="From date"
                      />
                      <span style={{ opacity: 0.45, fontSize: 12 }}>to</span>
                      <input
                        className="input"
                        type="date"
                        value={to}
                        min={from || undefined}
                        onChange={(e) => setTo(e.target.value)}
                        style={{ flex: 1, fontSize: 13, padding: "5px 8px" }}
                        aria-label="To date"
                      />
                    </div>
                  </div>

                  {filterActive && (
                    <button
                      className="btn btn-secondary"
                      style={{ fontSize: 12, justifyContent: "center" }}
                      onClick={() => {
                        setSort(defaultSort);
                        setFrom("");
                        setTo("");
                      }}
                    >
                      Reset
                    </button>
                  )}
                </div>
              </>
            )}
          </div>

          <button
            className="btn btn-secondary btn-icon"
            onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
            title="Toggle dark mode"
          >
            {theme === "dark" ? (
              <Icon name="sun" size={15} />
            ) : (
              <Icon name="moon" size={15} />
            )}
          </button>
          {/* Entry point to the admin panel. Same button grammar as the
              theme toggle beside it, so the header keeps the design's shape. */}
          {isAdmin ? (
            <button
              className="btn btn-secondary btn-icon"
              onClick={signOut}
              title="Sign out of the admin panel"
            >
              <Icon name="logout" size={15} />
            </button>
          ) : (
            <a
              className="btn btn-secondary btn-icon"
              href={`/admin/login?next=${encodeURIComponent(basePath || "/")}`}
              title="Admin sign in"
              style={{ textDecoration: "none" }}
            >
              <Icon name="lock" size={15} />
            </a>
          )}
        </header>

        <div
          className="dc-pad"
          style={{
            display: "flex",
            alignItems: "center",
            gap: 6,
            padding: "16px 27px 0",
            fontSize: 13,
            flexWrap: "wrap",
          }}
        >
          {crumbs.map((c) => (
            <div
              key={c.key}
              style={{ display: "flex", alignItems: "center", gap: 6 }}
            >
              {c.notFirst && (
                <Icon name="chevron" size={13} style={{ opacity: 0.4 }} />
              )}
              <span
                className="dc-crumb"
                onClick={c.open}
                style={
                  {
                    "--crumb-color": c.color,
                    "--crumb-weight": String(c.weight),
                  } as React.CSSProperties
                }
              >
                {c.name}
              </span>
            </div>
          ))}
        </div>

        {notice && (
          <div style={{ padding: "12px 27px 0" }}>
            <div
              style={{
                display: "flex",
                alignItems: "flex-start",
                gap: 9,
                padding: "10px 13px",
                border: "1px solid var(--color-accent-300)",
                background: "var(--color-accent-100)",
                color: "var(--color-accent-800)",
                fontSize: 13,
              }}
            >
              <Icon name="info" size={15} style={{ flex: "none", marginTop: 2 }} />
              <span>{notice}</span>
            </div>
          </div>
        )}

        {(busy || error) && (
          <div style={{ padding: "12px 27px 0" }}>
            {busy && (
              <span className="tag tag-accent" style={{ fontSize: 10 }}>
                {busy}
              </span>
            )}
            {error && (
              <div
                style={{
                  display: "flex",
                  alignItems: "flex-start",
                  gap: 9,
                  marginTop: busy ? 8 : 0,
                  padding: "10px 13px",
                  border: "1px solid color-mix(in srgb, #c0492f 45%, transparent)",
                  background: "color-mix(in srgb, #c0492f 8%, transparent)",
                  color: "#c0492f",
                  fontSize: 13,
                }}
              >
                <Icon name="info" size={15} style={{ flex: "none", marginTop: 2 }} />
                <span style={{ flex: 1 }}>{error}</span>
                <button
                  onClick={() => setError(null)}
                  title="Dismiss"
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
          </div>
        )}

        <div
          onContextMenu={canvasMenu}
          {...canvasPress.handlers}
          className="dc-pad"
          style={{ padding: "14px 27px 26px", flex: 1 }}
        >
          <div
            style={{
              display: "flex",
              alignItems: "flex-end",
              gap: 16,
              marginBottom: 24,
              flexWrap: "wrap",
            }}
          >
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              <div style={{ display: "flex", alignItems: "baseline", gap: 12 }}>
                <h2 className="dc-title" style={{ margin: 0, fontSize: 34 }}>
                  {title}
                </h2>
                <span
                  style={{
                    fontSize: 12,
                    letterSpacing: ".1em",
                    textTransform: "uppercase",
                    opacity: 0.55,
                  }}
                >
                  {countLabel}
                </span>
              </div>
              <div
                style={{
                  height: 2,
                  width: 58,
                  background: "var(--color-accent)",
                  animation: "sweepIn .55s cubic-bezier(.2,.7,.3,1) both",
                }}
              />
            </div>
            {showActions && (
              <div style={{ display: "flex", gap: 8, marginLeft: "auto" }}>
                {showUpload && (
                  <button
                    className="btn btn-secondary"
                    onClick={() => triggerUpload(path)}
                  >
                    <Icon name="upload" size={14} />
                    Upload
                  </button>
                )}
                {showNewFolder && (
                  <button className="btn btn-primary" onClick={() => addFolder(path)}>
                    <Icon name="plus" size={14} />
                    New folder
                  </button>
                )}
              </div>
            )}
          </div>

          {showSectionLabel && (
            <div
              style={{
                fontSize: 11,
                letterSpacing: ".12em",
                textTransform: "uppercase",
                color: "var(--color-accent-700)",
                marginBottom: 12,
              }}
            >
              Folders
            </div>
          )}

          {showGrid && (
            <div
              className="dc-grid"
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fill, minmax(230px, 1fr))",
                gap: 20,
              }}
            >
              {folders.map((f) => (
                <div
                  key={f.key}
                  className="dc-card"
                  onClick={() => {
                    if (!f.press.suppressClick()) f.open();
                  }}
                  onContextMenu={f.menu}
                  {...f.press.handlers}
                  style={{ animationDelay: f.delay }}
                >
                  <div
                    style={{
                      display: "flex",
                      alignItems: "flex-start",
                      justifyContent: "space-between",
                    }}
                  >
                    <div
                      style={{
                        width: 46,
                        height: 46,
                        display: "grid",
                        placeItems: "center",
                        background: "var(--color-accent-100)",
                        color: "var(--color-accent-700)",
                        border: "1px solid var(--color-accent-300)",
                      }}
                    >
                      <Icon name={f.icon} size={22} />
                    </div>
                    <button
                      className="dc-icon-btn"
                      onClick={f.menu}
                      title="Manage"
                    >
                      <Icon name="dots" size={16} />
                    </button>
                  </div>
                  <div>
                    <div
                      style={{
                        fontFamily: "var(--font-heading)",
                        fontWeight: 600,
                        fontSize: 18,
                        lineHeight: 1.2,
                      }}
                    >
                      {numbered && (
                        <span
                          style={{
                            color: "var(--color-accent-700)",
                            marginRight: 8,
                            fontVariantNumeric: "tabular-nums",
                          }}
                        >
                          {f.number}
                        </span>
                      )}
                      {f.name}
                    </div>
                    <div
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 8,
                        marginTop: 8,
                      }}
                    >
                      <span className="tag tag-accent" style={{ fontSize: 10 }}>
                        {f.meta}
                      </span>
                      <span style={{ fontSize: 11, opacity: 0.5 }}>{f.modified}</span>
                    </div>
                  </div>
                  {/* On a numbered drive the number already leads the title;
                      repeating it in the corner is clutter, so the slot is
                      left out rather than filled with a meaningless code. */}
                  {!numbered && (
                    <span
                      className="dc-card-code"
                      style={{
                        position: "absolute",
                        right: 14,
                        bottom: 14,
                        fontSize: 10,
                        letterSpacing: ".1em",
                        textTransform: "uppercase",
                        color: "var(--color-accent-700)",
                        opacity: 0.6,
                      }}
                    >
                      {f.code}
                    </span>
                  )}
                </div>
              ))}
            </div>
          )}

          {showList && (
            <table className="table">
              <thead>
                <tr>
                  <th style={{ width: "50%" }}>Name</th>
                  <th>Ref</th>
                  <th>Contents</th>
                  <th>Modified</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {folders.map((f) => (
                  <tr key={f.key} onContextMenu={f.menu} style={{ cursor: "pointer" }}>
                    <td onClick={f.open}>
                      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                        <span
                          style={{
                            display: "inline-flex",
                            color: "var(--color-accent-700)",
                          }}
                        >
                          <Icon name={f.icon} size={15} />
                        </span>
                        <span style={{ fontWeight: 500 }}>
                          {numbered && (
                            <span
                              style={{
                                color: "var(--color-accent-700)",
                                marginRight: 8,
                                fontVariantNumeric: "tabular-nums",
                              }}
                            >
                              {f.number}
                            </span>
                          )}
                          {f.name}
                        </span>
                      </div>
                    </td>
                    <td
                      onClick={f.open}
                      style={{
                        fontSize: 12,
                        letterSpacing: ".06em",
                        color: "var(--color-accent-700)",
                      }}
                    >
                      {f.code}
                    </td>
                    <td onClick={f.open}>{f.meta}</td>
                    <td onClick={f.open} style={{ opacity: 0.65 }}>
                      {f.modified}
                    </td>
                    <td style={{ textAlign: "right", width: 36 }}>
                      <button className="dc-icon-btn" onClick={f.menu} title="Manage">
                        <Icon name="dots" size={16} />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}

          {hasFiles && (
            <div style={{ marginTop: 32 }}>
              <div
                style={{
                  fontSize: 11,
                  letterSpacing: ".12em",
                  textTransform: "uppercase",
                  color: "var(--color-accent-700)",
                  marginBottom: 12,
                }}
              >
                Files
              </div>
              <div
                style={{
                  display: "flex",
                  flexDirection: "column",
                  border: "1px solid var(--color-divider)",
                }}
              >
                {files.map((d) => (
                  <div key={d.key} style={{ animationDelay: d.delay }}>
                  <div
                    className="dc-file-row"
                    onClick={() => {
                      if (!d.press.suppressClick()) openFile(d.file);
                    }}
                    onContextMenu={(ev) => fileMenu(ev, d.file)}
                    {...d.press.handlers}
                    ref={
                      focusFile === d.file.id
                        ? (el) =>
                            el?.scrollIntoView({
                              block: "center",
                              behavior: "smooth",
                            })
                        : undefined
                    }
                    style={{
                      cursor: "pointer",
                      ...(focusFile === d.file.id
                        ? {
                            background:
                              "color-mix(in srgb, var(--color-accent) 14%, var(--color-surface))",
                            boxShadow: "inset 2px 0 0 var(--color-accent)",
                          }
                        : {}),
                    }}
                  >
                    <div
                      style={{
                        width: 34,
                        height: 40,
                        flex: "none",
                        display: "grid",
                        placeItems: "center",
                        color: "var(--color-accent-700)",
                        background: "var(--color-accent-100)",
                        border: "1px solid var(--color-accent-300)",
                      }}
                    >
                      <Icon name="file" size={17} />
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div
                        style={{
                          fontWeight: 500,
                          fontSize: 14,
                          whiteSpace: "nowrap",
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                        }}
                      >
                        {d.name}
                      </div>
                      <div style={{ fontSize: 11, opacity: 0.55, marginTop: 2 }}>
                        {d.sub}
                      </div>
                    </div>
                    <span className="tag tag-accent" style={{ fontSize: 10 }}>
                      REV {d.version}
                    </span>
                    <span
                      className="tag tag-neutral dc-file-ext"
                      style={{ fontSize: 10 }}
                    >
                      {d.extTag}
                    </span>
                    {d.versionCount > 1 && (
                      <button
                        className="dc-file-btn"
                        onClick={(ev) => {
                          ev.stopPropagation();
                          toggleHistory(d.file.id);
                        }}
                        title={`${d.versionCount} revisions`}
                      >
                        <Icon
                          name="chevron"
                          size={15}
                          style={{
                            transform:
                              openHistory === d.file.id
                                ? "rotate(90deg)"
                                : "none",
                            transition: "transform .15s",
                          }}
                        />
                      </button>
                    )}
                    <button
                      className="dc-file-btn dc-file-open"
                      onClick={(ev) => {
                        ev.stopPropagation();
                        openFile(d.file);
                      }}
                      title={
                        kindFor(d.file.name) === "none"
                          ? "No preview — opens with a download option"
                          : "Open in the drive"
                      }
                    >
                      <Icon name="eye" size={15} />
                    </button>
                    <button
                      className="dc-file-btn"
                      onClick={(ev) => {
                        ev.stopPropagation();
                        downloadFile(d.file);
                      }}
                      title="Download file"
                    >
                      <Icon name="download" size={15} />
                    </button>
                    {isAdmin && (
                      <button
                        className="dc-file-btn dc-danger"
                        onClick={(ev) => {
                          ev.stopPropagation();
                          deleteFileAction(d.file);
                        }}
                        title="Delete file"
                      >
                        <Icon name="trash" size={15} />
                      </button>
                    )}
                  </div>

                  {openHistory === d.file.id && (
                    <div
                      style={{
                        borderBottom: "1px solid var(--color-divider)",
                        background:
                          "color-mix(in srgb, var(--color-accent) 4%, var(--color-surface))",
                        padding: "10px 16px 12px 64px",
                        animation: "pop .12s ease-out both",
                      }}
                    >
                      <div style={{ ...LABEL, marginBottom: 8 }}>
                        Revision history
                      </div>
                      {loadingHistory === d.file.id && !versions[d.file.id] ? (
                        <div style={{ fontSize: 12, opacity: 0.55 }}>
                          Loading revisions…
                        </div>
                      ) : (
                        (versions[d.file.id] ?? []).map((v) => (
                          <div
                            key={v.id}
                            style={{
                              display: "flex",
                              alignItems: "center",
                              gap: 12,
                              padding: "7px 0",
                              borderTop: "1px solid var(--color-divider)",
                              fontSize: 13,
                            }}
                          >
                            <span
                              style={{
                                width: 58,
                                flex: "none",
                                whiteSpace: "nowrap",
                                fontWeight: 600,
                                color: "var(--color-accent-700)",
                                letterSpacing: ".06em",
                                fontSize: 12,
                              }}
                            >
                              REV {v.version}
                            </span>
                            <span style={{ width: 74, flex: "none", opacity: 0.7 }}>
                              {v.size}
                            </span>
                            <span style={{ flex: 1, minWidth: 0, opacity: 0.7 }}>
                              {v.uploadedAt}
                            </span>
                            {v.isCurrent && (
                              <span
                                className="tag tag-accent"
                                style={{ fontSize: 10 }}
                              >
                                CURRENT
                              </span>
                            )}
                            <button
                              className="dc-file-btn"
                              onClick={() =>
                                openFile(d.file, v.id, `REV ${v.version}`)
                              }
                              title={`Open revision ${v.version}`}
                            >
                              <Icon name="eye" size={14} />
                            </button>
                            <button
                              className="dc-file-btn"
                              onClick={() => downloadVersion(d.file.id, v.id)}
                              title={`Download revision ${v.version}`}
                            >
                              <Icon name="download" size={14} />
                            </button>
                            {isAdmin && !v.isCurrent && (
                              <>
                                <button
                                  className="dc-file-btn"
                                  onClick={() =>
                                    restoreVersionAction(d.file.id, v)
                                  }
                                  title={`Restore revision ${v.version}`}
                                >
                                  <Icon name="restore" size={14} />
                                </button>
                                <button
                                  className="dc-file-btn dc-danger"
                                  onClick={() =>
                                    deleteVersionAction(d.file.id, v)
                                  }
                                  title={`Delete revision ${v.version}`}
                                >
                                  <Icon name="trash" size={14} />
                                </button>
                              </>
                            )}
                          </div>
                        ))
                      )}
                    </div>
                  )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {isEmpty && loaded && (
            <div style={{ display: "grid", placeItems: "center", padding: "64px 20px" }}>
              <div
                style={{
                  padding: "44px 56px",
                  textAlign: "center",
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "center",
                  gap: 16,
                  border: "1px dashed var(--color-divider)",
                  background: "var(--color-surface)",
                }}
              >
                <Icon
                  name="folder"
                  size={38}
                  style={{ color: "var(--color-accent)", opacity: 0.75 }}
                />
                <div
                  style={{
                    fontFamily: "var(--font-heading)",
                    fontWeight: 600,
                    fontSize: 20,
                  }}
                >
                  {searching ? "No matches" : "This folder is empty"}
                </div>
                <div style={{ fontSize: 13, opacity: 0.6, maxWidth: 280 }}>
                  {searching
                    ? "No folder names match your search. Try a shorter term."
                    : isAdmin
                      ? "Use the buttons above to add a folder or upload files."
                      : "Nothing here yet — use Upload file to add something."}
                </div>
                {showActions && (
                  <div style={{ display: "flex", gap: 8, marginTop: 2 }}>
                    {showUpload && (
                      <button
                        className="btn btn-secondary"
                        onClick={() => triggerUpload(path)}
                      >
                        <Icon name="upload" size={14} />
                        Upload file
                      </button>
                    )}
                    {showNewFolder && (
                      <button
                        className="btn btn-primary"
                        onClick={() => addFolder(path)}
                      >
                        <Icon name="plus" size={14} />
                        New folder
                      </button>
                    )}
                  </div>
                )}
              </div>
            </div>
          )}

        </div>

        {/* The hint line sits at the foot of the main column, so it stays at
            the bottom whether the listing is long or empty, and leaves the
            right-hand corner for the "powered by" mark on a drive that has one. */}
        <footer
          className="dc-pad"
          style={{
            display: "flex",
            alignItems: "center",
            gap: 7,
            flexWrap: "wrap",
            padding: "0 27px 22px",
            fontSize: 11,
          }}
        >
          <div
            style={{
              opacity: 0.4,
              display: "flex",
              alignItems: "center",
              gap: 7,
            }}
          >
            <Icon name="info" size={13} />
            {/* Both are rendered and CSS picks one, so the wording matches the
                input device without a client-only check that would mismatch
                during hydration. */}
            <span className="dc-hint-mouse">
              {isAdmin
                ? "Right-click a folder, a file, or empty space to manage."
                : "Right-click to upload, or a file to open and download it."}
            </span>
            <span className="dc-hint-touch">
              {isAdmin
                ? "Touch and hold a folder, a file, or empty space to manage."
                : "Touch and hold to upload, or tap a file to open it."}
            </span>
          </div>
          {brand.poweredBy && (
            <div
              className="dc-powered"
              style={{
                marginLeft: "auto",
                display: "flex",
                alignItems: "center",
                gap: 6,
                letterSpacing: ".08em",
                textTransform: "uppercase",
                fontSize: 10,
                color: "var(--color-accent-700)",
                opacity: 0.75,
              }}
            >
              <span>Powered by</span>
              <span
                style={{
                  width: 11,
                  height: 22,
                  display: "grid",
                  placeItems: "center",
                  flex: "none",
                }}
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  className="brand-bright"
                  src="/assets/espark-mark-bright.png"
                  alt=""
                  style={{ gridArea: "1/1", width: "100%", height: "100%", objectFit: "contain" }}
                />
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  className="brand-dark"
                  src="/assets/espark-mark-dark.png"
                  alt=""
                  style={{ gridArea: "1/1", width: "100%", height: "100%", objectFit: "contain" }}
                />
              </span>
              <span style={{ fontWeight: 600, textTransform: "none", letterSpacing: ".02em", fontSize: 12 }}>
                {brand.poweredBy}
              </span>
            </div>
          )}
        </footer>
      </main>

      {menu && (
        <div
          onClick={closeMenu}
          onContextMenu={(ev) => {
            ev.preventDefault();
            closeMenu();
          }}
          style={{ position: "fixed", inset: 0, zIndex: 80 }}
        >
          <div
            style={{
              position: "fixed",
              left: menu.x,
              top: menu.y,
              minWidth: 206,
              padding: 6,
              background: "var(--color-surface)",
              border: "1px solid var(--color-divider)",
              boxShadow: "var(--shadow-lg)",
              animation: "pop .12s ease-out both",
            }}
          >
            {menu.items.map((m, i) =>
              m.sep ? (
                <div
                  key={`sep-${i}`}
                  style={{
                    height: 1,
                    margin: "5px 4px",
                    background: "var(--color-divider)",
                  }}
                />
              ) : (
                <div
                  key={`${m.label}-${i}`}
                  className="dc-menu-item"
                  onClick={() => {
                    closeMenu();
                    m.action();
                  }}
                  style={
                    {
                      "--item-color": m.danger ? "#c0492f" : "inherit",
                      "--item-hover-bg": m.danger
                        ? "rgba(192,73,47,.12)"
                        : "color-mix(in srgb, var(--color-accent) 12%, transparent)",
                    } as React.CSSProperties
                  }
                >
                  <span style={{ display: "inline-flex", opacity: 0.85 }}>
                    <Icon name={m.icon} size={15} />
                  </span>
                  <span style={{ flex: 1 }}>{m.label}</span>
                </div>
              )
            )}
          </div>
        </div>
      )}

      {viewing && (
        <FileViewer
          file={viewing.file}
          versionId={viewing.versionId}
          versionLabel={viewing.label}
          onClose={() => setViewing(null)}
          onDownload={() =>
            viewing.versionId
              ? downloadVersion(viewing.file.id, viewing.versionId)
              : downloadFile(viewing.file)
          }
        />
      )}
    </div>
  );
}
