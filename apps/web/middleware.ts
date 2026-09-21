import { clerkMiddleware } from "@clerk/nextjs/server";

// Attaches the Clerk session to every request so `auth()` works in route handlers and server
// components. Route handlers still enforce org scope themselves via `requireOrgContext`.
export default clerkMiddleware();

export const config = {
  matcher: [
    // Skip Next internals and static files unless referenced in search params.
    "/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)",
    // Always run for API routes.
    "/(api|trpc)(.*)",
  ],
};
