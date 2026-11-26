// POST /api/admissions/intake/website — the school website's enquiry form (M4, #67). Public, so a trust boundary:
// the account comes from the server (ADMISSIONS_ACCOUNT_ID), never the request; every field is checked here; each IP
// gets a few tries per ten minutes (per process, by X-Real-IP: production must sit behind a proxy that overwrites it,
// ADR 0031); the answer is the same whether or not the family was already with us, or the post looked like a bot.
// Takes JSON (from a server) or a plain HTML form post (urlencoded, no CORS preflight needed).
import { NextResponse } from "next/server";

import { supabaseAdmin } from "@/lib/flows/admin-client";
import { checkRateLimit, getClientIp, rateLimitResponse } from "@/lib/rate-limit";
import { readCappedBody } from "@/lib/whatsapp/webhook-body";
import { intake, parseDob, phoneDigits } from "@/admissions/lib/intake";

const LIMIT = { limit: 5, windowMs: 10 * 60_000 };
const MAX_BYTES = 4_000;
const FIELDS = { phone: 20, parent: 80, child: 80, dob: 20, area: 80 } as const;
const MIN_FILL_MS = 3_000;
const bad = (error: string, status = 400) => NextResponse.json({ error }, { status });
const OK = () => NextResponse.json({ ok: true }, { status: 201 });

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
  if (looksLikeABot(body)) return OK(); // same answer as a real enquiry, so a bot learns nothing; nothing is written

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
      fill: false, // an anonymous form never changes a family already with us: it only leaves a note
    });
  } catch (err) {
    console.error("[admissions/intake/website] failed:", err);
    return bad("Couldn't send the form. Please try again.", 500);
  }
  return OK();
}

/** Spam checks the website's form opts into: `website_url` is a hidden input people never fill (a honeypot), and
 * `started_at` (ms since 1970, set when the form was shown) must be at least 3 s ago. A server posting JSON sends
 * neither. shortcut: both are cheap filters for naive bots, not a defence; add a CAPTCHA if real spam gets through. */
function looksLikeABot(body: Record<string, unknown>): boolean {
  if (body.website_url !== undefined && body.website_url !== "") return true;
  if (body.started_at === undefined || body.started_at === "") return false;
  const started = Number(body.started_at);
  return !Number.isFinite(started) || Date.now() - started < MIN_FILL_MS;
}
