import { isDeepStrictEqual } from "node:util";
import type postgres from "postgres";
import type { DecisionPolicy } from "@parcelpilot/contracts";

// The id a run records for the policy it ran under (MOO-834). The code's copy is the authority; the database row with
// the same version must hold exactly the same object, or runs would name a policy they did not use.
export async function decisionPolicyVersionId(sql: postgres.Sql | postgres.TransactionSql, policy: DecisionPolicy): Promise<string> {
  const [row] = await sql<{ id: string; config: unknown }[]>`select id, config from decision_policy_versions where version = ${policy.version}`;
  if (!row) throw new Error(`decision policy ${policy.version} is not in decision_policy_versions (apply migrations)`);
  if (!isDeepStrictEqual(row.config, policy)) throw new Error(`decision policy ${policy.version} in the database differs from the code's copy`);
  return row.id;
}
