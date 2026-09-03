import type { Metadata, Viewport } from "next";
import { driveFor } from "@/lib/brand";
import "./globals.css";

const main = driveFor("main");

/** Defaults for the main drive; the eSpark route sets its own title and manifest. */
export const metadata: Metadata = {
  title: main.title,
  description: main.description,
  icons: {
    icon: "/assets/espark-bright.png",
    apple: "/assets/espark-bright.png",
  },
  manifest: "/manifest.webmanifest",
  appleWebApp: {
    capable: true,
    title: main.shortName,
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
