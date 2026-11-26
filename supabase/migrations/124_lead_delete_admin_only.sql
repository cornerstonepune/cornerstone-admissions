-- 124 — Deleting a lead is for admins only (ADR 0038).
-- A lead is deleted by deleting its deal: leads.deal_id cascades, and the lead's stage history, calls, follow-ups and
-- visits cascade from the lead. The parent's contact and WhatsApp conversation stay (nothing cascades to them).
-- Upstream's deals_delete let any agent delete any deal, so an agent could have deleted a lead through its deal.
-- Now a deal that carries a lead needs an admin; a deal without one keeps upstream's agent rule.

DROP POLICY IF EXISTS deals_delete ON public.deals;

CREATE POLICY deals_delete ON public.deals FOR DELETE USING (
  public.is_account_member(account_id, 'agent'::public.account_role_enum)
  AND (
    public.is_account_member(account_id, 'admin'::public.account_role_enum)
    OR NOT EXISTS (SELECT 1 FROM public.leads l WHERE l.deal_id = deals.id)
  )
);
