/**
 * Which viewer opens which file.
 *
 * Two delivery paths matter here:
 *   - "media" kinds go to /view, a signed redirect straight from R2. <img>,
 *     <video>, <audio> and <iframe> do not enforce CORS, so these render
 *     whatever the bucket policy says, and the bytes never cross Vercel.
 *   - "parsed" kinds go to /raw, proxied same-origin, because JavaScript has
 *     to fetch() and decode them and fetch DOES enforce CORS.
 */

export type PreviewKind =
  | "image"
  | "video"
  | "audio"
  | "pdf"
  | "markdown"
  | "text"
  | "docx"
  | "sheet"
  | "none";

const BY_EXT: Record<string, PreviewKind> = {
  // Images — the browser decodes these natively.
  png: "image", jpg: "image", jpeg: "image", gif: "image", webp: "image",
  bmp: "image", avif: "image", ico: "image", svg: "image",

  // Video and audio, subject to the browser's codec support.
  mp4: "video", webm: "video", ogv: "video", mov: "video", m4v: "video",
  mp3: "audio", wav: "audio", ogg: "audio", m4a: "audio", flac: "audio", aac: "audio",

  pdf: "pdf",

  md: "markdown", markdown: "markdown", mdx: "markdown",

  // Plain text and source. Anything here is shown as-is, never executed.
  txt: "text", log: "text", csv: "text", tsv: "text", json: "text",
  xml: "text", yml: "text", yaml: "text", toml: "text", ini: "text",
  cfg: "text", conf: "text", env: "text", sql: "text", sh: "text",
  bash: "text", ps1: "text", bat: "text", js: "text", mjs: "text",
  cjs: "text", ts: "text", tsx: "text", jsx: "text", py: "text",
  rb: "text", go: "text", rs: "text", java: "text", c: "text", h: "text",
  cpp: "text", hpp: "text", cs: "text", php: "text", css: "text",
  scss: "text", html: "text", htm: "text", m: "text", r: "text",
  tex: "text", bib: "text", cfgx: "text", scl: "text", cid: "text",
  icd: "text", ssd: "text",

  docx: "docx",

  xlsx: "sheet", xlsm: "sheet", xls: "sheet",
};

/** Spreadsheets read CSV too, but plain text is the more honest default. */
export function kindFor(name: string, contentType?: string): PreviewKind {
  const ext = name.includes(".")
    ? name.split(".").pop()!.toLowerCase()
    : "";
  const byExt = BY_EXT[ext];
  if (byExt) return byExt;

  // Fall back to the content type for files uploaded without a useful
  // extension — a camera dump or an export named "report" and nothing else.
  const t = (contentType || "").toLowerCase();
  if (t.startsWith("image/")) return "image";
  if (t.startsWith("video/")) return "video";
  if (t.startsWith("audio/")) return "audio";
  if (t === "application/pdf") return "pdf";
  if (t.startsWith("text/")) return "text";

  return "none";
}

/** Media streams from R2; everything parsed in JS is proxied same-origin. */
export function isMediaKind(kind: PreviewKind): boolean {
  return kind === "image" || kind === "video" || kind === "audio" || kind === "pdf";
}

/** Shown when there is no viewer, so the reason is specific, not a shrug. */
export function whyNoPreview(name: string): string {
  const ext = name.includes(".") ? name.split(".").pop()!.toLowerCase() : "";
  switch (ext) {
    case "dwg":
      return "DWG is a closed AutoCAD format with no practical in-browser renderer. Export it to DXF or PDF to preview it here.";
    case "pptx":
    case "ppt":
      return "PowerPoint files have no reliable in-browser renderer. Export to PDF to preview it here.";
    case "doc":
      return "Legacy .doc is not supported — only .docx. Re-save it as .docx to preview it here.";
    case "dxf":
      return "DXF preview is not built in yet.";
    case "zip":
    case "rar":
    case "7z":
    case "tar":
    case "gz":
      return "Archives cannot be previewed. Download it to open the contents.";
    case "":
      return "This file has no extension, so its type could not be determined.";
    default:
      return `No in-browser viewer for .${ext} files.`;
  }
}
