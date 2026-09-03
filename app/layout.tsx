import type { Metadata, Viewport } from "next";
import { brand } from "@/lib/brand";
import "./globals.css";

/**
 * Metadata is a function rather than a constant so the tab title follows
 * DRIVE_VARIANT — the same build serves more than one drive.
 */
export function generateMetadata(): Metadata {
  const b = brand();
  return {
    title: b.title,
    description: b.description,
    icons: {
      icon: "/assets/espark-bright.png",
      apple: "/assets/espark-bright.png",
    },
    manifest: "/manifest.webmanifest",
    appleWebApp: {
      capable: true,
      title: b.shortName,
      statusBarStyle: "default",
    },
  };
}

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
