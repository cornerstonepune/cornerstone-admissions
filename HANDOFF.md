# HANDOFF

_Overwritten at the end of every session. Keep under 30 lines. Facts only._

**Updated:** 2026-11-26 · **By:** go-live answers (ADR 0033) · **Model:** claude-opus-5-5
**Milestone:** all slices built except M2's hand checks and M7 hosting · **Branch:** feat/go-live-prep

## State
- This PR (not merged; needs an independent review: migration + webhook): migration 122 makes the Cal.com location
  pick the visit's campus (and fill a lead with none), and a repeat family notify every account member
  (`repeat_family` notification; the Notifications page opens the lead). English welcome wording redrafted.
- Local checks on this branch: lint, typecheck, `npm test`, `npm run test:db` (fresh `db:reset`, 33 files, 253 tests) green.
- Nimish's answers recorded in ADR 0033 and PROJECT.md §6: Gurukul default / Neev option on one Cal.com event;
  repeat family → everyone; Vercel; hosted Supabase `bfnrfpuaaifdhlundrum` (ap-northeast-2).

## Next step
1. Independent review of this PR, then merge on green CI.
2. Nimish: approve or edit the welcome wording (`messages/en.json` → `StarterFlows.admissions_welcome`).
3. Cal.com: set up the one visit event per `docs/calcom-setup.md` §2 (each location must contain its campus label).
4. Go-live (M7): apply migrations to `bfnrfpuaaifdhlundrum`, Vercel project, real number, Nimish's go.

## Blocked / open questions
- From Nimish: date-of-birth cut-offs and grades per campus (routing leaves campus empty until then).
- Not checked against a real Cal.com booking: that an in-person location's text arrives in `payload.location`.
- Not clicked through in a running app: the Notifications page's repeat-family row and lead panel.

## Don't repeat
- Changing a function's arguments: DROP the old signature; a DEFAULT-NULL overload makes old calls ambiguous.
- Update PROJECT.md §5 in the same PR that finishes a milestone (ADR 0032).
