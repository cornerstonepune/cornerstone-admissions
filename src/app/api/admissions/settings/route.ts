// /api/admissions/settings (S-admissions-settings, #70)
//
//   GET  — every setting of the caller's account, the latest changes with who made them, approved template names. Any member.
//   POST — add a setting of one kind. Admin+ (ADR 0006).
//
// Writes go through the caller's own RLS client, never the service role: the audit trigger (migration 105) records
// auth.uid() as changed_by, and RLS refuses non-admins a second time. The audit row is the trigger's job, not ours.

import { NextResponse } from "next/server";

import { getCurrentAccount, requireRole, toErrorResponse, type AccountContext } from "@/lib/auth/account";
import { checkRateLimit, rateLimitResponse, RATE_LIMITS } from "@/lib/rate-limit";
import { checkLabel, checkValue, isKind, keyFor, type SettingValue, type Stage } from "@/admissions/lib/settings";
import { bad, CHANGE_LIMIT, checkRefs, dbError, SETTING_COLUMNS } from "@/admissions/lib/settings-api";

export async function GET() {
  try {
    const ctx = await getCurrentAccount();
    const [settings, changes, templates, stageRows] = await Promise.all([
      ctx.supabase
        .from("admissions_settings")
        .select(SETTING_COLUMNS)
        .eq("account_id", ctx.accountId)
        .order("sort_order")
        .order("label"),
      ctx.supabase
        .from("settings_changes")
        .select("id, kind, key, action, old_value, new_value, changed_by, changed_at")
        .eq("account_id", ctx.accountId)
        .order("changed_at", { ascending: false })
        .limit(CHANGE_LIMIT),
      ctx.supabase.from("message_templates").select("name").eq("account_id", ctx.accountId).eq("status", "APPROVED"),
      ctx.supabase
        .from("pipeline_stages")
        .select("id, name, position, pipeline_id, pipelines!inner(account_id, name)")
        .eq("pipelines.account_id", ctx.accountId)
        .order("pipeline_id")
        .order("position"),
    ]);
    const failed = settings.error ?? changes.error ?? templates.error ?? stageRows.error;
    if (failed) {
      console.error("[admissions/settings] load failed:", failed);
      return bad("Couldn't load settings.", 500);
    }
    const ids = [...new Set((changes.data ?? []).map((c) => c.changed_by).filter(Boolean))];
    const { data: people } = ids.length
      ? await ctx.supabase.from("profiles").select("user_id, full_name").in("user_id", ids)
      : { data: [] };
    const names = Object.fromEntries((people ?? []).map((p) => [p.user_id, p.full_name]));
    const approved = [...new Set((templates.data ?? []).map((t) => t.name as string))].sort();
    // Stages by id with today's names; prefixed by the pipeline only when the account has more than one.
    const rows = (stageRows.data ?? []) as unknown as { id: string; name: string; pipeline_id: string; pipelines: { name: string } }[];
    const several = new Set(rows.map((r) => r.pipeline_id)).size > 1;
    const stages: Stage[] = rows.map((r, i) => ({
      id: r.id,
      name: several ? `${r.pipelines.name} › ${r.name}` : r.name,
      last: rows[i + 1]?.pipeline_id !== r.pipeline_id,
    }));
    return NextResponse.json({ role: ctx.role, settings: settings.data, changes: changes.data, names, templates: approved, stages });
  } catch (err) {
    return toErrorResponse(err);
  }
}

export async function POST(request: Request) {
  let ctx: AccountContext;
  try {
    ctx = await requireRole("admin");
  } catch (err) {
    return toErrorResponse(err);
  }
  const limit = checkRateLimit(`admin:admissions-settings:${ctx.userId}`, RATE_LIMITS.adminAction);
  if (!limit.success) return rateLimitResponse(limit);

  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body || typeof body !== "object" || Array.isArray(body)) return bad("Send the setting as JSON.");
  if (!isKind(body.kind)) return bad("Unknown kind of setting.");
  const label = checkLabel(body.label);
  if (!label.ok) return bad(label.error);
  const key = keyFor(body.kind, label.value, (body.value ?? {}) as SettingValue, body.key);
  const value = checkValue(body.kind, key, body.value);
  if (!value.ok) return bad(value.error);
  const finalKey = keyFor(body.kind, label.value, value.value, body.key);
  if (!/^[a-z0-9_]+$/.test(finalKey)) return bad("Use letters or numbers in the name.");

  const refs = await checkRefs(ctx, body.kind, finalKey, value.value);
  if (refs instanceof Response) return refs;
  const { approved } = refs;
  const { data, error } = await ctx.supabase
    .from("admissions_settings")
    .insert({
      account_id: ctx.accountId,
      kind: body.kind,
      key: finalKey,
      label: label.value,
      value: value.value,
      active: approved && body.active !== false,
      sort_order: Number.isInteger(body.sort_order) ? body.sort_order : 0,
    })
    .select(SETTING_COLUMNS)
    .single();
  if (error) return dbError(error);
  return NextResponse.json({ setting: data, templateNotApproved: !approved }, { status: 201 });
}
