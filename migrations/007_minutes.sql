-- 007: the table behind /MOM, so a minute survives the browser it was typed in.
--
-- One row per minute. `document` holds the whole thing as JSON — the meeting
-- details, the attendees, the discussion points, the client's logo — because
-- the minute is one document that is written and read whole, and splitting it
-- into a table per section would buy nothing: nothing queries an attendee.
--
-- The columns beside it are the ones the list shows. They are copies of fields
-- inside `document`, denormalised on purpose: listing selects only these, so
-- opening the picker reads a few hundred bytes a row instead of pulling every
-- minute's full text (and every embedded logo) across the wire to render a
-- list of titles. They are rewritten from the document on every save, so the
-- document stays the single source of truth and the columns cannot drift.
--
-- Nothing here is scoped by drive. /MOM is an open route that holds no drive's
-- content: it is its own small thing, and its table is too.
--
-- Safe to run twice.

CREATE TABLE IF NOT EXISTS minutes (
  id           TEXT PRIMARY KEY,
  reference    TEXT NOT NULL DEFAULT '',
  title        TEXT NOT NULL DEFAULT '',
  client       TEXT NOT NULL DEFAULT '',
  project      TEXT NOT NULL DEFAULT '',
  meeting_date TEXT NOT NULL DEFAULT '',
  document     TEXT NOT NULL,
  created_at   INTEGER NOT NULL,
  modified_at  INTEGER NOT NULL
);

-- The list is "most recently worked on first", which is the only order the
-- picker offers and the only one anybody wants.
CREATE INDEX IF NOT EXISTS idx_minutes_modified ON minutes(modified_at DESC);
