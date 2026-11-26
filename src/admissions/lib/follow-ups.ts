// M6 follow-ups (#69, ADR 0028). wacrm's automations cron calls runFollowUps every run. The database decides what is due
// and claims it once (claim_due_follow_ups, migration 115): it reads the rules at run time, skips a lead whose parent has
// written since it entered its stage, makes call tasks, closes Dormant leads, and returns the template sends. This file
// only sends those through wacrm's automation sender and records the result on the follow-up.
import { supabaseAdmin } from "@/lib/automations/admin-client";
import { engineSendTemplate } from "@/lib/automations/meta-send";

interface ClaimedSend {
  activity_id: string;
  account_id: string;
  contact_id: string;
  owner_id: string;
  template: string;
}

export interface FollowUpRun {
  sent: number;
  failed: number;
  /** Sent or failed, but its follow-up row couldn't be stamped (it is still never sent again). */
  unrecorded?: number;
  error?: string;
}

export async function runFollowUps(now: Date = new Date()): Promise<FollowUpRun> {
  const db = supabaseAdmin();
  const { data, error } = await db.rpc("claim_due_follow_ups", { p_now: now.toISOString() });
  if (error) {
    console.error("[follow-ups] claim failed:", error.message);
    return { sent: 0, failed: 0, error: error.message };
  }

  const run: FollowUpRun = { sent: 0, failed: 0 };
  for (const s of (data ?? []) as ClaimedSend[]) {
    let record: Record<string, unknown>;
    try {
      const { data: conv, error: convErr } = await db
        .from("conversations")
        .select("id")
        .eq("account_id", s.account_id)
        .eq("contact_id", s.contact_id)
        .maybeSingle();
      if (convErr) throw new Error(convErr.message);
      if (!conv) throw new Error("No WhatsApp conversation with this parent yet");
      // The template's own language (a Marathi-only template is not en_US); Settings only lets approved ones send.
      const { data: tpls, error: tplErr } = await db
        .from("message_templates")
        .select("language")
        .eq("account_id", s.account_id)
        .eq("name", s.template)
        .eq("status", "APPROVED");
      if (tplErr) throw new Error(tplErr.message);
      const language = ((tpls ?? []) as { language: string | null }[])
        .map((t) => t.language ?? "")
        .filter(Boolean)
        .sort()[0];
      const { whatsapp_message_id } = await engineSendTemplate({
        accountId: s.account_id,
        userId: s.owner_id,
        conversationId: conv.id as string,
        contactId: s.contact_id,
        templateName: s.template,
        language,
      });
      const { data: msg } = await db.from("messages").select("id").eq("message_id", whatsapp_message_id).maybeSingle();
      record = { done_at: new Date().toISOString(), message_id: (msg?.id as string | undefined) ?? null };
      run.sent++;
    } catch (e) {
      // Claimed already, so it is never retried and never sent twice; the lead panel shows why it didn't go.
      const why = e instanceof Error ? e.message : String(e);
      console.error("[follow-ups] send failed:", s.activity_id, why);
      record = { outcome: "Not sent", notes: why };
      run.failed++;
    }
    // Stamped outside the try: a send that went out is never mislabelled "Not sent" because its stamp failed.
    const { error: recErr } = await db.from("lead_activity").update(record).eq("id", s.activity_id);
    if (recErr) {
      console.error("[follow-ups] couldn't record the follow-up:", s.activity_id, recErr.message);
      run.unrecorded = (run.unrecorded ?? 0) + 1;
    }
  }
  return run;
}
