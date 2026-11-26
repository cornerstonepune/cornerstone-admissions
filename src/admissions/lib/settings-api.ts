// Server helpers shared by the two /api/admissions/settings routes (a route file may export only its handlers).
import { NextResponse } from "next/server";

import type { AccountContext } from "@/lib/auth/account";
import type { SettingValue } from "@/admissions/lib/settings";

export const SETTING_COLUMNS = "id, kind, key, label, value, active, sort_order";
export const CHANGE_LIMIT = 100;

export const bad = (error: string, status = 400) => NextResponse.json({ error }, { status });

/** Maps a Postgres error from a settings write onto the answer the screen shows. */
export function dbError(e: { code?: string; message: string }) {
  if (e.code === "42501") return bad("Only an owner or admin can change settings.", 403);
  if (e.code === "23505") return bad("A setting with this name already exists.", 409);
  if (e.code === "23514" || e.code === "23503") return bad(e.message);
  console.error("[admissions/settings] write failed:", e);
  return bad("Couldn't save the setting.", 500);
}

/** A rule that sends a template stays off until Meta has approved that template (wireframe, "Other states"). */
export async function templateApproved(ctx: AccountContext, value: SettingValue): Promise<boolean> {
  if (value.action !== "send_template") return true;
  const { data } = await ctx.supabase
    .from("message_templates")
    .select("id")
    .eq("account_id", ctx.accountId)
    .eq("name", value.template as string)
    .eq("status", "APPROVED")
    .limit(1);
  return (data?.length ?? 0) > 0;
}
