import "server-only";
import { billingRpc } from "@/lib/server/billing-state";
import { adminUser } from "@/lib/server/usage";
import type { Run } from "@/lib/types";
export async function beginAI(who: string, run: Run, kind: "product" | "script", input: unknown) {
 const result = await billingRpc<{ token?: string; error?: string }>("mavya_begin_ai", { p_user: who, p_run: run.id, p_kind: kind, p_expected: run.updatedAt, p_input: input, p_admin: await adminUser(who) });
 return result.token ? { token: result.token } : { response: Response.json({ error: result.error === "plan" ? "Choose a plan first." : result.error === "limit" ? "Daily limit reached. Try tomorrow." : "Your run changed. Try again." }, { status: result.error === "plan" ? 402 : result.error === "limit" ? 429 : 409 }) };
}
export async function finishAI(who: string, run: Run, kind: "product" | "script", token: string, patch: Partial<Run>) {
 const updated = await billingRpc<Run | null>("mavya_finish_ai", { p_user: who, p_run: run.id, p_kind: kind, p_token: token, p_patch: patch });
 return updated ? Response.json(updated) : Response.json({ error: "Your run changed. Try again." }, { status: 409 });
}
