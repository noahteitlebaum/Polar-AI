# Setup checklist (Noah)

Things code can't do for you. Do them in order.

1. **Install new packages** — in `orbit-ai`: `npm install` (adds `unpdf` for PDFs and `mammoth` for Word files).
2. **Database** — Supabase → SQL Editor → New query → paste the *contents* of
   `supabase/migrations/0001_core.sql` → Run. Then the same for `0002_files_courses.sql`.
   Both are safe to run again. Expect "Success. No rows returned".
3. **Secret key** — Supabase → Project Settings → API Keys → copy the *secret* key into `.env.local` as
   `SUPABASE_SECRET_KEY=…`. Never put it in a `NEXT_PUBLIC_` variable or commit it.
4. **Try it in demo mode** — `npm run dev`, sign in, upload a lecture PDF in a chat. Replies are fake (no cost)
   but uploads, courses, page references and modes all work.
5. **Go live** (when ready to spend money) — create API keys at OpenAI, Anthropic, Google AI Studio and xAI,
   set a spending limit in each provider's dashboard, add them to `.env.local`
   (`OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, `GEMINI_API_KEY`, `XAI_API_KEY`), and set `LIVE_MODELS=on`.
6. **Vercel** — add the same variables in Project → Settings → Environment Variables before deploying.

## Team switches (Supabase → Table Editor → `settings`)
- `global_stop` = `true` stops all model calls immediately.
- `disabled_providers` = `["xai"]` turns one provider off.
- `default_allowance_micros` = budget for new accounts (5000000 = $5.00).

## Known limits
- Scanned PDFs are flagged ("text can't be read"), not read. Workaround: upload page screenshots (images go to vision models).
- Course-file search is keyword-based (Postgres full-text). Questions worded very differently from the slides may miss; an embeddings upgrade is the next step.
- ChatGPT image generation stays off until `IMAGE_MODELS.openai.pricePerImage` is set in `config/models.ts`.
