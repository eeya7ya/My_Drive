import type { Metadata } from "next";
import { SITE } from "@/lib/brand";

/**
 * A real 404.
 *
 * Worth its own file because of what it replaces: every unmatched address used
 * to render the main drive, so a mistyped or long-dead link looked like a page
 * that simply had nothing in it. This says the address matched nothing and
 * points back at the dashboard, in the same blueprint grammar as the sign-in
 * card so it reads as part of the site rather than a framework default.
 */
export const metadata: Metadata = {
  title: `Not found — ${SITE.name}`,
  robots: { index: false, follow: false },
};

export default function NotFound() {
  return (
    <div style={{ minHeight: "100vh", display: "grid", placeItems: "center", padding: 24 }}>
      <div
        className="blueprint"
        style={{
          width: "100%",
          maxWidth: 380,
          padding: "36px 34px",
          background: "var(--color-surface)",
        }}
      >
        <i className="corner tl" />
        <i className="corner tr" />
        <i className="corner bl" />
        <i className="corner br" />

        <div
          style={{
            fontSize: 10,
            letterSpacing: ".18em",
            textTransform: "uppercase",
            color: "var(--color-accent-700)",
          }}
        >
          Error 404
        </div>
        <div
          style={{
            fontFamily: "var(--font-heading)",
            fontWeight: 600,
            fontSize: 19,
            lineHeight: 1.1,
            letterSpacing: ".02em",
            marginTop: 6,
          }}
        >
          Nothing at this address
        </div>

        <div style={{ height: 2, width: 58, background: "var(--color-accent)", margin: "22px 0" }} />

        <p style={{ margin: 0, fontSize: 13, lineHeight: 1.6, opacity: 0.75 }}>
          This link does not match a drive, a folder or a file. It may have been
          renamed, or it may never have existed.
        </p>

        <a href="/" style={{ display: "inline-block", marginTop: 18, fontSize: 12, opacity: 0.7 }}>
          ← All drives
        </a>
      </div>
    </div>
  );
}
