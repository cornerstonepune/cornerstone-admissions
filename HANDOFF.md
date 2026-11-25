# HANDOFF

_Overwritten at the end of every session. Facts only._

**Updated:** 2026-11-26 · **By:** Coordinator · **Milestone:** M1 (M0 done, ADR 0018)

## State
- M0 merged and db/schema.sql regenerated. M1: #52 (hidden routes) merged.
- Blocked on Nimish: approving the S-frame wireframe himself (none of the 16 are approved). Then build #7, then #8/#9, then #10/#18, #11, #12 (need `loop plan` seeds first).

## Next step
1. Nimish approves S-frame. 2. `loop plan "Seed tickets #7-#12, #18"`. 3. Build in the order above.
4. Plan follow-ups from the #52 review: turn off Supabase auth sign-up (enable_signup=false in supabase/config.toml; anon key can still hit /auth/v1/signup); broadcast/AI API routes still answer (ticket or ADR); #18 must remove all links to hidden pages (sidebar.tsx:98, overview-header.tsx:29, campaigns-card.tsx:68/80).

## Don't repeat
- Builders sometimes skip docs/loop/handoff/<N>.md (loop-guard red): add it to the ticket's Don't, re-prep, rebuild.
- Builder env can lack Bash permission; rescue (Fable) worked for #37.
