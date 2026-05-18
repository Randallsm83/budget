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
npm run db:seed              # seed initial user from .env.local SEED_USER_* vars
npm test                     # run Vitest unit tests
npm run test:watch           # Vitest watch mode
npm run test:offboarding     # Plaid /item/remove integration test (sandbox only)
```

All `db:*` scripts use `dotenv -e .env.local` to inject credentials. Unit tests live in `src/lib/__tests__/`. Integration tests in `scripts/`.

## Environment setup
Copy `.env.local.example` to `.env.local` and fill in:
- `DATABASE_URL` — Neon/Postgres connection string
- `AUTH_SECRET` — NextAuth secret (generate: `node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"`)
- `NEXTAUTH_URL` — e.g. `http://localhost:3000`
- `PLAID_CLIENT_ID`, `PLAID_SECRET`, `PLAID_ENV` — only needed if using Plaid; set `PLAID_ENV=production` for production
- `PLAID_SANDBOX_SECRET` — sandbox-only secret; used by `test:offboarding` script only
- `PLAID_WEBHOOK_URL` — public URL for Plaid webhooks, e.g. `https://yourdomain.com/api/plaid/webhook`
- `PLAID_REDIRECT_URI` — OAuth redirect URI registered in Plaid dashboard
- `ENCRYPTION_KEY` — 64 hex chars (32 bytes) for AES-256-GCM encryption of Plaid tokens **and** MFA secrets
- `NEXT_PUBLIC_PRIVACY_URL` — optional; shown in the pre-Link consent modal

## Code structure
- `src/app/(app)/` — protected app pages: `budget/`, `accounts/`, `transactions/`, `settings/security/`, `settings/categories/`
- `src/app/api/` — API route handlers: `auth/`, `plaid/`, `transactions/`, `accounts/`, `ai/` (chat, insights/monthly, forecast, debt-plan)
- `src/components/` — React client components (modals, tables, forms)
- `src/lib/` — pure server-side utilities
  - `actions.ts` — all Next.js Server Actions (mutations)
  - `budget.ts` — pure budget math engine + display helpers
  - `logger.ts` — app-level logger; persists `warn`/`error` to `app_logs` (fire-and-forget, never blocks the response)
  - `admin-mode.ts` — `useAdminMode()` hook backed by `localStorage` (`budget_admin_mode`); gates destructive Plaid maintenance actions
  - `plaid.ts` — Plaid client singleton; validates required env vars on non-sandbox startup
  - `plaid-sync.ts` — core transaction sync logic shared by the sync route and webhook handler
  - `plaid-item.ts` — `removeItem()` utility: calls `/item/remove`, swallows already-removed errors
  - `plaid-logger.ts` — structured backend logging; every Plaid API call logs `request_id` for support
  - `plaid-analytics.ts` — frontend Link conversion logging via `onEvent`/`onExit` callbacks
  - `crypto.ts` — AES-256-GCM encrypt/decrypt for Plaid tokens and MFA secrets
  - `payee.ts` — payee name normalization for auto-categorization
  - `ai/context.ts` — builds the AI context payload (per-category spent vs. budget, income sources, APRs, historical averages, pace, `today`, `isCurrentMonth`). Expense categories are tiered into `expenseCategoriesAtRisk` (full detail) and `expenseCategoriesOnTrack` (compact) instead of being capped at 20.
  - `ai/prompts.ts` — envelope-budgeting system prompt + structured prompts for insights and debt plan routes
  - `ai/provider.ts` — Anthropic / OpenAI HTTP wrapper. Exports `generateText` for one-shot routes (insights, debt plan, monthly forecast prose) and `generateChat` for the multi-turn chat. The chat path uses Anthropic `cache_control.ephemeral` blocks on the system prompt and the context JSON so follow-up turns only re-bill the new user message + history.
  - `ai/types.ts` — zod schemas for AI response payloads (`ChatMessage`, `Insight`, `DebtPlan`)
  - `ai/guards.ts` — response post-processing: educational-guidance disclaimer + resilient JSON extraction from prose-wrapped outputs
- `src/components/`
  - `PlaidLink.tsx` — initial bank connection; shows `PlaidConsentModal` before opening Link
  - `PlaidRelink.tsx` — update mode re-authentication for `ITEM_LOGIN_REQUIRED` / expired connections
  - `PlaidNewAccounts.tsx` — update mode with `account_selection_enabled=true` for `NEW_ACCOUNTS_AVAILABLE`
  - `PlaidConsentModal.tsx` — pre-Link consent/notice UI shown before any initial connection
  - `RelinkBanner.tsx` — global amber banner shown when any account has `requiresRelink=true`
  - `NewAccountsBanner.tsx` — global cyan banner shown when any account has `newAccountsAvailable=true`
  - `BudgetCoachSection.tsx` — collapsible AI Coach section on the budget page; hosts forecast, insights, and chat at fixed 16rem height; persists collapsed state in `localStorage` (`budget-coach-collapsed`)
  - `SpendingForecastCard.tsx` — deterministic projection widget; calls `POST /api/ai/forecast` and renders at-risk vs. on-track categories
  - `BudgetInsightsCard.tsx` — monthly LLM insights with dismiss + explain actions (hands off into `AIAssistantPanel`)
  - `AIAssistantPanel.tsx` — chat UI for the AI Coach; consumes `pendingMessage` from insights
  - `DebtPaydownCard.tsx` — calls `POST /api/ai/debt-plan` for avalanche/snowball recommendations
  - `CategoryManager.tsx` — drag-and-drop category and group manager rendered by `settings/categories/page.tsx`
  - `TransactionsList.tsx` — cross-account transactions table with category/month/account filters and inline edit/recategorize/delete
- `scripts/` — standalone scripts (not Next.js)
  - `test-offboarding.ts` — integration test for `/item/remove` flow against Plaid sandbox
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
- Plaid sync auto-detects common transfer payees matching `TRANSFER_RE` in `src/lib/plaid-sync.ts` (`Online Transfer`, `ACH Transfer`, `Wire Transfer`, etc.) and sets `isTransfer=true` on import
- **CC bill payments are NOT transfers.** A payment from a checking account to a credit card must remain a normal transaction so it can be categorized to a CC Payment category and feed the YNAB-style payment bucket. The detection regex deliberately excludes CC payment payees, and `revertIncorrectTransfers()` in `src/lib/actions.ts` reverts any historically imported transfer that no longer matches `TRANSFER_RE`.

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

### Plaid update mode
Three flag columns on `importConnections` drive update mode prompts:
- `requiresRelink` — set by `PENDING_DISCONNECT`, `PENDING_EXPIRATION`, `ITEM_LOGIN_REQUIRED` webhooks; cleared on successful sync or `clearRelinkRequired()` server action. Shows amber banner (`RelinkBanner`) + `PlaidRelink` button replacing the Sync button.
- `newAccountsAvailable` — set by `NEW_ACCOUNTS_AVAILABLE` webhook; cleared by `clearNewAccountsAvailable()`. Shows cyan banner (`NewAccountsBanner`) + `PlaidNewAccounts` button alongside Sync.
- `LOGIN_REPAIRED` webhook clears `requiresRelink` automatically when another app repairs the Item.

Update mode link tokens are fetched from `/api/plaid/update-link-token`. Pass `{ accountSelectionEnabled: true }` in the body to get a token with `update.account_selection_enabled=true` (used by `PlaidNewAccounts`).

### Plaid /item/remove and data retention
`removeItem(accessTokenEncrypted)` in `src/lib/plaid-item.ts` calls Plaid's `/item/remove` and swallows errors (item may already be gone). It is called:
- In `deleteAccount()` before the account is deleted (only if no other account shares the `plaidItemId`)
- In `disconnectPlaidConnection(accountId)` server action: removes the whole Item, deletes Plaid-fetched data (holdings, liabilities), and removes all `importConnections` rows for the Item
- In `POST /api/user/delete` for user offboarding: removes all Items then deletes the user (data cascades)

When `disconnectPlaidConnection` is called, holdings and liability details are explicitly deleted (they are Plaid-sourced data with no business need without a connection). Transactions are kept as the user's financial history.

### Plaid logging
All Plaid API calls log structured JSON via `plaidLog()` from `src/lib/plaid-logger.ts`. Every entry includes `route`, `userId`, `plaidItemId`, and — critically — `requestId` from the Plaid API response. Filter logs on `[plaid]` in any log platform. The `requestId` is required when filing a Plaid support ticket.

Frontend Link events (`OPEN`, `HANDOFF`, `EXIT`, `SELECT_INSTITUTION`, etc.) are logged via `logLinkEvent()` / `logLinkExit()` from `src/lib/plaid-analytics.ts`. These are wired into `onEvent`/`onExit` in all three Link components.

### Plaid duplicate Item detection
When a user connects a bank, the `institutionId` from `onSuccess` metadata is sent to `/api/plaid/exchange-token`. After exchange, if the user already has a connection with the same `plaidInstitutionId` but a **different** `item_id`, it's a duplicate: the new token is immediately removed and a 409 is returned. Same `item_id` = re-linking the same Item intentionally (allowed). The `plaidInstitutionId` is stored on every connection row.

### Plaid multi-product configuration
The link token uses:
- `products: [Transactions]` — required; restricts to institutions supporting Transactions
- `additional_consented_products: [Investments, Liabilities]` — user consents during Link but billing is deferred until the endpoints are first called; avoids charges for users who never trigger investment/liability syncs

Do **not** move Investments or Liabilities to `optional_products` — that bills on Item creation even if the user only has a checking account.

### Plaid security
- Access tokens: encrypted with AES-256-GCM immediately on receipt; plaintext never stored
- MFA secrets: also encrypted with AES-256-GCM; `resolveMfaSecret()` in `auth.ts` and the disable route handles backward-compat with any pre-existing plaintext secrets
- No `/sandbox/` endpoints are called in the app itself; they only appear in `scripts/test-offboarding.ts`
- Production env validation in `plaid.ts` throws at startup if `PLAID_CLIENT_ID`, `PLAID_SECRET`, or `ENCRYPTION_KEY` are missing when `PLAID_ENV != sandbox`

### AI Budget Coach
The budget page renders `BudgetCoachSection` below the budget grid. It is collapsible (state in `localStorage` under `budget-coach-collapsed`) and lays out three fixed-height (`h-64`) panels:
- `SpendingForecastCard` — hits `POST /api/ai/forecast`, a **pure-math** route (no LLM call) that returns per-category `spentDollars`, `projectedDollars`, and `projectedOverspendDollars` plus a `pace` object (`daysElapsed`, `daysInMonth`, `pacePercent`).
- `BudgetInsightsCard` — LLM-generated monthly insights from `POST /api/ai/insights/monthly`; the "Explain" button hands the query into `AIAssistantPanel` via the `pendingMessage` prop.
- `AIAssistantPanel` — chat panel that calls `POST /api/ai/chat` using the context produced by `buildMonthlyContext()` in `src/lib/ai/context.ts`.

`DebtPaydownCard` is rendered separately and calls `POST /api/ai/debt-plan`. All four AI routes are wrapped in `try/catch` and call `appLog('error', ...)` so failures land in `app_logs`. `ANTHROPIC_API_KEY` (and optionally `ANTHROPIC_MODEL`) must be set in `.env.local` for LLM-backed panels.

`POST /api/ai/chat` is a real multi-turn endpoint:
- prior `ai_messages` for the given `conversationId` are loaded oldest-first and replayed to the model (capped at the last 20 turns)
- the conversation's budget month is pinned to whatever the first user turn carried in `metadata.month`; mismatched subsequent requests return 409
- every message stores `metadata.contextHash` (sha1 prefix of the rendered context JSON) and `metadata.contextGeneratedAt` so chat turns are reproducible against the live data they were grounded in
- both successful and failed calls insert into `ai_audit_events` (failures carry `safetyFlags.error`), so latency/error dashboards see real rates

### Forecast accuracy guardrails
The forecast intentionally avoids false alarms for fixed monthly bills:
- One-time, fixed monthly charges (e.g. rent, subscriptions) are detected by historical pattern (single transaction per month at a stable amount). They are excluded from naive day-of-month extrapolation so a $1,800 rent payment on day 1 does NOT project a $54,000 monthly spend.
- The same logic is mirrored in `src/lib/ai/context.ts` so chat/insights see the same "already paid for this month" view.

### Admin mode
`useAdminMode()` in `src/lib/admin-mode.ts` is a client-side hook backed by `localStorage` (`budget_admin_mode`). Pages call it to conditionally render destructive Plaid maintenance buttons (Clear transactions, Repair, Enrich payees, Clean up orphans). The toggle UI lives in `src/app/(app)/settings/security/page.tsx`; the gated buttons are rendered in `accounts/page.tsx` and `components/AccountRegister.tsx`.

### Cross-account transactions page
`src/app/(app)/transactions/page.tsx` renders `TransactionsList` and accepts `category`, `month`, and `account` query params. It joins `transactions → accounts → categories → categoryGroups` with `LEFT JOIN`s, orders by `(date desc, createdAt desc)`, and caps the result set at 500 rows. All categories and accounts are loaded for the filter dropdowns. The client component supports inline edit, recategorize, and delete via existing Server Actions.

### Categories settings page
Group and category management was moved out of the budget grid into a dedicated page at `src/app/(app)/settings/categories/page.tsx` rendered by `CategoryManager`. The query filters out `isSystem` (CC Payments) and `isTransfer` (legacy) groups so the user only manages real expense/income groups. Drag-and-drop, rename, add/remove all use existing Server Actions in `src/lib/actions.ts`.

### App-level logging (`app_logs`)
`src/lib/logger.ts` exports `appLog(level, route, message, options)` which:
1. Always writes JSON to console (captured by Vercel Functions logs).
2. Fire-and-forget inserts `warn` and `error` entries into the `app_logs` table (`src/db/schema.ts:280`).
3. Never throws — a failed DB write only logs to console.

This exists because Vercel's log retention is short and we need a longer audit trail for Plaid/AI failures. Inspect logs via `npm run db:studio → app_logs`. The `userId` column is nullable so system-level errors (webhooks, background tasks) can be logged without a session.

### Plaid consent error handling
When Plaid returns `ADDITIONAL_CONSENT_REQUIRED` or `PRODUCT_NOT_READY` from the Investments or Liabilities sync endpoints, the route surfaces the error to the client and the affected panel renders an inline "Re-link to enable" prompt that calls `/api/plaid/update-link-token` with `optional_products` to request the additional product consent. The re-link flow guards against an endless loop: an already-relinked Item that still returns these errors falls back to an explanatory message instead of looping back into Link.

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
