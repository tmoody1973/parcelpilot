import { SignedIn, SignedOut } from "@clerk/nextjs";
import { devAuthEnabled } from "../lib/auth-mode.ts";

export default function HomePage() {
  return (
    <main>
      <h1>ParcelPilot</h1>
      <p>Preliminary zoning screen — not an official zoning determination.</p>
      {devAuthEnabled() ? (
        <p>Dev auth mode: identity comes from x-dev-user / x-dev-org headers. Open a project via the API.</p>
      ) : (
        <>
          <SignedOut>
            <p>Sign in to open a project.</p>
          </SignedOut>
          <SignedIn>
            <p>Pick an organization to work in, then open a project.</p>
          </SignedIn>
        </>
      )}
    </main>
  );
}
