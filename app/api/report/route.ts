import { NextResponse } from "next/server";
import { fail } from "@/lib/api";
import { requireDriveAccess } from "@/lib/auth";
import { parseDriveKey } from "@/lib/drives";
import { isNoteFile } from "@/lib/preview";
import { getObjectStream } from "@/lib/r2";
import { driveOfFile, getTree, resolveDownload } from "@/lib/store";
import { buildReport, noteTitle, notesOf, planReport, reportFileName } from "@/lib/report";
import type { ReportEntry, ReportImage } from "@/lib/report";
import type { DriveFile, TreeNode } from "@/lib/types";

export const dynamic = "force-dynamic";
/** Reading a few dozen notes out of R2 and typesetting them is not instant. */
export const maxDuration = 60;

/** Guards on a request that reads many objects to build one response. */
const MAX_NOTES = 400;
const MAX_TEXT_BYTES = 8 * 1024 * 1024;
const MAX_IMAGE_BYTES = 12 * 1024 * 1024;
const MAX_IMAGE_TOTAL = 48 * 1024 * 1024;

/**
 * Every note in a drive, or in one folder, as a single sectionalised PDF.
 *
 * It is a real PDF rather than a page to print because "Save as PDF" is a
 * destination some browsers hide and some do not offer at all, and a report
 * nobody can find is not a feature. This downloads.
 *
 *   /api/report?drive=advec                  the whole drive
 *   /api/report?drive=advec&folder=<id>      one folder and everything under it
 *   /api/report?drive=advec&file=<id>        one note, laid out the same way
 *
 * The drive is checked before anything is read, and every picture a note asks
 * for is checked again — an address inside another drive is not fetched, so a
 * report can never carry across what its reader could not open directly.
 */
export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const brand = await parseDriveKey(url.searchParams.get("drive"));
    await requireDriveAccess(brand);

    const { tree, rootFiles } = await getTree(brand.key);
    const folderId = url.searchParams.get("folder");
    const fileId = url.searchParams.get("file");
    // Only meaningful with ?file=: a PDF of the revision open in the viewer,
    // rather than of whatever the current one has since become.
    const versionId = fileId ? url.searchParams.get("version") : null;

    let entries: ReportEntry[];
    let scope: string;

    if (fileId) {
      const found = findFile(tree, rootFiles, fileId);
      if (!found || !isNoteFile(found.file.name)) {
        return NextResponse.json({ error: "Note not found" }, { status: 404 });
      }
      entries = [
        {
          kind: "note",
          number: "",
          title: found.file.name.replace(/\.[^./\\]+$/, ""),
          depth: 0,
          fileId: found.file.id,
          fileName: found.file.name,
          updated: found.file.uploadedAt,
          markdown: "",
        },
      ];
      scope = found.trail.length ? found.trail.join(" / ") : "My Drive";
    } else if (folderId) {
      const node = findFolder(tree, folderId);
      if (!node) {
        return NextResponse.json({ error: "Folder not found" }, { status: 404 });
      }
      entries = planReport([node], [], isNoteFile);
      scope = trailTo(tree, folderId).join(" / ");
    } else {
      entries = planReport(tree, rootFiles, isNoteFile);
      scope = "My Drive";
    }

    const notes = notesOf(entries);
    if (!notes.length) {
      return NextResponse.json(
        { error: "There are no notes here to put in a report." },
        { status: 404 }
      );
    }
    if (notes.length > MAX_NOTES) {
      return NextResponse.json(
        {
          error: `That is ${notes.length} notes — more than one report can hold. Build a folder at a time instead.`,
        },
        { status: 413 }
      );
    }

    // Read the notes a few at a time: one round trip per note in series is what
    // would make a large report time out, and all of them at once is what would
    // exhaust the function's connections.
    let textBudget = MAX_TEXT_BYTES;
    await pooled(notes, 8, async (note) => {
      const target = await resolveDownload(note.fileId, versionId);
      if (!target) {
        note.markdown = "*This note could not be read — it may have been deleted.*";
        return;
      }
      if (target.sizeBytes > textBudget) {
        note.markdown = "*This note was too large to include in the report.*";
        return;
      }
      textBudget -= target.sizeBytes;
      const object = await getObjectStream(target.r2Key);
      note.markdown = object.Body ? await object.Body.transformToString("utf-8") : "";
      // A PDF of an older revision must not be stamped with the date the
      // current one was uploaded; say which revision it is instead.
      if (versionId) note.updated = `Revision ${target.version}`;
      // The note's own opening heading is a better title than its file name.
      note.title = noteTitle(note.markdown, note.fileName);
    });

    let imageBudget = MAX_IMAGE_TOTAL;
    const resolveImage = async (href: string): Promise<ReportImage | null> => {
      const embedded = decodeDataUrl(href);
      if (embedded) return embedded.bytes.length <= MAX_IMAGE_BYTES ? embedded : null;

      // Only this app's own addresses are fetched. A note that points at some
      // other host is not a reason for the server to go and get it.
      let target: URL;
      try {
        target = new URL(href, url.origin);
      } catch {
        return null;
      }
      if (target.origin !== url.origin) return null;
      const match = /^\/api\/files\/([^/]+)\/(?:view|raw|download)$/.exec(target.pathname);
      if (!match) return null;

      const id = decodeURIComponent(match[1]);
      if ((await driveOfFile(id)) !== brand.key) return null;

      const found = await resolveDownload(id, target.searchParams.get("version"));
      if (!found) return null;
      const type = imageType(found.name, found.contentType);
      if (!type) return null;
      if (found.sizeBytes > MAX_IMAGE_BYTES || found.sizeBytes > imageBudget) return null;

      const object = await getObjectStream(found.r2Key);
      if (!object.Body) return null;
      const bytes = await object.Body.transformToByteArray();
      imageBudget -= bytes.length;
      return { bytes, type };
    };

    const generatedAt = Date.now();
    const pdf = await buildReport({
      entries,
      title: brand.name,
      subtitle: brand.tagline,
      scope,
      poweredBy: brand.poweredBy,
      generatedAt,
      resolveImage,
    });

    const name =
      fileId && entries[0].kind === "note"
        ? `${entries[0].title.replace(/[^\w .-]+/g, " ").trim() || "Note"}.pdf`
        : reportFileName(brand.name, generatedAt);

    return new NextResponse(pdf as unknown as BodyInit, {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Length": String(pdf.length),
        // attachment, not inline: the point of this route is that the reader
        // gets a file without having to find a print dialog's PDF option.
        "Content-Disposition": `attachment; filename="${name.replace(/["\\]/g, "_")}"; filename*=UTF-8''${encodeURIComponent(name)}`,
        "Cache-Control": "no-store",
      },
    });
  } catch (err) {
    return fail(err);
  }
}

/** Run `work` over `items`, never more than `limit` of them at a time. */
async function pooled<T>(
  items: T[],
  limit: number,
  work: (item: T) => Promise<void>
): Promise<void> {
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      await work(items[next++]);
    }
  });
  await Promise.all(workers);
}

/** PDF holds these two picture formats and no others. */
function imageType(name: string, contentType: string): "png" | "jpg" | null {
  const ext = name.includes(".") ? name.split(".").pop()!.toLowerCase() : "";
  const type = (contentType || "").toLowerCase();
  if (ext === "png" || type === "image/png") return "png";
  if (["jpg", "jpeg"].includes(ext) || type === "image/jpeg" || type === "image/jpg") {
    return "jpg";
  }
  return null;
}

/** A picture the note carries itself, written into it as a data URI. */
function decodeDataUrl(href: string): ReportImage | null {
  const match = /^data:image\/(png|jpe?g);base64,([\s\S]+)$/i.exec(href.trim());
  if (!match) return null;
  try {
    const bytes = new Uint8Array(Buffer.from(match[2], "base64"));
    if (!bytes.length) return null;
    return { bytes, type: /^png$/i.test(match[1]) ? "png" : "jpg" };
  } catch {
    return null;
  }
}

function findFolder(nodes: TreeNode[], id: string): TreeNode | null {
  for (const node of nodes) {
    if (node.id === id) return node;
    const deeper = findFolder(node.children, id);
    if (deeper) return deeper;
  }
  return null;
}

/** Folder names from the drive root down to `id`, for the cover's scope line. */
function trailTo(nodes: TreeNode[], id: string, trail: string[] = []): string[] {
  for (const node of nodes) {
    const here = [...trail, node.name];
    if (node.id === id) return here;
    const deeper = trailTo(node.children, id, here);
    if (deeper.length) return deeper;
  }
  return [];
}

function findFile(
  tree: TreeNode[],
  rootFiles: DriveFile[],
  id: string
): { file: DriveFile; trail: string[] } | null {
  const loose = rootFiles.find((f) => f.id === id);
  if (loose) return { file: loose, trail: [] };

  const walk = (
    nodes: TreeNode[],
    trail: string[]
  ): { file: DriveFile; trail: string[] } | null => {
    for (const node of nodes) {
      const here = [...trail, node.name];
      const hit = node.files.find((f) => f.id === id);
      if (hit) return { file: hit, trail: here };
      const deeper = walk(node.children, here);
      if (deeper) return deeper;
    }
    return null;
  };
  return walk(tree, []);
}
