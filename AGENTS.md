# AGENTS.md

This file provides guidance to WARP (warp.dev) when working with code in this repository.

## Project purpose
Personal budgeting app (YNAB-style envelope budgeting). Users create budget accounts, categorize transactions, assign money to categories per month, and optionally import transactions via Plaid or CSV. Deployed to Vercel with a Neon PostgreSQL backend.

## Key technologies
- **Next.js 16** with App Router and React Server Components (React 19)
- **NextAuth v5 (beta)** — Credentials provider (email/password + TOTP MFA), JWT sessions
- **Drizzle ORM** on **Neon PostgreSQL** (HTTP transport via `@neondatabase/serverless`)
- **Plaid SDK** — bank connection, transaction sync via cursor-based API
- **Tailwind CSS v4** (PostCSS plugin, no `tailwind.config.js`)
- **Zod v4** for validation

## Commands
```bash
npm run dev          # start dev server at localhost:3000
npm run build        # production build
npm run lint         # ESLint
npm run db:generate  # generate Drizzle migration files (reads .env.local)
npm run db:push      # push schema changes directly to DB (reads .env.local)
npm run db:studio    # open Drizzle Studio GUI (reads .env.local)
npm run db:seed      # seed initial user from .env.local SEED_USER_* vars
```

All `db:*` scripts use `dotenv -e .env.local` to inject credentials. There are no automated tests.

## Environment setup
Copy `.env.local.example` to `.env.local` and fill in:
- `DATABASE_URL` — Neon/Postgres connection string
- `AUTH_SECRET` — NextAuth secret (generate: `node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"`)
- `NEXTAUTH_URL` — e.g. `http://localhost:3000`
- `PLAID_CLIENT_ID`, `PLAID_SECRET`, `PLAID_ENV` — only needed if using Plaid
- `ENCRYPTION_KEY` — 64 hex chars (32 bytes) for AES-256-GCM encryption of Plaid access tokens

## Code structure
- `src/app/(app)/` — protected app pages: `budget/`, `accounts/`, `settings/security/`
- `src/app/api/` — API route handlers: `auth/`, `plaid/`, `transactions/`, `accounts/`
- `src/components/` — React client components (modals, tables, forms)
- `src/lib/` — pure server-side utilities
  - `actions.ts` — all Next.js Server Actions (mutations)
  - `budget.ts` — pure budget math engine + display helpers
  - `plaid.ts` — Plaid client singleton
  - `crypto.ts` — AES-256-GCM encrypt/decrypt for Plaid tokens
  - `payee.ts` — payee name normalization for auto-categorization
- `src/db/` — Drizzle schema (`schema.ts`), lazy DB singleton (`index.ts`), seed script
- `src/proxy.ts` — Next.js middleware (note: non-standard filename; routes defined in its `config.matcher`)
- `src/auth.ts` — NextAuth configuration with TOTP MFA logic
- `src/types/next-auth.d.ts` — augments `Session` to include `user.id`

## Critical patterns

### Money is always integer milliunits
`$1.00 = 1000`. All DB columns, Server Actions, and math use milliunits. **Never use floats for money.** Use `formatMoney(milliunits)` from `src/lib/budget.ts` for display and `parseMoney(str)` to parse user input.

### Server Actions for all mutations
All data mutations go through `'use server'` functions in `src/lib/actions.ts`. Every action calls `requireUser()` first, then verifies ownership with `userId` in every query. Page components call Server Actions directly; there is no separate REST layer for mutations (except Plaid sync which is an API route).

### Budget math is computed at query time
`monthBudgets` stores only the `budgeted` amount per (user, category, month). `activity` and `balance` are always derived by summing transactions in the page component (`src/app/(app)/budget/[month]/page.tsx`). The iterative loop processes all months from the earliest transaction up to the target month to carry forward category balances.

### Payee auto-categorization
When a transaction is saved or updated with a category, `learnPayeeRule()` in `actions.ts` upserts to `payee_rules` using `normalizePayee()` as the key. On Plaid sync, this rule map is loaded and applied to incoming transactions automatically.

### Plaid access tokens are encrypted
`importConnections.accessTokenEncrypted` is encrypted with AES-256-GCM via `src/lib/crypto.ts`. The plaintext token is never stored. Requires `ENCRYPTION_KEY` env var (64 hex chars).

### DB singleton avoids build-time errors
`src/db/index.ts` exports a Proxy object; the actual Neon connection is created lazily on first use so `next build` doesn't fail when `DATABASE_URL` is absent.

### Middleware is in `src/proxy.ts`
Next.js middleware lives at `src/proxy.ts` (not the conventional `middleware.ts`). It protects `/budget/:path*` and `/accounts/:path*` by redirecting unauthenticated users to `/login`.

### Session user ID
The JWT callback in `src/auth.ts` propagates `user.id` into the token, and the session callback exposes it as `session.user.id`. The type augmentation is in `src/types/next-auth.d.ts`. Always destructure as `session.user.id`.

### Income categories vs. expense categories
`categoryGroups.isIncome = true` marks income groups. Income category transactions feed "Ready to Assign" (RTA); expense category transactions consume it. The budget page differentiates these during its iterative calculation.

### Account types: on-budget vs. tracking
Valid account types: `checking`, `savings`, `credit_card`, `cash`, `loan`, `real_estate`, `vehicle`, `investment`, `other`.

**On-budget** (`checking`, `savings`, `cash`, `credit_card`) — transactions from these accounts feed the budget: they appear in category activity and uncategorized positive amounts contribute to "Ready to Assign".

**Tracking** (`investment`, `real_estate`, `vehicle`, `loan`, `other`) — off-budget accounts used only for net worth in the sidebar. Their transactions are intentionally excluded from the budget page calculation (`src/app/(app)/budget/[month]/page.tsx` filters to `ON_BUDGET_TYPES` before querying transactions). Starting balances for large tracking accounts (e.g. a $200k house) would otherwise inflate RTA incorrectly.

Liabilities (`credit_card`, `loan`) are grouped separately in the sidebar. Balances for liabilities are negative.
