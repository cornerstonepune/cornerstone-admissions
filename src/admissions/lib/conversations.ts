// The conversation log's job runner (ADR 0039). A conversation moves pending → transcribing → analysing → done; a
// typed note skips straight to analysing. Each run takes a short lock, advances as far as it can without waiting, and
// saves. The cron finishes what the upload and the panel didn't. Failures retry up to MAX_ATTEMPTS, then show as
// failed with the reason; the audio is never touched by a failure.
import Anthropic from "@anthropic-ai/sdk";
import type { SupabaseClient } from "@supabase/supabase-js";
import { supabaseAdmin } from "@/lib/automations/admin-client";
import { AUDIO_BUCKET } from "./audio";
import { claudeExtractor, type Extraction, type Extractor } from "./conversation-extract";
import { sarvam, type Transcriber } from "./sarvam";

export const MAX_ATTEMPTS = 3;
export const OPEN_STATUSES = ["pending", "transcribing", "analysing"] as const;
export const NOT_SET_UP = { transcription: "Transcription not set up", analysis: "Analysis not set up" };
const LOCK_MS = 10 * 60_000;

export type ConversationStatus = (typeof OPEN_STATUSES)[number] | "done" | "failed";

export interface ConversationRow {
  id: string;
  account_id: string;
  lead_id: string;
  kind: string;
  happened_at: string;
  created_by: string | null;
  audio_path: string | null;
  typed_note: string | null;
  status: ConversationStatus;
  attempts: number;
  provider_job_id: string | null;
  transcript_en: string | null;
}
type Patch = Partial<ConversationRow & Extraction & { error: string | null }>;

export interface Io {
  transcriber: Transcriber | null;
  extract: Extractor | null;
  loadAudio: (path: string) => Promise<Blob>;
  stages: (leadId: string) => Promise<string[]>;
}

const message = (e: unknown) => (e instanceof Error ? e.message : String(e));

function failure(row: ConversationRow, e: unknown, retry: Patch = {}): Patch {
  const attempts = row.attempts + 1;
  return attempts >= MAX_ATTEMPTS ? { status: "failed", error: message(e), attempts } : { ...retry, error: message(e), attempts };
}

/** The audio must sit in this conversation's own account and lead folder (the table's CHECK says so too). */
export function inOwnFolder(row: Pick<ConversationRow, "account_id" | "lead_id" | "audio_path">): boolean {
  const path = row.audio_path ?? "";
  return path.startsWith(`${row.account_id}/${row.lead_id}/`) && !path.includes("..");
}

/** One step of the state machine: what to change on the row. An empty patch means "still waiting". */
export async function nextStep(row: ConversationRow, io: Io): Promise<Patch> {
  if (row.status === "pending") {
    if (!row.audio_path) return { status: "analysing", error: null };
    if (!inOwnFolder(row)) return { status: "failed", error: "The recording isn't in this lead's folder" };
    if (!io.transcriber) return { error: NOT_SET_UP.transcription };
    try {
      const audio = await io.loadAudio(row.audio_path);
      const jobId = await io.transcriber.start(audio, `${row.id}.${row.audio_path.split(".").pop()}`);
      return { status: "transcribing", provider_job_id: jobId, error: null };
    } catch (e) {
      return failure(row, e);
    }
  }
  if (row.status === "transcribing") {
    if (!io.transcriber) return { error: NOT_SET_UP.transcription };
    try {
      const job = await io.transcriber.check(row.provider_job_id ?? "");
      if (job.state === "running") return {};
      if (job.state === "done") return { status: "analysing", transcript_en: job.transcript, attempts: 0, error: null };
      // The job itself failed: the next try starts a new job.
      return failure(row, new Error(job.error), { status: "pending", provider_job_id: null });
    } catch (e) {
      return failure(row, e);
    }
  }
  if (row.status === "analysing") {
    if (!io.extract) return { error: NOT_SET_UP.analysis };
    const text = [row.typed_note && `Staff note: ${row.typed_note}`, row.transcript_en && `Transcript:\n${row.transcript_en}`]
      .filter(Boolean)
      .join("\n\n");
    if (!text) return { status: "failed", error: "Nothing to analyse: no note and no transcript" };
    try {
      const sections = await io.extract({ text, kind: row.kind, happenedAt: row.happened_at, stages: await io.stages(row.lead_id) });
      return { status: "done", error: null, attempts: 0, ...sections };
    } catch (e) {
      return failure(row, e);
    }
  }
  return {};
}

/** Runs steps until the row waits, fails or is done. Returns everything that changed. */
export async function advance(row: ConversationRow, io: Io): Promise<Patch> {
  let cur: ConversationRow = row;
  let changes: Patch = {};
  for (let i = 0; i < 4; i++) {
    const patch = await nextStep(cur, io);
    changes = { ...changes, ...patch };
    const before = cur.status;
    cur = { ...cur, ...patch } as ConversationRow;
    if (cur.status === before || !(OPEN_STATUSES as readonly string[]).includes(cur.status)) break;
  }
  return changes;
}

/** What "Retry" sets: transcribe again if there is no transcript yet, else analyse again. */
export function retryPatch(row: Pick<ConversationRow, "audio_path" | "transcript_en">): Patch {
  return {
    status: row.audio_path && !row.transcript_en ? "pending" : "analysing",
    attempts: 0,
    error: null,
    provider_job_id: null,
  };
}

export function defaultIo(): Io {
  const db = supabaseAdmin();
  const sarvamKey = process.env.SARVAM_API_KEY;
  return {
    transcriber: sarvamKey ? sarvam(sarvamKey) : null,
    extract: process.env.ANTHROPIC_API_KEY ? claudeExtractor(new Anthropic({ timeout: 120_000 })) : null,
    async loadAudio(path) {
      const { data, error } = await db.storage.from(AUDIO_BUCKET).download(path);
      if (error || !data) throw new Error("The recording could not be read from storage");
      return data;
    },
    async stages(leadId) {
      const { data: lead } = await db.from("leads").select("deal:deals(pipeline_id)").eq("id", leadId).maybeSingle();
      const pipelineId = (lead as unknown as { deal: { pipeline_id: string } | null } | null)?.deal?.pipeline_id;
      if (!pipelineId) return [];
      const { data } = await db.from("pipeline_stages").select("name").eq("pipeline_id", pipelineId).order("position");
      return (data ?? []).map((s) => s.name as string);
    },
  };
}

/** Claims one conversation (skips it if another run holds it), advances it and saves. */
export async function processConversation(id: string, io: Io = defaultIo()): Promise<void> {
  const db = supabaseAdmin();
  const now = new Date();
  const stale = new Date(now.getTime() - LOCK_MS).toISOString();
  const { data: claimed } = await db
    .from("lead_conversations")
    .update({ claimed_at: now.toISOString() })
    .eq("id", id)
    .in("status", OPEN_STATUSES)
    .or(`claimed_at.is.null,claimed_at.lt."${stale}"`)
    .select("id, account_id, lead_id, kind, happened_at, created_by, audio_path, typed_note, status, attempts, provider_job_id, transcript_en");
  const row = claimed?.[0] as ConversationRow | undefined;
  if (!row) return;
  let changes: Patch = {};
  try {
    changes = await advance(row, io);
  } finally {
    await db.from("lead_conversations").update({ ...changes, claimed_at: null }).eq("id", id);
  }
  if (changes.status === "done") {
    const error = await addCallTasks(row, changes.action_points ?? []);
    // The sections are saved; say on the row that its call tasks weren't made (no personal data in the log line).
    if (error) {
      console.error("conversation call tasks failed", id, error.code);
      await db.from("lead_conversations").update({ error: `Call tasks not added: ${error.message}` }).eq("id", id);
    }
  }
}

/** The school's action points become call tasks on the lead, so they reach the Today list. */
async function addCallTasks(
  row: ConversationRow,
  points: Extraction["action_points"],
): Promise<{ code?: string; message: string } | null> {
  const tomorrow = new Date(Date.now() + 86_400_000).toISOString();
  const tasks = points
    .filter((p) => p.owner === "school")
    .slice(0, 5)
    .map((p) => ({
      account_id: row.account_id,
      lead_id: row.lead_id,
      kind: "call_task",
      due_at: p.due ? `${p.due}T10:00:00+05:30` : tomorrow,
      notes: `From the ${row.kind}: ${p.text}`,
      created_by: row.created_by,
      assigned_to: row.created_by,
    }));
  if (!tasks.length) return null;
  const { error } = await supabaseAdmin().from("lead_activity").insert(tasks);
  return error;
}

/** Deletes audio past 12 months and audio no conversation points to (from the bucket itself, so a deleted lead or a
 * failed save leaves nothing behind); the text stays. Returns how many files went. */
export async function sweepAudio(db: SupabaseClient): Promise<number> {
  const { data, error } = await db.rpc("conversation_audio_to_sweep", { p_limit: 100 });
  const names = ((data ?? []) as { name: string }[]).map((r) => r.name);
  if (error || !names.length) return 0;
  const { error: removeError } = await db.storage.from(AUDIO_BUCKET).remove(names);
  if (removeError) return 0;
  await db
    .from("lead_conversations")
    .update({ audio_path: null, audio_deleted_at: new Date().toISOString() })
    .in("audio_path", names);
  return names.length;
}

/** From the cron: sweeps old and orphaned audio, then advances the open conversations. */
export async function runConversationJobs(io: Io = defaultIo()): Promise<{ advanced: number; audioDeleted: number }> {
  const db = supabaseAdmin();
  const audioDeleted = await sweepAudio(db);
  // Least recently touched first, so rows waiting on a missing key don't starve the rest.
  const { data: open } = await db
    .from("lead_conversations")
    .select("id")
    .in("status", OPEN_STATUSES)
    .order("updated_at", { ascending: true })
    .limit(5);
  for (const r of open ?? []) await processConversation(r.id as string, io);
  return { advanced: open?.length ?? 0, audioDeleted };
}
