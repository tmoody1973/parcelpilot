// Development-only identity switch, importable from middleware (edge runtime) and server code alike.
// True only when: not production AND no Clerk secret configured AND AUTH_MODE=dev. Impossible to enable in production.
export function devAuthEnabled(): boolean {
  return process.env["NODE_ENV"] !== "production" && !process.env["CLERK_SECRET_KEY"] && process.env["AUTH_MODE"] === "dev";
}
