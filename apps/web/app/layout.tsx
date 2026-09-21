import type { ReactNode } from "react";
import { ClerkProvider, OrganizationSwitcher, SignedIn, SignedOut, SignInButton, UserButton } from "@clerk/nextjs";

export const metadata = {
  title: "ParcelPilot",
  description: "Preliminary zoning screen for Milwaukee infill parcels. Not an official zoning determination.",
};

// The layout wraps every route in ClerkProvider, which needs a publishable key to render. Rendering
// on demand (not at build) keeps `next build` from needing that key; this cascades to all pages below.
export const dynamic = "force-dynamic";

import { devAuthEnabled } from "../lib/auth-mode.ts";

export default function RootLayout({ children }: { children: ReactNode }) {
  if (devAuthEnabled()) {
    return (
      <html lang="en">
        <body>
          <header style={{ padding: "0.75rem 1rem" }}><strong>ParcelPilot</strong> <small>(dev auth mode)</small></header>
          {children}
        </body>
      </html>
    );
  }
  return (
    <ClerkProvider>
      <html lang="en">
        <body>
          <header style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "0.75rem 1rem" }}>
            <strong>ParcelPilot</strong>
            <span style={{ display: "flex", gap: "0.75rem", alignItems: "center" }}>
              <SignedIn>
                <OrganizationSwitcher hidePersonal />
                <UserButton />
              </SignedIn>
              <SignedOut>
                <SignInButton />
              </SignedOut>
            </span>
          </header>
          {children}
        </body>
      </html>
    </ClerkProvider>
  );
}
