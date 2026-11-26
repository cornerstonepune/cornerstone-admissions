# Local seed (ADR 0006)

1. With local Supabase running (`supabase start`) and `.env.local` filled in from `supabase status`, run `npm run db:seed:local -- you@example.com`. It only runs against 127.0.0.1/localhost, and running it again changes nothing.
2. It creates the Cornerstone admissions account, you as its owner (no password), the Admissions pipeline with its six stages, the settings the board reads (campuses, sources, lost reasons, alerts) and 8 fake sample leads.
3. Run `npm run dev`, open http://127.0.0.1:3000/forgot-password (use 127.0.0.1, not localhost), then follow the email in Mailpit at http://127.0.0.1:54324 to set your password.
