import type { ReactNode } from "react";
import { ApiClientError } from "../lib/api-client.ts";
import { Empty } from "./ui.tsx";

// The reviewer pages fetch through the role-gated API. A 403 means the caller is not a reviewer: show a plain
// gate and nothing else. The server never sent any queue data, so there is nothing to hide client-side.
export function isForbidden(e: unknown): boolean {
  return e instanceof ApiClientError && e.status === 403;
}

export function GatePage(): ReactNode {
  return (
    <main className="mx-auto max-w-2xl p-6" data-testid="review-gate">
      <h1 className="text-lg font-semibold text-ink">Reviewer role required</h1>
      <p className="mt-2 text-sm text-muted">The review workbench is limited to members with the reviewer, admin, or owner role in the active organization. Ask an owner to change your membership role.</p>
    </main>
  );
}

export function LoadError({ error }: { error: unknown }): ReactNode {
  return <Empty>{error instanceof Error ? error.message : "Something went wrong."}</Empty>;
}
