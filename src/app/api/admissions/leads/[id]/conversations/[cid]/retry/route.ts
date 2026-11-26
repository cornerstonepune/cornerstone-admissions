import { after, NextResponse } from "next/server";
import { requireRole, toErrorResponse } from "@/lib/auth/account";
import { supabaseAdmin } from "@/lib/automations/admin-client";
import { isUuid } from "@/lib/api/v1/pagination";
import { statusOf } from "@/admissions/lib/pipeline";
import { processConversation, retryPatch } from "@/admissions/lib/conversations";

/**
 * POST /api/admissions/leads/[id]/conversations/[cid]/retry — a failed conversation gets three fresh tries. Agent+.
 * The row is read under RLS (so it must be in the caller's account); staff have no UPDATE on the table, so the reset is
 * written with the service role, and only the job columns retryPatch names.
 */
export const maxDuration = 300;

export async function POST(_request: Request, context: { params: Promise<{ id: string; cid: string }> }) {
  const { id, cid } = await context.params;
  if (!isUuid(id) || !isUuid(cid)) return NextResponse.json({ error: "Not a valid id" }, { status: 400 });
  try {
    const { supabase } = await requireRole("agent");
    const { data: row } = await supabase
      .from("lead_conversations")
      .select("status, audio_path, transcript_en")
      .eq("id", cid)
      .eq("lead_id", id)
      .maybeSingle();
    if (!row) return NextResponse.json({ error: "Conversation not found" }, { status: 404 });
    if (row.status !== "failed") return NextResponse.json({ error: "Only a failed conversation can be retried" }, { status: 409 });
    const { error } = await supabaseAdmin()
      .from("lead_conversations")
      .update(retryPatch(row))
      .eq("id", cid)
      .eq("status", "failed");
    if (error) return NextResponse.json({ error: error.message }, { status: statusOf(error.code) });
    after(() => processConversation(cid));
    return NextResponse.json({ ok: true });
  } catch (err) {
    return toErrorResponse(err);
  }
}
