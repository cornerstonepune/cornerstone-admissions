-- 106 — the current visit (spec docs/spec/m0-data-model.md; ADR 0011 §3).
--
-- Per lead, its latest visit by created_at (ties: higher id) among visits whose status is NOT 'cancelled' or
-- 'rescheduled' (filter first, then pick the latest). Booked, visited and no-show count.
-- security_invoker = true so RLS on visits applies to whoever reads the view.
-- This Supabase grants nothing on new views, hence the explicit GRANT; readers also need 101's grant on visits.

CREATE VIEW public.lead_current_visit WITH (security_invoker = true) AS
SELECT DISTINCT ON (v.lead_id)
  v.lead_id, v.id AS visit_id, v.account_id, v.cal_booking_id, v.starts_at, v.campus_id, v.status, v.created_at
FROM public.visits v
WHERE v.status NOT IN ('cancelled', 'rescheduled')
ORDER BY v.lead_id, v.created_at DESC, v.id DESC;

GRANT SELECT ON public.lead_current_visit TO authenticated, service_role;
