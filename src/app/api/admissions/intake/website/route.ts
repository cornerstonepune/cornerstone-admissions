// POST /api/admissions/intake/website — the school website's enquiry form (M4, #67). Public, so a trust boundary:
// the account comes from the server (ADMISSIONS_ACCOUNT_ID), never the request; every field is checked here; each IP
// gets a few tries per ten minutes; the answer is the same whether or not the family was already with us.
// Takes JSON (from a server) or a plain HTML form post (urlencoded, no CORS preflight needed).
import { NextResponse } from "next/server";

import { supabaseAdmin } from "@/lib/flows/admin-client";
import { checkRateLimit, getClientIp, rateLimitResponse } from "@/lib/rate-limit";
import { readCappedBody } from "@/lib/whatsapp/webhook-body";
import { intake, parseDob, phoneDigits } from "@/admissions/lib/intake";

const LIMIT = { limit: 5, windowMs: 10 * 60_000 };
const MAX_BYTES = 4_000;
const FIELDS = { phone: 20, parent: 80, child: 80, dob: 20, area: 80 } as const;
const bad = (error: string, status = 400) => NextResponse.json({ error }, { status });

export async function POST(request: Request) {
  const accountId = process.env.ADMISSIONS_ACCOUNT_ID;
  if (!accountId) return bad("The enquiry form is not set up yet.", 503);
  const limit = checkRateLimit(`admissions-website-form:${getClientIp(request)}`, LIMIT);
  if (!limit.success) return rateLimitResponse(limit);

  const raw = await readCappedBody(request, MAX_BYTES); // stops reading at the cap: a public body can be any size
  if (raw === null) return bad("The form is too long.", 413);
  let body: Record<string, unknown>;
  try {
    const json = (request.headers.get("content-type") ?? "").includes("application/json");
    body = json ? JSON.parse(raw) : Object.fromEntries(new URLSearchParams(raw));
  } catch {
    return bad("Send the form as JSON or a form post.");
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) return bad("Send the form as JSON or a form post.");

  const f: Partial<Record<keyof typeof FIELDS, string>> = {};
  for (const [k, max] of Object.entries(FIELDS) as [keyof typeof FIELDS, number][]) {
    const v = body[k];
    if (v === undefined || v === null || v === "") continue;
    if (typeof v !== "string" || v.trim().length > max) return bad(`Check the ${k} field.`);
    f[k] = v.trim();
  }
  if (!phoneDigits(f.phone)) return bad("Enter a 10-digit mobile number.");
  if (!f.parent) return bad("Enter the parent's name.");
  const dob = f.dob ? parseDob(f.dob) : null;
  if (f.dob && !dob) return bad("Enter the date of birth as DD/MM/YYYY.");

  const day = new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "short", timeZone: "Asia/Kolkata" }).format(new Date());
  try {
    await intake(supabaseAdmin(), accountId, {
      phone: f.phone,
      parent: f.parent,
      child: f.child,
      dob,
      area: f.area,
      sources: ["website"],
      note: `Enquired again on the website, ${day}.`,
    });
  } catch (err) {
    console.error("[admissions/intake/website] failed:", err);
    return bad("Couldn't send the form. Please try again.", 500);
  }
  return NextResponse.json({ ok: true }, { status: 201 });
}
