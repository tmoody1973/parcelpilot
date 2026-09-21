// Rendered on demand, not prerendered: it sits inside the root layout's ClerkProvider, which needs
// a publishable key. Forcing it dynamic keeps `next build` from needing that key at build time.
export const dynamic = "force-dynamic";

export default function NotFound() {
  return (
    <main>
      <h1>Page not found</h1>
    </main>
  );
}
