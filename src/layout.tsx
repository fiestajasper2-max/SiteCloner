import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Site Cloner",
  description: "Paste a URL. Get a frontend mirror that still talks to the original backend where possible.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen font-sans">{children}</body>
    </html>
  );
}
