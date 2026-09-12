# Yahya Khaled — Power Systems Drive

Several web drives behind one dashboard, each run by its own user. The front end is the Claude Design canvas
(`Yahya Khaled Drive Design-handoff.zip`) ported as-is; this repo wires it to
real hosting and storage.

| Concern | Choice |
| --- | --- |
| Hosting | Next.js 16 (App Router) on Vercel |
| File storage | Cloudflare R2, via its S3-compatible API |
| Metadata | Cloudflare D1, via its HTTP query API |
| Auth | One password per user, one drive each; a single admin password above them |

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

## The look

The palette is **Grounded in Grey**. Four brand colours, written into
`app/design-system.css` exactly as the brand sheet names them and never
recomputed:

| Name | Hex | Role |
| --- | --- | --- |
| St. Pauls Blue | `#5B7884` | primary |
| Arctic Grey | `#93A3A4` | primary light |
| Minty Breeze | `#8A9B8D` | accent |
| Sage Light | `#AEBCAB` | accent light |

The dark neutrals are the sheet's too — Background `#1B1E20`, Surface `#232729`,
Surface Light `#2D3234`, Border `#3A4143`, Foreground `#E9E4E0` — and dark is
the default, because dark is the only theme the sheet specifies. The toggle
stays for anyone who wants otherwise; the light neutrals behind it are derived
from the foreground's own warmth, so both themes share one hue instead of
reading as two different products.

Everything between those anchors is generated in OKLab on a single lightness
scale, so the same step of any role matches the others in visual value, and the
steps the sheet names are pinned to its exact hexes rather than computed near
them.

**One deliberate departure.** St. Pauls Blue is 3.56:1 on the dark ground and
4.33:1 on the light one — sound for a large shape, short of AA for words. So the
identity keeps its exact value in `--brand-primary` and fills the shapes, while
what carries text is the adjacent step: Arctic Grey at 6.40:1 on dark, and
`--color-accent-700` at 5.96:1 on light. Nothing sits on `#5B7884` at 4.5:1, so
this is a choice between the exact colour and legible text, made per role rather
than once for both.

The type is **Geist**, with Geist Mono for tokens and specs and Cairo behind
both so Arabic sets in a face designed for it. The scale is the sheet's, written
as clamps because it gives both ends of each step: display 40–72, h1 32–48, h2
28–36, subhead 20, body 16–18, and an 11px eyebrow tracked out to 0.18em.

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

Every migration has one too, for the same reason.

Regenerate them with:

```bash
for f in schema.sql seed.sql seed.espark.sql migrations/*.sql; do
  case "$f" in *.console.sql) continue;; esac
  sed -e 's/--.*$//' "$f" | grep -v '^[[:space:]]*$' > "${f%.sql}.console.sql"
done
```

The `sed` matters more than it looks: it strips a `--` anywhere on a line, not
only at the start. A comment indented inside a `CREATE TABLE` is the easy one to
miss, and once the paste is flattened it swallows the rest of the statement —
the console then says *"incomplete input: SQLITE_ERROR"* rather than complaining
about a comment. After regenerating, `grep -n -- "--" *.console.sql
migrations/*.console.sql` should print nothing at all.

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

## Drives, addresses and access

One deployment and one database hold several drives that never mix. `/` is not
a drive at all — it is the dashboard, where a visitor picks one or asks for
access to one.

| Drive | Address | Rows |
| --- | --- | --- |
| Yahya Khaled — Power Systems Drive | `/yahya` | `drive = 'main'` |
| eSpark | `/advec` | `drive = 'advec'` |

Every folder and file row carries a `drive` column and every query in
`lib/store.ts` is scoped by it, so one drive cannot see another's rows. Each
drive has its own storage counter in `settings` (the main drive keeps the bare
`used_bytes` / `quota_bytes` keys; the others prefix theirs, `advec/used_bytes`)
and its own prefix in the R2 bucket. The client sends its drive with every
request — `/api/drive?drive=…`, and a `drive` field when creating a folder or
reserving an upload — and the server rejects an unknown key rather than falling
through to the wrong tree.

**Drives are rows, not code.** `migrations/005_drive_registry.sql` adds a
`drives` table and the admin panel at `/admin` creates and edits them, so a new
drive needs no deploy and no route file. Two columns carry the weight:

- `key` is what `folders.drive` and `files.drive` store. It is fixed when the
  drive is created and never changes.
- `slug` is the address. Editing it moves the drive — `/advec` could become
  `/espark-drive` — and the address it left is recorded in `drive_slugs`, so
  links already shared keep resolving and redirect to the new one.

The identity a drive wears travels with the row: the name and tagline in the
sidebar, the tab title, the home-screen name, whether folders are numbered, and
the "powered by" mark. That is why the heading changes as you move between
`/yahya` and `/advec` — the page is the same code wearing a different row.

### Users, and what the admin panel is for

Running a drive and overseeing the drives are two jobs, usually two people.
They used to be one password, which meant the person minding storage was also
the only one who could add a folder. They are separate now, and the split is
short enough to state in two lines:

**The admin creates users, gives them passwords, and sets how much each drive
may store. A user signs in on their own drive and does everything in it.**

| | Signs in with | What they do |
| --- | --- | --- |
| **A user** | their own password, on their own drive | Everything in that drive: adds, renames, reorders and deletes folders and files, restores and deletes revisions, and edits the drive's own identity — name, tagline, tab title, address, numbering, powered-by mark |
| **The admin** | `ADMIN_PASSWORD`, at `/admin/login` | Creates the users and hands out their passwords; adds and removes drives; sets each drive's storage quota and whether the dashboard lists it; answers the access requests. Cannot open a drive, add a folder, or rename one |

`/admin` is therefore a short page: **Users**, **Drives** (quota and listing
only), and **Requests**. There is nothing on it that adds a folder or renames a
drive, because those are not the admin's.

A user is a row in `users` — a name, an optional email, one `drive_key`, and a
password stored as an HMAC under `SESSION_SECRET`. Several users may share a
drive. A password is never stored and never readable: a forgotten one is
replaced, not looked up. Signing in is "this password, on this drive", matched
by the `(drive_key, password_hash)` index, so one person's password does
nothing on anybody else's drive and there is no username to type.

Concretely, **the admin does not add folders**. `/api/folders`, the per-file and
per-revision routes and the drive's identity fields all check that the caller is
signed in as one of that drive's users (`requireDriveUser` in `lib/auth.ts`,
`lib/owner.ts` for the routes addressed by row id). `/api/users`, `/api/drives`
and `/api/drives/[key]`'s `DELETE`, the quota, `/api/requests` and
`/api/admin/recalc` check the admin session. `PATCH /api/drives/[key]` serves
both and splits the body by level — the two lists are at the top of that file —
and neither check is satisfied by the other role's session. A body mixing the
two sets is a 400.

There is deliberately **no shortcut that lends a drive's controls to the admin**.
An admin who genuinely has to work inside a drive makes themselves one of its
users, which shows up in the panel rather than happening silently.

A user session lasts thirty days, because it is held by the person using the
drive every day; the admin session lasts twelve hours, being occasional and
reaching everything. The session signs the user's own password hash, so changing
somebody's password — or deleting them — signs them out immediately.

### One door, one password

**Every drive sits behind a sign-in page.** Open its link and you get a card
asking for a password — not the drive. Enter the password you were given and you
are inside, and everything in there is yours: add folders, upload, rename,
reorder, delete, manage revisions, and edit the drive's own name, tagline,
address and numbering.

There is no second, weaker credential. There is no drive that opens to anybody
with the link. Getting in and being able to change everything are the same act,
because that is what somebody means when they say a drive is theirs.

The admin does not get in either. They create the users and hand out the
passwords; looking inside a drive means being one of its users, which shows up
in the panel rather than happening quietly. `/admin` is reached from its own
sign-in at `/admin/login`, which is a different door with a different password.

Gated all the way down: the drive page, `/api/drive`, the folder and upload
routes, and every per-file route — including the ones that hand back a signed R2
URL — check for a user session before answering, so a drive's contents cannot be
read by calling the API directly.

A drive can be **unlisted**, which only decides whether the dashboard names it.
That is the admin's, since the dashboard belongs to the site rather than to any
one drive. Every card on the dashboard leads to that drive's sign-in, and none
of them says whether you are already signed in — which keeps the page from
telling somebody looking over your shoulder more than it needs to.

### Asking for access

The dashboard carries a short form — name, email, which drive, an optional note
— that writes a row to `drive_requests`. Requests are answered in the admin
panel, and approving one is bookkeeping: the actual grant is creating the
person a user and sending them their password.

### Addresses that no longer match

An address that names no drive is a **404**, which is the honest answer. The one
exception is deliberate: the main drive used to be served at the site root, so
`/literature/papers/x.pdf` is checked against that drive's top-level names and
permanently redirected to `/yahya/literature/papers/x.pdf` when it matches. A
path that matches nothing — `/story` — gets the 404 rather than silently
rendering a drive the visitor did not ask for.

### Migrating an existing database

A database from before drives existed needs `migrations/003_drives.console.sql`
run in the D1 console **before** the new code is deployed. It adds the `drive`
column (every existing row becomes the main drive), two indexes, and the
eSpark counters. Nothing is deleted or moved. Until it is run the app shows
the folders with a banner naming the migration. A database that ran 003
while the key was still `espark` also needs
`migrations/004_rename_espark_to_advec.console.sql`, which moves those rows
and counters to the `advec` key.

Then run `migrations/005_drive_registry.console.sql`, which adds the `drives`,
`drive_slugs` and `drive_requests` tables and seeds the two drives that already
exist — the main drive at `/yahya` and eSpark at `/advec`. Until it is run the
app answers from the same two drives held as a fallback in `lib/brand.ts`, so
the site keeps serving if the deploy lands ahead of the migration; what does not
work until then is adding or editing a drive, which says so rather than failing
obscurely.

Finally `migrations/006_users.console.sql`, which adds the `users` table — the
people who run the drives — and writes each drive's quota row so the admin panel
has a number to show rather than an implicit default. The app tolerates its
absence and reads every drive as one with no users yet, so a deploy ahead of the
migration serves the site; a write that needs the table says which migration is
owed. **Both existing drives come out of it with no users**, which means nobody
can add a folder until the admin creates one against each and sends out the
password. That is the state to expect on the first deploy after this change,
not a fault, and the admin panel says so at the top.

On the eSpark drive:

- **Folders are numbered in outline style** — `1`, `1.1`, `1.2`, `2` — from
  their place in the tree, and the number shows wherever a folder is named:
  the sidebar tree, the cards and list, the breadcrumb, and the page title.
  Nothing is stored for this; the number is computed from the folder's
  position when the drive loads, so it can never drift from the tree.
- A new folder takes the next number among its siblings. To renumber, the
  drive's user right-clicks a folder and picks **Move up** or **Move down**;
  the siblings' positions are rewritten and every number below follows.
- The listing keeps tree order by default so the numbers read in sequence.
  The sort menu gains a **Number** option and still offers Name / Newest /
  Oldest.
- The sidebar, sign-in card, tab title and home-screen name read **eSpark**,
  and **Powered by eSpark** sits in the bottom-right corner of the page.

### Seeding the eSpark tree

`seed.espark.sql` is the eSpark drive's folder tree, from the Electrical
Scope Register Rev2 workbook: 17 parts (Alternator, MV Switchgear, …,
E-House) at the root, their 127 deliverables beneath them, and 189 point
folders beneath those — 333 folders. Each deliverable is a short general
folder and every point its description lists is a subfolder inside it, so
"As-Built Survey Drawing of Existing MV Room - dimensions/access openings,
existing floor construction, …" is 2.1 As-Built Survey of Existing MV Room
holding 2.1.1 Dimensions & Access Openings, 2.1.2 Existing Floor
Construction, and so on. A single-item deliverable stays a single folder.
Part and Sub numbers are the register's, so `9.5` in the workbook is folder
9.5 in the drive; the register's full wording is kept beside each entry in
`scripts/generate-espark-seed.mjs`.

Every row it inserts is `drive = 'advec'`, so it goes into the same database
as the main drive and still never appears there. It first removes rows left
by earlier seed files (ids `esp-*` and `r2-*`) from whichever drive they sit
in — migration 003 marks pre-existing rows as the main drive, seeded ones
included — and never touches a folder the app created, so it is safe to run
twice. Run migration 003 first. Regenerate it with
`node scripts/generate-espark-seed.mjs`.

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
carries its size and exact upload time; anyone who can see the drive may
download one, and its users may restore or delete them. Restoring moves a pointer (`files.current_version_id`),
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

### Writing notes

**New note** sits beside Upload wherever Upload does. It opens an editor and
stores what you type as a file in the folder you were looking at, through the
same reserve-put-confirm path an upload takes — so a note is an ordinary file
from the moment it is saved: it previews, downloads, renames and keeps
revisions like anything else, and saving over a name that already exists adds a
revision rather than a second file. The editor says so before you save.

Notes are Markdown, and the toolbar writes Markdown rather than hiding it —
headings, bold, italic, code, bullets, numbers, quotes, links and a line
between sections, each of them a toggle, with `Ctrl`/`⌘ B` and `I` for the two
people reach for most. What is stored stays something a person would have typed
and can read in any editor. **Preview** renders it with the same parser the
file viewer uses.

The line between sections is the one people were typing by hand as a row of
dashes. It is written as `---`, which is a real rule in the preview and a drawn
line in the PDF report rather than a row of dashes that looks like one, and it
takes the blank line above it with it — because a row of dashes directly under
a paragraph is Markdown's *other* meaning for those characters, and turns that
paragraph into a heading. Pressing it on a rule takes it away, including a
hand-typed row of any length.

#### It is a window, not a modal

The editor floats over the drive rather than stopping it. Folders open, files
preview, search works and the tree scrolls with the note still on screen, so a
note can be written *about* the drawing or the datasheet it describes — which
is the usual case, and used to mean closing the note to go and look. It stays
until it is closed: the **✕** in its title bar, or **Close**, both of which keep
what was typed and put it back the next time the editor opens.

Drag the title bar to move it, pull the bottom right corner to resize it, roll
it up to its title bar to get it out of the way without losing the words, or
fill the window with it for something long. Where it was left is where the next
note opens. Below 640px there is no room for any of that, so it docks along the
foot of the screen instead. Because the drive is live underneath, **New note**
and **Edit** are reachable while a note is open; the words in the panel are
handed back to the drive on every keystroke, so opening another note keeps them
rather than taking them with it.

`npm test` checks the formatting helpers and the sums that keep the panel on
screen, which are pure functions for exactly that reason — and the report's
outline and line breaking, which are pure for the same one.

#### Editing one, and putting pictures in it

Any file the drive reads as text — Markdown or plain — carries a pencil in its
row and an **Edit** entry in its menu. Saving writes the same name back into the
same folder, which the store already treats as the next revision, so editing a
note keeps its history rather than starting a second file beside it. That is
also why the name is left exactly as it was found: a note called `.env` is not
quietly saved as `.env.md`.

A picture goes in from the toolbar or, more usefully, by pasting one — which is
how a screenshot actually arrives. **It is embedded in the note itself**, as a
data URI, so the note is one self-contained file: it carries its own pictures
when it is downloaded, mailed or printed, and the folder around it is not
littered with the screenshots that belong to it. The URI is written as a
reference definition at the foot of the note rather than inline, because a
quarter-megabyte of base64 in the middle of a sentence makes the note unreadable
in the editor; what sits in the text is `![alt][img-1]`.

Anything wider than 1600px is scaled down first — a phone hands over four
thousand pixels for something read at seven hundred, and base64 adds a third
again on top. A picture that would still exceed 4 MB is refused with a
suggestion to upload it to the folder and link to it instead. Files that are not
images cannot usefully be embedded, so those are still stored in the folder and
linked.

### The notes report

**Report** — beside Upload and Note — gathers every note in view into one A4 PDF
and downloads it. At the drive root that is the whole drive; inside a folder it
is that folder and everything under it. The button appears only where there is
at least one note to gather.

It is sectioned by the drive's own outline. Folder `3.2` in the sidebar is
section `3.2` in the report, because the numbers are taken from the tree rather
than invented: a folder's notes are numbered after its subfolders (folder 3 with
subfolders 3.1 and 3.2 numbers its own notes 3.3, 3.4), so no number is ever
claimed twice and the sections read in order. Folders holding no note anywhere
are left out, which leaves gaps in the numbering — deliberately, so that a
section number still means the folder it names.

What comes out: a cover with the drive's identity and what the report covers, a
clickable table of contents with page numbers, one page per top-level section,
and each note under its own numbered heading with the file it came from and when
it was last saved. A note that opens with its own heading is titled by it rather
than by its file name. Markdown is typeset properly — headings, lists, tables
with repeating headers, quotes, code blocks, pictures and links, the external
ones clickable. Running heads name the section, and every page is folioed
"4 of 23".

`/api/report` writes it:

```
/api/report?drive=<key>                one report of the whole drive
/api/report?drive=<key>&folder=<id>    one folder and everything under it
/api/report?drive=<key>&file=<id>      one note, laid out the same way
```

The same access check as every other route runs before a byte is read, and each
picture a note asks for is checked again — a note pointing at another drive's
file, or at another host, is named in the report rather than fetched. That is
what stops a report carrying across what its reader could not open directly.

**Why the server writes it.** The older route below hands the page to the
browser's own typesetter, which is the better one — but "Save as PDF" is a
destination the *browser* owns, and desktop Chrome and Firefox bury it in a
dropdown while several mobile browsers never offer it at all. A report nobody
can reach is not a report, so this one arrives as a file.

The cost of that is `lib/report.ts`: a small typesetter over
[pdf-lib](https://pdf-lib.js.org) — line breaking, pagination, tables, code,
figures. Two consequences worth knowing, both from using the fourteen fonts
every PDF reader already has rather than shipping a megabyte of font per report:
text is drawn in WinAnsi, so Latin and the punctuation notes actually use come
through and anything else is transliterated (`≤` prints `<=`, `Ω` prints `Ohm`,
Arabic and CJK come through as `?`); and pictures embed as PNG or JPEG, with
anything else named rather than drawn. For a note in a script WinAnsi cannot
hold, print it from the route below instead — the browser has the fonts.

Everything above the rendering marker in `lib/report.ts` is pure — no pdf-lib,
no fonts, no database — which is what lets `scripts/test-report.mjs` check the
outline numbering and the line breaking without a browser or a bucket.

### Printing a note

**Print…** on a note opens `/print/<id>`: the note laid out for paper, which then
prints itself. The reader chooses "Save as PDF" as the destination, and the page
also carries a **Download PDF** button onto `/api/report` for the browsers that
do not offer one.

There is no PDF library on that page on purpose. Every browser already contains
a typesetter that paginates, embeds fonts and writes real PDFs with selectable
text; a JavaScript one would either rasterise the page into a blurry picture of
itself or ship megabytes to redo what is already installed. The print stylesheet
does the work — A4 with proper margins, dark on light whichever theme the drive
was in, headings that do not strand themselves at the foot of a page, pictures
and code blocks that do not split across two, and real addresses printed after
their links. It waits for the images to decode before printing, because a PDF
with a gap where a picture should be says nothing about what went wrong.

It is its own route rather than a dialog because printing takes the whole page,
and `print` is a reserved drive slug so it cannot be shadowed.

### Reading DWG drawings

AutoCAD's DWG is a closed binary format with no browser support, so the drive
converts one to SVG on the server and shows that. The conversion runs once per
revision and the result is kept in R2 beside the drawing under the same key
with a `.svg` suffix, so the first person to open a drawing waits a second or
two and everyone after them gets a stored file. Tying the cache to the revision
rather than the file is what keeps it honest: a new revision has a new key, so
it can never be served an older revision's picture.

The viewer places the drawing once to fit and then pans and zooms it under a
fixed window — drag or swipe to pan, scroll or pinch to zoom, and arrow keys,
`+`, `-` and `0` do the same from the keyboard. Drawing coordinates can span
millions of units, so the picture is never rescaled to the window; that is what
lets a title block be readable at one zoom and the whole sheet at another.

**The conversion must stay on the server.** It uses
[`@mlightcad/libredwg-web`](https://github.com/mlightcad/libredwg-web), which is
LibreDWG compiled to WebAssembly and **GPL-3**. Sending that to a browser is
distribution and would put this app's client bundle under GPL-3 obligations;
running it server-side is not, since GPL-3 has no network clause — that is the
AGPL — and the SVG it emits is output rather than a derived work. So `lib/dwg.ts`
is imported only by its route, and `next.config.mjs` keeps the package external
and out of the client bundle. Moving that import into a client component would
change the licensing position of the whole front end.

Two practical notes. The WASM is ten megabytes and its own glue loads it by
path rather than by import, so `outputFileTracingIncludes` in `next.config.mjs`
names it explicitly for the one route that converts — without that the route
builds cleanly and fails on the first drawing. And coverage is LibreDWG's, which
is not complete: some drawings parse and then fail to render, and one of the two
AutoCAD sample files used in testing does exactly that. Those are reported as
"this drawing could not be shown" rather than dressed up, and the file can still
be downloaded and opened in a real CAD program.

### A note on safety

Markdown and .docx become HTML, and an uploaded file is untrusted input. Left
raw, a crafted document could run script in this origin and take whichever
session cookie the reader is carrying — a drive user's, or the admin's — so
everything generated goes through DOMPurify before it renders. SVGs go through `<img>`, which never executes their script, rather
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

Every link sits under its drive's address, so the same folder name in two
drives is two different URLs and neither shadows the other.

Paths are built from names, which is what makes a link worth sharing — the
trade-off is that **renaming a folder changes its link**. Old links to a renamed
folder resolve as far as they can and land on the nearest parent with a notice,
rather than erroring. An address that names no drive at all does not get that
treatment: it is a 404, so a mistyped or stale link says so instead of quietly
showing a drive the visitor did not ask for.

## Using it

`/` lists the drives and nothing else. Every card leads to that drive's sign-in;
there is no drive you can enter without a password.

**Running your drive.** Open its link. A sign-in card asks for your password;
enter it and you are in. Everything is then there — the **New folder** button,
and the right-click menus on folders, files and empty space (open, new folder,
upload, rename, delete, restore a revision) — plus a **settings** button in the
header for the drive's own name, tagline, tab title, address, numbering and
powered-by mark. You stay signed in for thirty days, and **Sign out** in that
same panel ends it.

**Overseeing.** Go to `/admin/login`, enter `ADMIN_PASSWORD`. `/admin` creates
users — a name, a password, and the drive that is theirs — and sets each
drive's quota and whether the dashboard lists it. Send the password on and you
are done; that person runs their drive without you. What the panel cannot do is
add a folder or rename a drive, and there is no shortcut that lends you those.

## Layout

```
app/
  page.tsx                     the dashboard — which drives exist
  [drive]/[[...path]]/page.tsx a drive by its slug, and deep links into it
  [drive]/manifest.webmanifest that drive's PWA manifest
  not-found.tsx                an address that matches nothing
  admin/page.tsx               users, quotas, requests (admin)
  admin/login/page.tsx         admin sign-in
  globals.css                  design system + the canvas's own styles
  design-system.css            Industry tokens, copied byte-for-byte
  api/
    drive/                     GET the whole drive in one call
    drives/                    list; create and delete a drive (admin)
    drives/[key]/              edit a drive — split by level, user and admin
    drives/[key]/signin/       a user signing in to their own drive, or out
    users/                     create and list users (admin)
    users/[id]/                rename, repassword, move, remove (admin)
    requests/                  ask for access; answer the asking (admin)
    auth/login|logout/         session in, session out
    folders/[id]/              create, rename, delete (the drive's users)
    files/[id]/                reserve, confirm, rename, delete, download
    files/[id]/versions/       history, restore, delete a revision
    files/[id]/view            signed inline URL, for media previews
    files/[id]/raw             same-origin bytes, for parsed previews
    files/[id]/drawing         a DWG converted to SVG, cached in R2
    admin/recalc/              rebuild the counters (admin)
components/
  Drive.tsx                    the ported design
  DrawingCanvas.tsx            pan and zoom for a converted drawing
  NoteEditor.tsx               writing a text note into the drive
  Dashboard.tsx                the front door
  DriveSignIn.tsx              the page every drive shows until you sign in
  DriveSettings.tsx            a user's sign-in, and the drive's own settings
  AdminPanel.tsx               users, quotas and requests (admin)
  Choice.tsx                   the segmented radio both panels use
  FileViewer.tsx               the in-app viewer
  LoginForm.tsx                sign-in, built from the design system
  icons.tsx                    the canvas's Lucide paths
lib/
  d1.ts  r2.ts  store.ts  auth.ts  types.ts  api.ts
  dwg.ts                       DWG to SVG, server-side only (GPL-3, see above)
  brand.ts                     the shape of a drive's identity, and the fallback
  drives.ts                    the drive registry — rows, slugs, requests
  users.ts                     the people who run the drives
  owner.ts                     "whose drive is this row in, and are you its user?"
  guard.ts                     the throttle in front of the typed secrets
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

Additions the backend made necessary: an admin sign-in page, a padlock in the
drive header that opens a user's sign-in and then the drive's settings (and,
for an admin, a second button through to `/admin`) — both using the same button
classes as the theme toggle beside them — and a download action on files.
Management controls hide for anyone who is not one of the drive's users, via
the design's own `showActions` flag.

The typefaces (Barlow, Barlow Condensed) load from Google Fonts through the
design system's `@import`, exactly as the design does.
