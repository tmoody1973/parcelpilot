import { SignedIn, SignedOut } from "@clerk/nextjs";

export default function HomePage() {
  return (
    <main>
      <h1>ParcelPilot</h1>
      <p>Preliminary zoning screen — not an official zoning determination.</p>
      <SignedOut>
        <p>Sign in to open a project.</p>
      </SignedOut>
      <SignedIn>
        <p>Pick an organization to work in, then open a project.</p>
      </SignedIn>
    </main>
  );
}
