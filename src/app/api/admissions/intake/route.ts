// POST /api/admissions/intake — staff quick-add (M4, #67, S-quick-add). Agent and up (ADR 0006). Runs through intake()
// as the caller, so RLS keeps it to their account. A number already with us gets a note on its open lead, not a second.
import { NextResponse } from "next/server";

import { requireRole, toErrorResponse, type AccountContext } from "@/lib/auth/account";
import { checkRateLimit, rateLimitResponse, RATE_LIMITS } from "@/lib/rate-limit";
import { intake, IntakeError, isEmail, phoneDigits, QUICK_ADD_SOURCES } from "@/admissions/lib/intake";

const bad = (error: string, status = 400) => NextResponse.json({ error }, { status });
const name = (v: unknown) => (typeof v === "string" ? v.trim() : "");

export async function POST(request: Request) {
  let ctx: AccountContext;
  try {
    ctx = await requireRole("agent");
  } catch (err) {
    return toErrorResponse(err);
  }
  const limit = checkRateLimit(`admissions-quick-add:${ctx.userId}`, RATE_LIMITS.adminAction);
  if (!limit.success) return rateLimitResponse(limit);

  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body || typeof body !== "object") return bad("Send the family's details.");
  if (!phoneDigits(typeof body.phone === "string" ? body.phone : "")) return bad("Enter a 10-digit mobile number.");
  const parent = name(body.parent);
  const child = name(body.child);
  if (!parent || parent.length > 80) return bad("Enter the parent's name.");
  if (child.length > 80) return bad("Keep the child's name to 80 characters.");
  const email = name(body.email).toLowerCase();
  if (email && !isEmail(email)) return bad("Enter a valid email address.");
  // no source (none set up, or switched off in Settings) still saves: the lead's source stays empty
  const source = body.source === undefined || body.source === null || body.source === "" ? null : body.source;
  if (source !== null && !(QUICK_ADD_SOURCES as readonly unknown[]).includes(source)) return bad("Pick how they reached us.");

  const { data: me } = await ctx.supabase.from("profiles").select("full_name").eq("user_id", ctx.userId).maybeSingle();
  const day = new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "short", timeZone: "Asia/Kolkata" }).format(new Date());
  try {
    const r = await intake(ctx.supabase, ctx.accountId, {
      phone: body.phone as string,
      parent,
      child: child || undefined,
      sources: source === null ? [] : [source as string],
      note: `Came in again, ${day}${me?.full_name ? `, ${me.full_name}` : ""}.`,
    });
    // the parent's email, if given, fills an empty one; an email already on file is changed only in the lead panel
    if (email) await ctx.supabase.from("contacts").update({ email }).eq("id", r.contact_id).is("email", null);
    return NextResponse.json({ created: r.created, lead_id: r.lead_id }, { status: r.created ? 201 : 200 });
  } catch (err) {
    if (err instanceof IntakeError) return bad(err.message);
    console.error("[admissions/intake] quick-add failed:", err);
    return bad("Couldn't save. Nothing was lost.", 500);
  }
}
