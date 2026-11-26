import { after, NextResponse } from "next/server";
import { requireRole, toErrorResponse } from "@/lib/auth/account";
import { isUuid } from "@/lib/api/v1/pagination";
import { statusOf } from "@/admissions/lib/pipeline";
import { AUDIO_BUCKET, AUDIO_EXT } from "@/admissions/lib/audio";
import { OPEN_STATUSES, processConversation } from "@/admissions/lib/conversations";

/**
 * GET  /api/admissions/leads/[id]/conversations — the lead's conversation log, newest first, each with a 10-minute
 *      signed audio URL. Any still being processed are checked again after the response ("check now").
 * POST /api/admissions/leads/[id]/conversations — { kind, happened_at, typed_note?, audio_path?, duration_s? } logs one
 *      (audio already uploaded via ./upload) and starts processing after the response. RLS: agent+ writes.
 */
export const maxDuration = 300;

type Ctx = { params: Promise<{ id: string }> };
const KINDS = ["call", "visit", "meeting", "note"];
const AUDIO_PATH = new RegExp(`^[0-9a-f-]{36}/[0-9a-f-]{36}/[0-9a-f-]{36}\\.(${[...new Set(Object.values(AUDIO_EXT))].join("|")})$`);

export async function GET(_request: Request, context: Ctx) {
  const { id } = await context.params;
  if (!isUuid(id)) return NextResponse.json({ error: "Not a valid id" }, { status: 400 });
  try {
    const { supabase } = await requireRole("viewer");
    const { data: rows, error } = await supabase
      .from("lead_conversations")
      .select(
        "id, kind, happened_at, created_by, audio_path, audio_deleted_at, duration_s, typed_note, status, error, " +
          "transcript_en, summary, concerns, questions, action_points, interest, suggested_stage, created_at",
      )
      .eq("lead_id", id)
      .order("happened_at", { ascending: false });
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    const list = (rows ?? []) as unknown as Record<string, unknown>[];

    const paths = list.map((r) => r.audio_path).filter((p): p is string => typeof p === "string");
    const { data: signed } = paths.length
      ? await supabase.storage.from(AUDIO_BUCKET).createSignedUrls(paths, 600)
      : { data: [] as { path: string | null; signedUrl: string }[] };
    const urls = Object.fromEntries((signed ?? []).map((s) => [s.path, s.signedUrl]));

    const userIds = [...new Set(list.map((r) => r.created_by).filter((u): u is string => typeof u === "string"))];
    const { data: people } = userIds.length
      ? await supabase.from("profiles").select("user_id, full_name").in("user_id", userIds)
      : { data: [] as { user_id: string; full_name: string | null }[] };
    const names = Object.fromEntries((people ?? []).map((p) => [p.user_id, p.full_name]));

    const open = list.filter((r) => (OPEN_STATUSES as readonly unknown[]).includes(r.status)).slice(0, 3);
    if (open.length) after(() => Promise.all(open.map((r) => processConversation(r.id as string))));

    return NextResponse.json({
      conversations: list.map(({ audio_path, created_by, ...r }) => ({
        ...r,
        has_audio: !!audio_path,
        audio_url: typeof audio_path === "string" ? (urls[audio_path] ?? null) : null,
        by_name: typeof created_by === "string" ? (names[created_by] ?? null) : null,
      })),
      setUp: { transcription: !!process.env.SARVAM_API_KEY, analysis: !!process.env.ANTHROPIC_API_KEY },
    });
  } catch (err) {
    return toErrorResponse(err);
  }
}

export async function POST(request: Request, context: Ctx) {
  const { id } = await context.params;
  if (!isUuid(id)) return NextResponse.json({ error: "Not a valid id" }, { status: 400 });
  try {
    const { supabase, accountId, userId } = await requireRole("agent");
    const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
    const kind = body?.kind;
    if (typeof kind !== "string" || !KINDS.includes(kind)) return NextResponse.json({ error: "Pick what kind of conversation it was" }, { status: 422 });
    const happenedAt = typeof body?.happened_at === "string" ? new Date(body.happened_at) : new Date();
    if (Number.isNaN(happenedAt.getTime()) || happenedAt.getTime() > Date.now() + 86_400_000) {
      return NextResponse.json({ error: "Pick when it happened" }, { status: 422 });
    }
    const note = typeof body?.typed_note === "string" ? body.typed_note.trim().slice(0, 20_000) : "";
    const audioPath = typeof body?.audio_path === "string" ? body.audio_path : null;
    // The upload route made this path; it must sit in this account's folder for this lead.
    if (audioPath && (!AUDIO_PATH.test(audioPath) || !audioPath.startsWith(`${accountId}/${id}/`))) {
      return NextResponse.json({ error: "That recording isn't for this lead" }, { status: 422 });
    }
    if (!audioPath && !note) return NextResponse.json({ error: "Add a recording or type a note" }, { status: 422 });
    const duration = Number(body?.duration_s);

    const { data, error } = await supabase
      .from("lead_conversations")
      .insert({
        account_id: accountId,
        lead_id: id,
        kind,
        happened_at: happenedAt.toISOString(),
        created_by: userId,
        audio_path: audioPath,
        typed_note: note || null,
        duration_s: Number.isFinite(duration) && duration >= 0 ? Math.round(duration) : null,
      })
      .select("id")
      .single();
    if (error) return NextResponse.json({ error: error.message }, { status: statusOf(error.code) });
    after(() => processConversation(data.id as string));
    return NextResponse.json({ id: data.id }, { status: 201 });
  } catch (err) {
    return toErrorResponse(err);
  }
}
