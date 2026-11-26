// POST /api/admissions/import (M7, #71, ADR 0027) — the old enquiry sheet as CSV text → one open lead per good row.
// Admin+ (ADR 0006). Rows are validated in src/admissions/lib/import.ts; import_leads (migration 116) writes them as the
// caller, through RLS, and dedupes by phone. Answers in the shape wacrm's import dialog already shows.
import { NextResponse } from "next/server";

import { requireRole, toErrorResponse, type AccountContext } from "@/lib/auth/account";
import { checkRateLimit, rateLimitResponse, RATE_LIMITS } from "@/lib/rate-limit";
import { parseLeadSheet, type Choice } from "@/admissions/lib/import";

const MAX_BYTES = 1_000_000;
const bad = (error: string, status = 400) => NextResponse.json({ error }, { status });

export async function POST(request: Request) {
  let ctx: AccountContext;
  try {
    ctx = await requireRole("admin");
  } catch (err) {
    return toErrorResponse(err);
  }
  const limit = checkRateLimit(`admin:admissions-import:${ctx.userId}`, RATE_LIMITS.adminAction);
  if (!limit.success) return rateLimitResponse(limit);

  const text = await request.text();
  if (!text.trim()) return bad("The sheet is empty.");
  if (text.length > MAX_BYTES) return bad("The sheet is too big: import it in parts of 2000 rows.", 413);

  const [settings, stages] = await Promise.all([
    ctx.supabase.from("admissions_settings").select("id, kind, label").eq("account_id", ctx.accountId).in("kind", ["campus", "source"]),
    ctx.supabase
      .from("pipeline_stages")
      .select("id, name, pipelines!inner(account_id, name)")
      .eq("pipelines.account_id", ctx.accountId)
      .eq("pipelines.name", "Admissions")
      .order("position"),
  ]);
  if (settings.error || stages.error) {
    console.error("[admissions/import] lookups failed:", settings.error ?? stages.error);
    return bad("Couldn't read campuses, sources and stages.", 500);
  }
  const of = (kind: string): Choice[] => (settings.data ?? []).filter((s) => s.kind === kind);
  const { rows, lines, errors } = parseLeadSheet(text, {
    campuses: of("campus"),
    sources: of("source"),
    stages: (stages.data ?? []).map((s) => ({ id: s.id, label: s.name })),
  });

  let outcomes: { status: "imported" | "duplicate" | "failed"; error?: string }[] = [];
  if (rows.length) {
    const { data, error } = await ctx.supabase.rpc("import_leads", { p_account_id: ctx.accountId, p_rows: rows });
    if (error) {
      console.error("[admissions/import] import_leads failed:", error);
      return bad("Couldn't import the sheet. Nothing was imported.", 500);
    }
    outcomes = data ?? [];
  }
  const failedDetails = errors.map((e) => ({ phone: e.phone, name: e.name, reason: `Line ${e.line}: ${e.reason}` }));
  outcomes.forEach((o, i) => {
    if (o.status === "failed")
      failedDetails.push({ phone: `+${rows[i].phone}`, name: rows[i].child || rows[i].parent || undefined, reason: `Line ${lines[i]}: ${o.error}` });
  });
  return NextResponse.json({
    imported: outcomes.filter((o) => o.status === "imported").length,
    skipped: outcomes.filter((o) => o.status === "duplicate").length,
    invalidPhone: 0,
    failed: failedDetails.length,
    failedDetails,
    tagsAssigned: 0,
  });
}
