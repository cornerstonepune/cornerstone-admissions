// /api/admissions/settings/[id] — PATCH: rename, change the value, switch on/off or reorder one setting. Admin+.
// Kind and key never change here (ADR 0015 §1 guards them in the database too). Switching off is `active: false`;
// settings are never deleted from this screen, since leads and rules point at them (ADR 0011 §5).

import { NextResponse } from "next/server";

import { requireRole, toErrorResponse, type AccountContext } from "@/lib/auth/account";
import { isUuid } from "@/lib/api/v1/pagination";
import { checkRateLimit, rateLimitResponse, RATE_LIMITS } from "@/lib/rate-limit";
import { checkLabel, checkValue, type Setting } from "@/admissions/lib/settings";
import { bad, dbError, SETTING_COLUMNS, templateApproved } from "@/admissions/lib/settings-api";

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  let ctx: AccountContext;
  try {
    ctx = await requireRole("admin");
  } catch (err) {
    return toErrorResponse(err);
  }
  const limit = checkRateLimit(`admin:admissions-settings:${ctx.userId}`, RATE_LIMITS.adminAction);
  if (!limit.success) return rateLimitResponse(limit);

  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body || typeof body !== "object" || Array.isArray(body)) return bad("Send the change as JSON.");
  if (!isUuid(id)) return bad("Setting not found.", 404);

  const { data: stored, error: loadError } = await ctx.supabase
    .from("admissions_settings")
    .select(SETTING_COLUMNS)
    .eq("id", id)
    .eq("account_id", ctx.accountId)
    .maybeSingle<Setting>();
  if (loadError) return dbError(loadError);
  if (!stored) return bad("Setting not found.", 404);

  const update: Partial<Setting> = {};
  if ("label" in body) {
    const label = checkLabel(body.label);
    if (!label.ok) return bad(label.error);
    update.label = label.value;
  }
  if ("value" in body) {
    const value = checkValue(stored.kind, stored.key, body.value);
    if (!value.ok) return bad(value.error);
    update.value = value.value;
  }
  if ("active" in body) {
    if (typeof body.active !== "boolean") return bad("On must be true or false.");
    update.active = body.active;
  }
  if ("sort_order" in body) {
    if (!Number.isInteger(body.sort_order)) return bad("Order must be a whole number.");
    update.sort_order = body.sort_order as number;
  }
  if (Object.keys(update).length === 0) return NextResponse.json({ setting: stored });

  const approved = await templateApproved(ctx, update.value ?? stored.value);
  if (!approved && (update.active ?? stored.active)) update.active = false;

  const { data, error } = await ctx.supabase
    .from("admissions_settings")
    .update(update)
    .eq("id", id)
    .eq("account_id", ctx.accountId)
    .select(SETTING_COLUMNS)
    .maybeSingle();
  if (error) return dbError(error);
  // RLS hides an update it refuses: zero rows back means the caller may read the row but not change it.
  if (!data) return bad("Only an owner or admin can change settings.", 403);
  return NextResponse.json({ setting: data, templateNotApproved: !approved });
}
