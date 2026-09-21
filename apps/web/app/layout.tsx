import type { ReactNode } from "react";
import { ClerkProvider, OrganizationSwitcher, SignedIn, SignedOut, SignInButton, UserButton } from "@clerk/nextjs";

export const metadata = {
  title: "ParcelPilot",
  description: "Preliminary zoning screen for Milwaukee infill parcels. Not an official zoning determination.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
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
