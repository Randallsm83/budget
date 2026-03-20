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
npm test             # run Vitest unit tests
npm run test:watch   # Vitest watch mode
```

All `db:*` scripts use `dotenv -e .env.local` to inject credentials. Test files live in `src/lib/__tests__/`.

## Environment setup
Copy `.env.local.example` to `.env.local` and fill in:
- `DATABASE_URL` — Neon/Postgres connection string
- `AUTH_SECRET` — NextAuth secret (generate: `node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"`)
- `NEXTAUTH_URL` — e.g. `http://localhost:3000`
- `PLAID_CLIENT_ID`, `PLAID_SECRET`, `PLAID_ENV` — only needed if using Plaid
- `PLAID_WEBHOOK_URL` — public URL for Plaid webhooks, e.g. `https://yourdomain.com/api/plaid/webhook`
- `ENCRYPTION_KEY` — 64 hex chars (32 bytes) for AES-256-GCM encryption of Plaid access tokens

## Code structure
- `src/app/(app)/` — protected app pages: `budget/`, `accounts/`, `settings/security/`
- `src/app/api/` — API route handlers: `auth/`, `plaid/`, `transactions/`, `accounts/`
- `src/components/` — React client components (modals, tables, forms)
- `src/lib/` — pure server-side utilities
  - `actions.ts` — all Next.js Server Actions (mutations)
  - `budget.ts` — pure budget math engine + display helpers
  - `plaid.ts` — Plaid client singleton
  - `plaid-sync.ts` — core transaction sync logic shared by the sync route and webhook handler
  - `crypto.ts` — AES-256-GCM encrypt/decrypt for Plaid tokens
  - `payee.ts` — payee name normalization for auto-categorization
- `src/components/AccountsNav.tsx` — client component for sortable sidebar account list (DnD per section)
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

### CC Payment category system (YNAB-style)
When a `credit_card` account is added, a linked CC Payment category is auto-created in a system-managed group:
- `categoryGroups.isSystem = true` — the "Credit Card Payments" group; read-only, never shown in expense/income sections
- `categoryGroups.isTransfer = true` — also set on the CC Payment group (identifies it internally)
- `categories.ccAccountId` — UUID FK to `accounts.id`; links a CC payment category to its credit card account

`ensureCCPaymentCategories()` in `actions.ts` is called on every budget page load. It creates any missing CC payment categories, syncs category names to their account names, and is a no-op if everything is already up to date.

In the budget page calculation:
- `ccAutoFundMap[month][catId]` accumulates the auto-funded amount (= sum of categorized CC outflows, negated) per CC payment category
- `ccCatIds` — set of CC payment category IDs; their transactions affect `activityMap` but not `totalExpenseBudgeted`
- `legacyTransferCatIds` — categories from old user-created transfer groups; excluded from all calculations
- CC payment categories are excluded from `totalExpenseBudgeted` so they don't reduce Ready to Assign

`BudgetTable` splits groups into `incomeGroups`, `expenseGroups`, and `ccGroups` (isSystem). CC groups render in a read-only `CCPaymentSection` at the bottom. `GroupRow` carries `isTransfer: boolean` as a defensive guard — both the page and BudgetTable filter out transfer groups.

`updateAccount` syncs the linked CC payment category name whenever a credit card account is renamed.

### Drag-and-drop reordering
`@dnd-kit/core` and `@dnd-kit/sortable` handle drag-and-drop reordering for:
- Budget category groups and categories (`BudgetTable`) — `reorderGroups`, `reorderCategories` actions
- Sidebar accounts (`AccountsNav`) — `reorderAccounts` action; `accounts.sortOrder` persists order per section (Cash & Bank, Investments, Property, Liabilities)

### Transfer transactions
`transactions.isTransfer = true` marks inter-account transfers (e.g. checking → checking). These are **completely excluded** from all budget calculations — no RTA contribution, no activity. The budget page does `if (txn.isTransfer) continue` at the top of the transaction loop.
- `toggleTransfer` server action flips the flag and clears the category
- UI: hover any transaction row to see the ↔ toggle button
- Plaid sync auto-detects common transfer payees (`Online Transfer`, `ACH Transfer`, `Wire Transfer`, etc.) and sets `isTransfer=true` on import

### CC payment double-counting prevention
When a CC payment is made (checking → CC account), Plaid imports both sides:
1. Checking outflow — categorized to the CC Payment category → counted in `activityMap` as a payment
2. CC account inflow (receipt) — **must be ignored**: if it also has a CC Payment category, it would cancel out the payment; if uncategorized and positive, it would inflate RTA

The budget page filters both cases: CC Payment `activityMap` only counts transactions on non-CC accounts (`!ccAccountIds.has(txn.accountId)`); uncategorized positive inflows on CC accounts are excluded from `inflowMap`.

### Next.js data cache — always opt out
Neon’s HTTP driver uses `fetch()` internally. Next.js patches `fetch()` and caches responses by default in some configurations. **Always opt out:**
- `src/db/index.ts` passes `{ fetchOptions: { cache: 'no-store' } }` to the `neon()` constructor
- The budget page calls `noStore()` from `next/cache` at the top of the render function
Without this, DB mutations (e.g. deleting a group) may not be reflected on the next page load.

### Plaid webhook auto-sync
The webhook handler at `src/app/api/plaid/webhook/route.ts` calls `syncTransactions()` from `src/lib/plaid-sync.ts` for every connection on an Item when `TRANSACTIONS/SYNC_UPDATES_AVAILABLE` fires. This replaces manual syncing for all connected accounts. The `PLAID_WEBHOOK_URL` env var must be set for new bank connections to register the webhook; existing connections must be updated via `POST /api/plaid/update-webhooks`.

### Git workflow
Main branch is protected (PRs required, enforce_admins enabled). Always work on a feature branch:
```bash
git checkout -b feat/description
git push origin feat/description
gh pr create --fill
gh pr merge --squash --delete-branch
git checkout main && git pull
```

### Account types: on-budget vs. tracking
Valid account types: `checking`, `savings`, `credit_card`, `cash`, `loan`, `real_estate`, `vehicle`, `investment`, `other`.

**On-budget** (`checking`, `savings`, `cash`, `credit_card`) — transactions from these accounts feed the budget: they appear in category activity and uncategorized positive amounts contribute to "Ready to Assign".

**Tracking** (`investment`, `real_estate`, `vehicle`, `loan`, `other`) — off-budget accounts used only for net worth in the sidebar. Their transactions are intentionally excluded from the budget page calculation (`src/app/(app)/budget/[month]/page.tsx` filters to `ON_BUDGET_TYPES` before querying transactions). Starting balances for large tracking accounts (e.g. a $200k house) would otherwise inflate RTA incorrectly.

Liabilities (`credit_card`, `loan`) are grouped separately in the sidebar. Balances for liabilities are negative.
