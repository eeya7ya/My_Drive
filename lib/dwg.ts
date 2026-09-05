/**
 * Reading AutoCAD drawings, server-side only.
 *
 * DWG is a closed binary format with no browser support, so something has to
 * translate it. That something is LibreDWG, compiled to WebAssembly by
 * @mlightcad/libredwg-web, which parses the drawing and renders it to SVG.
 *
 * TWO REASONS THIS RUNS ON THE SERVER AND MUST STAY THERE.
 *
 * The first is licensing. LibreDWG is GPL-3, and so is the WASM built from it.
 * Sending it to a browser is distribution, which would put this app's client
 * bundle under GPL-3 obligations; running it on the server is not — GPL-3 has
 * no network clause, that is the AGPL — and the SVG it emits is output rather
 * than a derived work. So nothing in this module may ever be imported from a
 * client component, and the WASM must not reach the browser bundle.
 *
 * The second is weight and repetition. The WASM is ten megabytes and a drawing
 * takes a second or more to render, so doing it in every visitor's browser on
 * every view would be the wrong trade twice over. Converting once and keeping
 * the result in R2 beside the drawing means the second reader pays nothing.
 *
 * WHAT IT DOES NOT DO. Coverage is LibreDWG's, and it is not complete: some
 * drawings parse and then fail to render — a table inside a block definition
 * is one case seen in testing. That is reported as its own failure rather than
 * dressed up, because a drawing shown wrong is worse than one honestly refused,
 * and the file can still be downloaded and opened in a real CAD program.
 */

import { Dwg_File_Type, LibreDwg } from "@mlightcad/libredwg-web";

/** Extensions this module claims. Only the one, but named rather than inline. */
export const DWG_EXTENSIONS = new Set(["dwg"]);

export function isDwgName(name: string): boolean {
  const ext = name.includes(".") ? name.split(".").pop()!.toLowerCase() : "";
  return DWG_EXTENSIONS.has(ext);
}

/**
 * Where a converted drawing is kept: beside the revision it came from, under
 * the same key with a suffix. Tying it to the revision rather than the file is
 * what makes the cache correct for free — a new revision has a new key, so it
 * cannot be served an older revision's picture, and deleting the revision's
 * object leaves only this to sweep up.
 */
export function svgKeyFor(r2Key: string): string {
  return `${r2Key}.svg`;
}

/** A drawing this build cannot render, as distinct from a broken deployment. */
export class DwgUnreadableError extends Error {
  readonly status = 422;
  constructor(message: string, readonly detail?: string) {
    super(message);
    this.name = "DwgUnreadableError";
  }
}

/**
 * The WASM module, created once per warm instance.
 *
 * Instantiating costs tens of milliseconds and about twenty megabytes, so it is
 * worth keeping between requests, and the library itself is a singleton behind
 * LibreDwg.create anyway. The promise is cached rather than the module so two
 * requests arriving together share one instantiation instead of racing.
 *
 * No path is passed: emscripten then resolves libredwg-web.wasm relative to its
 * own glue file, which is where the file actually sits after Next has traced
 * it. Naming a path would hard-code a layout that only holds in development.
 */
let modulePromise: ReturnType<typeof LibreDwg.create> | null = null;

function libredwg() {
  if (!modulePromise) {
    modulePromise = LibreDwg.create().catch((err) => {
      // A failed instantiation must not be cached, or one cold-start hiccup
      // would poison the instance for as long as it lives.
      modulePromise = null;
      throw err;
    });
  }
  return modulePromise;
}

export interface DwgRender {
  svg: string;
  /** What the drawing said it was — useful when a render goes wrong. */
  version: string;
  entityCount: number;
  /** Milliseconds spent parsing and rendering, for the response headers. */
  ms: number;
}

/**
 * Render a DWG to SVG.
 *
 * The returned SVG carries a viewBox in drawing coordinates and sizes itself to
 * its container, so the viewer can pan and zoom it without knowing anything
 * about the drawing's units or extents.
 */
export async function renderDwgToSvg(bytes: ArrayBuffer): Promise<DwgRender> {
  const started = Date.now();
  const lib = await libredwg();

  let pointer: number | undefined;
  try {
    pointer = lib.dwg_read_data(bytes, Dwg_File_Type.DWG);
  } catch (err) {
    throw new DwgUnreadableError(
      "This drawing could not be opened.",
      err instanceof Error ? err.message : String(err)
    );
  }
  if (!pointer) {
    throw new DwgUnreadableError(
      "This drawing could not be opened — it may be an unsupported DWG version."
    );
  }

  try {
    // Parsing and rendering are separate failures with separate causes, so they
    // are caught separately: the first means the file was not understood, the
    // second that it was understood and could not be drawn.
    let version = "unknown";
    try {
      const raw = lib.dwg_get_version_type(pointer);
      version = typeof raw === "string" ? raw : JSON.stringify(raw);
    } catch {
      // The version is decoration on an error message; never fail over it.
    }

    let database;
    try {
      database = lib.convert(pointer);
    } catch (err) {
      throw new DwgUnreadableError(
        "This drawing was opened but its contents could not be read.",
        err instanceof Error ? err.message : String(err)
      );
    }

    let svg: string;
    try {
      svg = lib.dwg_to_svg(database);
    } catch (err) {
      throw new DwgUnreadableError(
        "This drawing was read but could not be drawn. It uses something the converter does not handle yet.",
        err instanceof Error ? err.message : String(err)
      );
    }

    if (!svg || !svg.includes("<svg")) {
      throw new DwgUnreadableError("This drawing produced no output.");
    }

    return {
      svg,
      version,
      entityCount: database.entities?.length ?? 0,
      ms: Date.now() - started,
    };
  } finally {
    // The parse allocates inside the WASM heap and nothing else will release
    // it. A leak here would accumulate across every request the instance serves.
    try {
      if (pointer) lib.dwg_free(pointer);
    } catch {
      // Freeing a pointer the library has already discarded is not worth
      // failing a request that otherwise succeeded.
    }
  }
}
