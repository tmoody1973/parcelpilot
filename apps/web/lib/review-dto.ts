// Type-only re-exports of the review store's wire shapes, so client components import no server code.
import type { TaskDetail as StoreTaskDetail } from "@parcelpilot/db";
import type { OrgRole } from "@parcelpilot/contracts";
export type { ApproveResult, AuditRef, CanonicalRow, FragmentRef, PageRef, ReviewTask, SourceSummary, TaskSubject, TaskType } from "@parcelpilot/db";
// The detail route adds the caller's role so the editor can say up front what the server will refuse.
export type TaskDetail = StoreTaskDetail & { viewer_role: OrgRole };
