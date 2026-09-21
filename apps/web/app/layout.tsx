import type { ReactNode } from "react";
import Link from "next/link";
import "./globals.css";

export const metadata = {
  title: "ParcelPilot",
  description: "Preliminary zoning screen for Milwaukee infill parcels. Not an official zoning determination.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>
        <header className="flex items-center justify-between border-b border-line bg-surface px-6 py-3">
          <Link href="/" className="text-base font-semibold tracking-tight text-ink no-underline">
            ParcelPilot
          </Link>
          <nav className="flex items-center gap-4 text-sm text-muted">
            <Link href="/" className="text-muted no-underline hover:text-ink">
              Workspace
            </Link>
            <Link href="/projects" className="text-muted no-underline hover:text-ink">
              Projects
            </Link>
          </nav>
        </header>
        {children}
        <footer className="border-t border-line px-6 py-3 text-xs text-muted">
          Preliminary zoning screen — not an official zoning determination.
        </footer>
      </body>
    </html>
  );
}
