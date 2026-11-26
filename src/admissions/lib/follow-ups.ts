// M6 follow-ups (#69, ADR 0027). wacrm's automations cron calls runFollowUps every run. The database decides what is due
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
    try {
      const { data: conv, error: convErr } = await db
        .from("conversations")
        .select("id")
        .eq("account_id", s.account_id)
        .eq("contact_id", s.contact_id)
        .maybeSingle();
      if (convErr) throw new Error(convErr.message);
      if (!conv) throw new Error("No WhatsApp conversation with this parent yet");
      const { whatsapp_message_id } = await engineSendTemplate({
        accountId: s.account_id,
        userId: s.owner_id,
        conversationId: conv.id as string,
        contactId: s.contact_id,
        templateName: s.template,
      });
      const { data: msg } = await db.from("messages").select("id").eq("message_id", whatsapp_message_id).maybeSingle();
      await db
        .from("lead_activity")
        .update({ done_at: new Date().toISOString(), message_id: (msg?.id as string | undefined) ?? null })
        .eq("id", s.activity_id);
      run.sent++;
    } catch (e) {
      // Claimed already, so it is never retried and never sent twice; the lead panel shows why it didn't go.
      const why = e instanceof Error ? e.message : String(e);
      console.error("[follow-ups] send failed:", s.activity_id, why);
      await db.from("lead_activity").update({ outcome: "Not sent", notes: why }).eq("id", s.activity_id);
      run.failed++;
    }
  }
  return run;
}
