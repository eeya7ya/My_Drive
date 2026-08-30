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
    admin/recalc/              rebuild the counters (admin)
components/
  Drive.tsx                    the ported design
  LoginForm.tsx                sign-in, built from the design system
  icons.tsx                    the canvas's Lucide paths
lib/
  d1.ts  r2.ts  store.ts  auth.ts  types.ts  api.ts
  paths.ts                     URL <-> folder/file resolution
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
