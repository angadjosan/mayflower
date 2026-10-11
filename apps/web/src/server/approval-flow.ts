import { describeTerms, type ApproveResult } from "./proposals";
import { executeApproval } from "./execution";
import { sendToUser } from "./notify";
import { getUser } from "./users";

/** After a recorded approval: execute, tell the user (iMessage + chat mirror), and say where to go next. */
export async function finishApproval(result: Extract<ApproveResult, { ok: true }>, userId: string): Promise<{ message: string; next: string | null; status: string }> {
  const exec = await executeApproval(userId, result.approvalId);
  const user = await getUser(userId);
  const terms = describeTerms(result.proposal, result.proposal.rationale.title);
  const message = `Approved: ${terms} ${exec.message}`;
  await sendToUser(user, message);
  const next = exec.status === "needs_link" || exec.status === "needs_terms" ? "/link" : null;
  return { message, next, status: exec.status };
}
