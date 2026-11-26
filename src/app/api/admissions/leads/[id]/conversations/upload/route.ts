import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { requireRole, toErrorResponse } from "@/lib/auth/account";
import { isUuid } from "@/lib/api/v1/pagination";
import { AUDIO_BUCKET, AUDIO_EXT } from "@/admissions/lib/audio";

/**
 * POST /api/admissions/leads/[id]/conversations/upload — { mime } → { path, token }: a one-off signed upload into the
 * private audio bucket at <account>/<lead>/<uuid>.<ext>. The browser uploads straight to Storage with it, so the file
 * never passes through this server. Made with the caller's session, so the bucket's agent+ policy applies.
 */
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  if (!isUuid(id)) return NextResponse.json({ error: "Not a valid id" }, { status: 400 });
  try {
    const { supabase, accountId } = await requireRole("agent");
    const body = (await request.json().catch(() => null)) as { mime?: unknown } | null;
    const ext = typeof body?.mime === "string" ? AUDIO_EXT[body.mime] : undefined;
    if (!ext) return NextResponse.json({ error: "That isn't an audio file we can take" }, { status: 422 });
    const { data: lead } = await supabase.from("leads").select("id").eq("id", id).maybeSingle();
    if (!lead) return NextResponse.json({ error: "Lead not found" }, { status: 404 });
    const path = `${accountId}/${id}/${randomUUID()}.${ext}`;
    const { data, error } = await supabase.storage.from(AUDIO_BUCKET).createSignedUploadUrl(path);
    if (error || !data) return NextResponse.json({ error: "Couldn't prepare the upload" }, { status: 500 });
    return NextResponse.json({ path, token: data.token });
  } catch (err) {
    return toErrorResponse(err);
  }
}
