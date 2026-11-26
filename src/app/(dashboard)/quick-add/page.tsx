// S-quick-add (M4, #67): the form, the two sources staff pick from (their names from Admissions settings), and the
// leads this member opened today (the deal's author is whoever saved it).
import { getCurrentAccount } from "@/lib/auth/account";
import { QuickAdd, type AddedToday } from "@/admissions/components/quick-add";
import { QUICK_ADD_SOURCES } from "@/admissions/lib/intake";

const IST = 330 * 60_000;
const one = <T,>(v: T | T[] | null): T | null => (Array.isArray(v) ? (v[0] ?? null) : v);
/** Today's midnight in India, as an instant. */
const indiaMidnight = (now: number) => new Date(Math.floor((now + IST) / 86_400_000) * 86_400_000 - IST).toISOString();

export default async function QuickAddPage() {
  const { supabase, accountId, userId } = await getCurrentAccount();
  const midnight = indiaMidnight(new Date().getTime());
  const [sources, leads] = await Promise.all([
    supabase
      .from("admissions_settings")
      .select("key, label")
      .eq("account_id", accountId)
      .eq("kind", "source")
      .eq("active", true)
      .in("key", [...QUICK_ADD_SOURCES]),
    supabase
      .from("leads")
      .select("id, child_name, created_at, contacts(name), source:admissions_settings!leads_source_id_fkey(label), deals!inner(user_id)")
      .eq("account_id", accountId)
      .eq("deals.user_id", userId)
      .gte("created_at", midnight)
      .order("created_at", { ascending: false })
      .limit(50),
  ]);
  const time = new Intl.DateTimeFormat("en-IN", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "Asia/Kolkata" });
  const added: AddedToday[] = (leads.data ?? []).map((l) => ({
    id: l.id,
    time: time.format(new Date(l.created_at)),
    child: l.child_name,
    parent: one(l.contacts as { name: string | null } | { name: string | null }[] | null)?.name ?? null,
    source: one(l.source as { label: string } | { label: string }[] | null)?.label ?? null,
  }));
  const order = (k: string) => QUICK_ADD_SOURCES.indexOf(k as (typeof QUICK_ADD_SOURCES)[number]);
  return <QuickAdd sources={(sources.data ?? []).sort((a, b) => order(a.key) - order(b.key))} added={added} />;
}
