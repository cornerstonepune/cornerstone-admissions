// Server helpers shared by the two /api/admissions/settings routes (a route file may export only its handlers).
import { NextResponse } from "next/server";

import type { AccountContext } from "@/lib/auth/account";
import { stageIdOf, type SettingKind, type SettingValue } from "@/admissions/lib/settings";

export const SETTING_COLUMNS = "id, kind, key, label, value, active, sort_order";
export const CHANGE_LIMIT = 100;

export const bad = (error: string, status = 400) => NextResponse.json({ error }, { status });

/** Maps a Postgres error from a settings read or write onto the answer the screen shows. */
export function dbError(e: { code?: string; message: string }) {
  if (e.code === "42501") return bad("Only an owner or admin can change settings.", 403);
  if (e.code === "23505") return bad("A setting like this already exists.", 409);
  if (e.code === "23514" || e.code === "23503") return bad(e.message);
  console.error("[admissions/settings] query failed:", e);
  return bad("Couldn't save the setting.", 500);
}

/**
 * Checks what a rule or alert points at, before it is saved:
 *  - its stage must be a stage of one of the caller's pipelines (400 otherwise);
 *  - a rule that sends a template stays off until Meta has approved it (wireframe, "Other states"): `approved: false`.
 * A failed lookup answers 500, never a quiet "not approved" (#81 review).
 */
export async function checkRefs(
  ctx: AccountContext,
  kind: SettingKind,
  key: string,
  value: SettingValue,
): Promise<{ approved: boolean } | NextResponse> {
  const stageId = stageIdOf(kind, key, value);
  if (stageId) {
    const { data, error } = await ctx.supabase
      .from("pipeline_stages")
      .select("id, pipelines!inner(account_id)")
      .eq("id", stageId)
      .eq("pipelines.account_id", ctx.accountId)
      .limit(1);
    if (error) return dbError(error);
    if (!data?.length) return bad("Pick a stage of your pipeline.");
  }
  if (kind !== "follow_up_rule" || value.action !== "send_template") return { approved: true };
  const { data, error } = await ctx.supabase
    .from("message_templates")
    .select("id")
    .eq("account_id", ctx.accountId)
    .eq("name", value.template as string)
    .eq("status", "APPROVED")
    .limit(1);
  if (error) return dbError(error);
  return { approved: (data?.length ?? 0) > 0 };
}
