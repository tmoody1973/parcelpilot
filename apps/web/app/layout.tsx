import type { ReactNode } from "react";
import Link from "next/link";
import { ClerkProvider, OrganizationSwitcher, SignedIn, SignedOut, SignInButton, UserButton } from "@clerk/nextjs";
import { devAuthEnabled } from "../lib/auth-mode.ts";
import "./globals.css";

export const metadata = {
  title: "ParcelPilot",
  description: "Preliminary zoning screen for Milwaukee infill parcels. Not an official zoning determination.",
};

// ClerkProvider needs a publishable key to render; rendering on demand keeps `next build` key-free.
export const dynamic = "force-dynamic";

function Shell({ children, controls }: { children: ReactNode; controls: ReactNode }) {
  return (
    <html lang="en">
      <body>
        <header className="flex items-center justify-between border-b border-line bg-surface px-6 py-3">
          <Link href="/" className="text-base font-semibold tracking-tight text-ink no-underline">ParcelPilot</Link>
          <nav className="flex items-center gap-4 text-sm text-muted">
            <Link href="/" className="text-muted no-underline hover:text-ink">Workspace</Link>
            <Link href="/projects" className="text-muted no-underline hover:text-ink">Projects</Link>
            {controls}
          </nav>
        </header>
        {children}
        <footer className="border-t border-line px-6 py-3 text-xs text-muted">Preliminary zoning screen — not an official zoning determination.</footer>
      </body>
    </html>
  );
}

export default function RootLayout({ children }: { children: ReactNode }) {
  if (devAuthEnabled()) return <Shell controls={<span className="rounded bg-accent-soft px-2 py-0.5 text-xs">dev auth</span>}>{children}</Shell>;
  return (
    <ClerkProvider>
      <Shell controls={<><SignedIn><OrganizationSwitcher hidePersonal /><UserButton /></SignedIn><SignedOut><SignInButton /></SignedOut></>}>{children}</Shell>
    </ClerkProvider>
  );
}
