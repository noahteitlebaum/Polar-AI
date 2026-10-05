# AGENTS.md — Polar AI

Read this first in every AI session. Also read `docs/PRODUCT_SPEC.md`, `docs/ARCHITECTURE.md`, and `docs/TASKS.md`. If anything here conflicts with a direct instruction from Noah, follow Noah and update this file.

## What this is
A mobile-friendly web app that gives verified @uwo.ca students one place to use OpenAI, Anthropic (Claude), Google (Gemini) and xAI (Grok). Students can switch models inside a saved conversation and keep the context. **Launch: Monday Oct 19 2026.**

## Stack (provisional; change it here if it changes)
- Next.js (App Router) + TypeScript + Tailwind
- Supabase: Postgres, Auth (email OTP), Row Level Security
- Vercel hosting (preview deploy for each branch)
- Provider SDKs called **only from server code** (route handlers / server actions)
- Tests: Vitest (unit/integration), Playwright (core journey on phone and desktop)

## Commands
```
npm run dev        # local dev
npm run lint       # eslint
npm run typecheck  # tsc --noEmit
npm test           # vitest (mock providers, no live API calls)
npm run test:e2e   # playwright
npm run test:live  # small opt-in live checks against all 4 providers (costs money)
```
(Add a script to package.json if it doesn't exist yet.)

## Hard rules (never violate)
1. **API keys stay on the server.** Never send them to the client, logs, or prompts. Use env vars only.
2. **Access:** only users who have verified an email at the exact domain `uwo.ca` may get credits or call a model. Enforce this on the server, not just in the UI. Reject subdomains and lookalike domains (`uwo.ca.evil.com`, `xuwo.ca`, unicode lookalikes).
2a. **Waitlist:** while `WAITLIST_MODE` is on, only emails in `EARLY_ACCESS_EMAILS` reach the app; everyone else sees `/waitlist`. Enforce with `getUserAccess()` on every page and API route that uses models.
3. **Ownership:** a user can only read or write their own conversations. Enforce with RLS **and** server checks.
4. **Budget:** every model call does an atomic reserve → call → reconcile against a dollar budget (see ARCHITECTURE.md). Don't make a provider call without a reservation.
5. **No silent model substitution.** If a provider fails, show an error and let the student choose another model.
6. **No silent history dropping.** Use the disclosed context policy for long chats.
7. **Privacy:** never log message content. Log IDs, model, token counts, cost, error codes.
8. **Config, not code:** model IDs, prices, allowances, rate limits and feature flags live in `src/config/`. Adding a provider should only need a new adapter plus config.
9. **Payments stay disabled** (`PAYMENTS_ENABLED=false`) until Jake gives the final rules.
10. Use synthetic accounts and data only. Never use real student chats in prompts, tests or screenshots.

## Out of scope for launch (don't build unless the team agrees)
Model comparison, in-app image generation and upload, smart model routing, extra models.
Optional only after all launch checks pass: PDFs, web search, course folders, preferences, memory across chats.

## How to work
- One bounded task at a time, taken from `docs/TASKS.md`, with acceptance criteria.
- Read the relevant code before changing it. Plan multi-file changes first.
- Run `lint`, `typecheck` and `test` before saying a task is done.
- Report: files changed, checks run, unresolved issues.
- Commit each verified increment with a clear message.
- Get a second-model review before merging auth, context transfer, cost accounting or payment changes.

## Definition of done
- Acceptance criteria met and covered by tests (mock providers).
- Works at phone width (375px) and on desktop.
- Server-side enforcement exists for any access, ownership or budget rule touched.
- No secrets or message content in logs.
- Docs updated if a decision changed.
