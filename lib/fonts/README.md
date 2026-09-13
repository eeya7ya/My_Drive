# The report's typefaces

Geist and Geist Mono, which is what the app itself is set in — see
`--font-heading` / `--font-body` / `--font-mono` in `app/design-system.css`.
They are here, as files, because a PDF has to carry its own fonts: a reader
opening the report on a phone has no web font to fetch and no `@import` to
follow, so anything not embedded falls back to whatever that reader has.

Before this, the report was set in Helvetica — one of the fourteen faces every
PDF reader already owns, which costs nothing to use and looks like nothing in
particular. A report is the one thing a drive sends to people who never see the
drive, and it was arriving in a typeface the app does not use anywhere.

`lib/report.ts` embeds them subsetted, so only the glyphs a given report
actually uses are written into it: the whole family is 450 KB on disk and adds
tens of kilobytes to a report, not hundreds.

Taken from Google Fonts, which serves the same files the app's stylesheet
loads, so screen and paper are the same drawing of the same letter.

## Licence

SIL Open Font License 1.1 — `OFL.txt`, copied from the family's own release.
It permits redistribution inside a work like this one; the licence file has to
travel with the fonts, which is why it is committed beside them rather than
summarised here.
