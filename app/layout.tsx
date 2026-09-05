import type { Metadata, Viewport } from "next";
import { SITE } from "@/lib/brand";
import "./globals.css";

/**
 * The shell wears the site's identity, not a drive's. Drives are rows now, so
 * the layout cannot know which one — if any — is about to render; each drive
 * route overrides the title, description and manifest with its own.
 */
export const metadata: Metadata = {
  title: SITE.title,
  description: SITE.description,
  icons: {
    icon: "/assets/espark-bright.png",
    apple: "/assets/espark-bright.png",
  },
  manifest: "/manifest.webmanifest",
  appleWebApp: {
    capable: true,
    title: SITE.name,
    statusBarStyle: "default",
  },
};

/**
 * viewportFit: "cover" lets the page reach under a notch; the body then pads
 * itself back out with the safe-area insets. maximumScale is deliberately
 * unset — capping zoom would lock out anyone who needs to enlarge text.
 */
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f2f2f3" },
    { media: "(prefers-color-scheme: dark)", color: "#141e28" },
  ],
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
