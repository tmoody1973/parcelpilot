import { clerkMiddleware } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";
import { devAuthEnabled } from "./lib/auth-mode.ts";

// Attaches the Clerk session to every request so `auth()` works in route handlers and server
// components. Route handlers still enforce org scope themselves via `requireOrgContext`.
// In dev auth mode (no Clerk keys, AUTH_MODE=dev, never production) the middleware is a pass-through.
export default devAuthEnabled() ? () => NextResponse.next() : clerkMiddleware();

export const config = {
  matcher: [
    // Skip Next internals and static files unless referenced in search params.
    "/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)",
    // Always run for API routes.
    "/(api|trpc)(.*)",
  ],
};
