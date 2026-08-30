import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Yahya Khaled — Power Systems Drive",
  description: "Power systems study drive: folders, files, and admin management.",
  icons: { icon: "/assets/espark-bright.png" },
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
