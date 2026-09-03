# Yahya Khaled — Power Systems Drive

A web drive whose folders and files are managed from an admin panel.
The front end is the Claude Design canvas (`Yahya Khaled Drive Design-handoff.zip`)
ported as-is; this repo wires it to real hosting and storage.

| Concern | Choice |
| --- | --- |
| Hosting | Next.js 16 (App Router) on Vercel |
| File storage | Cloudflare R2, via its S3-compatible API |
| Metadata | Cloudflare D1, via its HTTP query API |
| Auth | Single admin password, signed session cookie |

## How the pieces fit

The app runs on Vercel, so there are no Cloudflare Workers bindings. Both
services are reached over HTTP instead:

- **D1** — `lib/d1.ts` posts SQL to Cloudflare's `/d1/database/{id}/query`
  endpoint. Every statement is a network round trip, so `lib/store.ts` reads the
  whole tree in two queries and assembles it in memory rather than walking it
  level by level.
- **R2** — `lib/r2.ts` signs URLs with the S3 SDK. **File bytes never pass
  through Vercel**: the browser asks for a presigned `PUT` and uploads straight
  to R2. This is deliberate — a Vercel serverless function caps request bodies
  at roughly 4.5 MB, so proxying uploads would break on any real file.

Upload is therefore three steps: reserve a row (`uploaded = 0`) and get a signed
URL → browser PUTs to R2 → confirm the row (`uploaded = 1`). A row stays
invisible until confirmed, so an abandoned upload never appears as a phantom
file.

## Setup

### 1. Cloudflare

```bash
npm install -g wrangler
wrangler login

# D1
wrangler d1 create my-drive                       # note the database_id
wrangler d1 execute my-drive --remote --file=./schema.sql
wrangler d1 execute my-drive --remote --file=./seed.sql   # optional starter tree

# R2
wrangler r2 bucket create my-drive
```

`seed.sql` is the folder structure from the design (Master Degree → Protection,
Communication, Analysis, Courses, Thesis, Standards, and their children —
28 folders). Regenerate it with `node scripts/generate-seed.mjs`.

### Pasting into the D1 dashboard console

Use **`schema.console.sql`** and **`seed.console.sql`** instead. They are the same
statements with the `--` comments stripped.

This matters: the dashboard console can collapse a pasted file onto a single
line, and on one line a leading `--` comments out everything after it. The
console then reports *"The request is malformed: Requests without any query are
not supported"* — it received one long comment and no SQL. The `.console.sql`
files carry no comments, so they survive being flattened.

Regenerate them with:

```bash
sed -e 's/--.*$//' schema.sql | grep -v '^[[:space:]]*$' > schema.console.sql
sed -e 's/--.*$//' seed.sql   | grep -v '^[[:space:]]*$' > seed.console.sql
```

**R2 CORS is required**, or browser uploads fail. In the dashboard under
R2 → your bucket → Settings → CORS policy:

```json
[
  {
    "AllowedOrigins": ["https://your-app.vercel.app", "http://localhost:3000"],
    "_comment": "No trailing slash and no path — an Origin header is scheme://host[:port] only, so https://your-app.vercel.app/ never matches",
    "AllowedMethods": ["PUT", "GET"],
    "AllowedHeaders": ["content-type"],
    "ExposeHeaders": ["etag"],
    "MaxAgeSeconds": 3600
  }
]
```

### 2. Credentials

Copy `.env.example` to `.env.local` and fill it in. You need an API token with
**Account → D1 → Edit** for D1, and an **Object Read & Write** R2 API token.

```bash
cp .env.example .env.local
openssl rand -base64 32     # use for SESSION_SECRET
```

### 3. Run

```bash
npm install
npm run dev
```

### 4. Deploy

Import the repo at [vercel.com/new](https://vercel.com/new). Next.js is detected
automatically — no build configuration needed. Add every variable from
`.env.example` under **Settings → Environment Variables**, then redeploy so they
take effect. Add your production domain to the R2 CORS policy above.

## A second drive: eSpark

One deployment and one database hold two drives that never mix:

| Drive | Address | Rows |
| --- | --- | --- |
| Yahya Khaled — Power Systems Drive | `/` | `drive = 'main'` |
| eSpark | `/espark` | `drive = 'espark'` |

Every folder and file row carries a `drive` column and every query in
`lib/store.ts` is scoped by it, so the main drive cannot see an eSpark row and
the other way round. Each drive has its own storage counter in `settings`
(the main drive keeps the bare `used_bytes` / `quota_bytes` keys; eSpark's are
`espark/used_bytes` / `espark/quota_bytes`) and its own prefix in the R2
bucket. The client sends its drive with every request — `/api/drive?drive=…`,
and a `drive` field when creating a folder or reserving an upload — and the
server rejects an unknown key rather than falling through to the wrong tree.
One admin password covers both; the padlock returns you to the drive you
signed in from.

The drives are declared in `lib/brand.ts`. Adding a third is a new entry
there plus a route folder like `app/espark`.

### Migrating an existing database

A database from before this needs `migrations/003_drives.console.sql` run in
the D1 console **before** the new code is deployed. It adds the `drive`
column (every existing row becomes the main drive), two indexes, and the
eSpark counters. Nothing is deleted or moved. Until it is run the app shows
the folders with a banner naming the migration.

On the eSpark drive:

- **Folders are numbered in outline style** — `1`, `1.1`, `1.2`, `2` — from
  their place in the tree, and the number shows wherever a folder is named:
  the sidebar tree, the cards and list, the breadcrumb, and the page title.
  Nothing is stored for this; the number is computed from the folder's
  position when the drive loads, so it can never drift from the tree.
- A new folder takes the next number among its siblings. To renumber, the
  admin right-clicks a folder and picks **Move up** or **Move down**; the
  siblings' positions are rewritten and every number below follows.
- The listing keeps tree order by default so the numbers read in sequence.
  The sort menu gains a **Number** option and still offers Name / Newest /
  Oldest.
- The sidebar, sign-in card, tab title and home-screen name read **eSpark**,
  and **Powered by eSpark** sits in the bottom-right corner of the page.

### Seeding the eSpark tree

`seed.espark.sql` is the eSpark drive's folder tree, exactly as the
Electrical Scope Register Rev2 workbook has it: 17 parts (Alternator, MV
Switchgear, …, E-House) at the root and their 127 deliverables beneath them,
named with the register's own wording. Part and Sub numbers are the
register's, so `9.5` in the workbook is folder 9.5 in the drive.

Every row it inserts is `drive = 'espark'`, so it goes into the same database
as the main drive and still never appears there. It only inserts —
`INSERT OR IGNORE`, never a delete — so it is safe to run twice. Run
migration 003 first. Regenerate it with `node scripts/generate-espark-seed.mjs`.

```bash
wrangler d1 execute my-drive --remote --file=./seed.espark.sql
```

For the D1 dashboard console, paste `seed.espark.console.sql`, the same
statements with no comments (see the note on the console above). `seed.sql`,
the Power Systems tree, now clears and reseeds only `drive = 'main'`.

## Revisions and dates

**Re-uploading a file keeps the old copy.** Upload `Thesis Draft.pdf` into a
folder that already has one and it becomes revision 2 — not a second file. The
row shows a `REV n` badge; a chevron expands the history, where every revision
carries its size and exact upload time and can be downloaded, restored, or
deleted individually. Restoring moves a pointer (`files.current_version_id`),
so no bytes are copied and nothing is lost.

The cost of this is storage: every revision keeps its own R2 object, and all of
them count toward the sidebar total. Delete individual revisions to reclaim it.

**Dates.** Every file shows its upload timestamp to the minute, and a toolbar
above the listing sorts by name / newest / oldest and filters to an upload date
range.

### Keeping D1 reads low

D1 bills on rows read, so the read path is deliberately flat:

| Action | D1 cost |
| --- | --- |
| Load the drive | 2 queries — one row per folder, one per file |
| Sort, filter by date, search, navigate | **zero** — done in the browser on the payload already fetched |
| Open one file's revision history | one indexed query on that file's rows |
| Storage total in the sidebar | one row — a counter, not a `SUM` |

Two counters make that possible: `files.version_count` and
`settings.used_bytes`, both maintained on write so no page load ever aggregates
over `file_versions` — the one table that grows without bound as revisions pile
up. If a write half-fails they can drift; `POST /api/admin/recalc` (admin only)
rebuilds both from the rows and prunes abandoned uploads. It is the only code
that scans the whole table.

### Migrating an existing database

The revisions feature adds tables and columns. A database created before it
needs **both** migrations run in the D1 console, in order, **before** deploying
the new code:

1. `migrations/001_file_versions.console.sql` — adds `file_versions` and the
   pointer columns
2. `migrations/002_drop_legacy_file_columns.console.sql` — rebuilds `files`
   without the legacy `r2_key` / `size_bytes` / `content_type` / `uploaded`
   columns

002 is not optional. `r2_key` is `NOT NULL` and the revisions code no longer
writes it to `files`, so without it every upload fails with
`NOT NULL constraint failed: files.r2_key` and `/api/files` returns 500.

If the code goes out first, the drive still renders its folders and shows a
banner naming the migration — the files query fails on its own rather than
taking the whole page down. No data is lost either way: the failure is a query
against a table that does not exist yet, not a deletion.

## Phones and tablets

The canvas design assumes a laptop — a permanent 270px sidebar, right-click
menus, a viewer sized for a big window. Below 860px:

- the sidebar becomes an off-canvas drawer behind a hamburger, closing itself
  when you navigate
- padding and headings step down, folders go to a two-column grid, and the
  viewer runs full-bleed
- **touch and hold** opens the same context menu right-click does, with a
  short vibration where the platform supports it; a hold is suppressed from
  also firing the tap, so holding a folder opens the menu instead of entering
  it
- below 520px the file row drops its extension tag and open button — the
  extension is already in the filename and tapping the row opens the file —
  so the name is not squeezed to nothing
- the hint line says "touch and hold" rather than "right-click", chosen in CSS
  by `(hover: none)` so it never mismatches during hydration

Above the breakpoint the desktop layout is untouched, which is checked in the
same pass.

### Installing it

`app/manifest.ts` makes the drive installable to a home screen, opening
standalone without browser chrome. The brand mark is one 2000px square listed
at several sizes, so each platform downscales rather than the repo carrying
near-duplicate icons. `viewportFit: "cover"` lets the page reach under a notch
and the safe-area insets pad it back; zoom is deliberately left uncapped so
text can still be enlarged.

This is a progressive web app, not a native binary — there is no App Store
build, and it needs a network connection. What it gives you is the drive on the
home screen, full-screen, behaving like an app.

## Opening files

Clicking a file opens it in the drive rather than downloading it. Download is
still there — it is just no longer the only way to look at something.

| Opens in the app | How |
| --- | --- |
| PDF | the browser's own viewer, in an iframe |
| Images — png, jpg, gif, webp, svg, bmp, avif | native |
| Video — mp4, webm, mov, m4v | native player |
| Audio — mp3, wav, m4a, flac, ogg | native player |
| Markdown | rendered, with tables and code blocks |
| Text and source — txt, csv, json, xml, yaml, sql, and ~30 code types | as-is |
| Word — .docx | converted to HTML by mammoth |
| Spreadsheets — .xlsx, .xlsm, .xls | every sheet as a table, via SheetJS |

Anything else opens a panel naming the specific reason and offering the
download, rather than a generic shrug.

**Not supported, and why.** `.dwg` is a closed AutoCAD format with no practical
in-browser renderer — the open-source options are either commercial services or
too immature to trust. Export to DXF or PDF. `.pptx` has no reliable
client-side renderer either; export to PDF. Legacy `.doc` is not supported, only
`.docx`.

### How the bytes get there

Two paths, chosen per format:

- **Media** (images, video, audio, PDF) redirects to a signed R2 URL and streams
  straight to the browser. Those elements do not enforce CORS, so previews work
  regardless of the bucket policy, and large files never cross Vercel.
- **Anything parsed in JavaScript** (markdown, text, .docx, spreadsheets) is
  proxied through `/api/files/[id]/raw`, same-origin. `fetch` *does* enforce
  CORS, and proxying means a wrong CORS policy cannot break these previews.
  Capped at 25 MB, since this path does use Vercel bandwidth.

`/view` signs with `Content-Disposition: inline`; `/download` signs the same
object as `attachment`. That header is the whole difference between rendering a
PDF and saving it.

### A note on safety

Markdown and .docx become HTML, and an uploaded file is untrusted input. Left
raw, a crafted document could run script in this origin and take the admin's
session cookie, so everything generated goes through DOMPurify before it
renders. SVGs go through `<img>`, which never executes their script, rather
than being inlined.

mammoth and SheetJS are large and most files need neither, so both are
dynamically imported the first time a .docx or spreadsheet is opened.

## Links

Every folder and file has its own URL, mirroring the breadcrumb:

```
/writing/presentations                      a folder
/writing/thesis/thesis-draft-pdf            a file — opens the folder,
                                            highlights it, expands its history
```

**Copy link** in the right-click menu puts the URL on the clipboard. Navigation
uses `history.pushState`, so moving around the drive updates the address bar
without a server round trip, and back/forward work as expected.

Paths are built from names, which is what makes a link worth sharing — the
trade-off is that **renaming a folder changes its link**. Old links to a renamed
folder resolve as far as they can and land on the nearest parent with a notice,
rather than erroring.

## Using it

The drive is public and read-only: visitors browse folders and download files.
Management is gated behind the admin session.

Click the padlock in the header (or go to `/admin/login`) and enter
`ADMIN_PASSWORD`. Once signed in, the design's own management affordances
appear — the **Upload** and **New folder** buttons, and the right-click menus on
folders, files, and empty space (open, new folder, upload, rename, delete).
Sign out with the button that replaces the padlock.

## Layout

```
app/
  page.tsx                     the drive
  [...path]/page.tsx           deep links to a folder or file
  admin/login/page.tsx         admin sign-in
  globals.css                  design system + the canvas's own styles
  design-system.css            Industry tokens, copied byte-for-byte
  api/
    drive/                     GET the whole drive in one call
    auth/login|logout/         session in, session out
    folders/[id]/              create, rename, delete (admin)
    files/[id]/                reserve, confirm, rename, delete, download
    files/[id]/versions/       history, restore, delete a revision
    files/[id]/view            signed inline URL, for media previews
    files/[id]/raw             same-origin bytes, for parsed previews
    admin/recalc/              rebuild the counters (admin)
components/
  Drive.tsx                    the ported design
  FileViewer.tsx               the in-app viewer
  LoginForm.tsx                sign-in, built from the design system
  icons.tsx                    the canvas's Lucide paths
lib/
  d1.ts  r2.ts  store.ts  auth.ts  types.ts  api.ts
  brand.ts                     which drive this is (DRIVE_VARIANT)
  paths.ts                     URL <-> folder/file resolution
  longpress.ts                 touch-and-hold as right-click
  preview.ts                   which viewer opens which format
schema.sql                     tables
seed.sql                       the design's starting folder tree
migrations/                    schema changes for an existing database
*.console.sql                  the same SQL, comment-free, for the D1 console
```

## Notes on the port

`app/design-system.css` is the design system's `styles.css` copied unmodified
(verified by checksum), and `app/globals.css` carries the canvas's own `<style>`
block verbatim. Markup, inline styles, animation timings, and copy in
`components/Drive.tsx` come straight from the canvas.

Two things had to change shape rather than value:

- The canvas expresses hover as a `style-hover` attribute. Inline styles beat
  class rules in CSS, so elements with a hover state carry their base
  declarations in a class (`.dc-card`, `.dc-tree-row`, …) at the end of
  `globals.css`, with per-row values passed as custom properties. Same
  properties, same values.
- The canvas held its tree in a constructor array and mutated it in place;
  here the same shape is fetched from D1 and mutations go to the API.

Additions the backend made necessary: an admin sign-in page, a padlock/sign-out
button in the header (same button classes as the theme toggle beside it), and a
download action on files. Management controls hide for visitors via the design's
own `showActions` flag.

The typefaces (Barlow, Barlow Condensed) load from Google Fonts through the
design system's `@import`, exactly as the design does.
