# Budget

A personal budgeting app built on envelope budgeting principles (YNAB-style). Assign every dollar to a category, track spending across accounts, and optionally sync transactions automatically via Plaid.

## Features

- Envelope budgeting — assign money to categories per month, carry balances forward
- Account register — manual transactions, CSV import, or Plaid bank sync
- Payee auto-categorization — learns your corrections and applies them to future imports
- TOTP two-factor authentication
- Plaid integration — link bank accounts, auto-sync via webhooks, cursor-based incremental updates
- Plaid production-ready — pre-Link consent UI, duplicate Item detection, `/item/remove` on disconnect and offboarding, structured logging with `request_id`
- Update mode — automatic prompts to re-authenticate expired bank connections or add newly detected accounts
- YNAB-style CC Payment tracking — spending auto-funds payment buckets, card balance shown live
- Transfer detection — inter-account transfers excluded from budget math automatically
- Drag-and-drop reordering for budget groups, categories, and sidebar accounts

## Tech stack

- [Next.js 16](https://nextjs.org) (App Router, React Server Components)
- [Drizzle ORM](https://orm.drizzle.team) + [Neon](https://neon.tech) (serverless PostgreSQL)
- [Auth.js v5](https://authjs.dev) — credentials + TOTP MFA, JWT sessions
- [Plaid](https://plaid.com) — bank connection and transaction sync
- [Tailwind CSS v4](https://tailwindcss.com)

## Setup

1. Clone the repo and install dependencies:

```bash
npm install
```

2. Copy the example env file and fill in your values:

```bash
cp .env.local.example .env.local
```

| Variable | Description |
|---|---|
| `DATABASE_URL` | PostgreSQL connection string (Neon, Supabase, or local) |
| `AUTH_SECRET` | Random secret for Auth.js — generate with `node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"` |
| `NEXTAUTH_URL` | App base URL, e.g. `http://localhost:3000` |
| `PLAID_CLIENT_ID` | Plaid client ID (optional — only needed for bank sync) |
| `PLAID_SECRET` | Plaid secret (optional) |
| `PLAID_ENV` | `sandbox`, `development`, or `production` |
| `PLAID_WEBHOOK_URL` | Public URL for Plaid webhooks, e.g. `https://yourdomain.com/api/plaid/webhook` |
| `ENCRYPTION_KEY` | 64 hex chars (32 bytes) for AES-256-GCM encryption of Plaid tokens and MFA secrets |
| `PLAID_SANDBOX_SECRET` | Plaid sandbox secret (optional — only for `npm run test:offboarding`) |
| `NEXT_PUBLIC_PRIVACY_URL` | URL to your privacy policy, shown in the pre-Link consent modal (optional) |

3. Push the schema to your database:

```bash
npm run db:push
```

4. Seed your user account:

```bash
# Set SEED_USER_EMAIL, SEED_USER_PASSWORD, SEED_USER_NAME in .env.local first
npm run db:seed
```

5. Start the dev server:

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) and log in with your seed credentials.

## Database commands

```bash
npm run db:generate   # generate migration files after schema changes
npm run db:push       # push schema directly to DB (dev shortcut, skips migrations)
npm run db:studio     # open Drizzle Studio GUI
npm run db:seed       # create initial user from SEED_USER_* env vars
```

## Testing

```bash
npm test                  # run all tests (Vitest)
npm run test:watch        # watch mode
npm run test:coverage     # coverage report
npm run test:offboarding  # Plaid /item/remove integration test (uses sandbox credentials)
```

Unit tests live in `src/lib/__tests__/`. The offboarding integration test (`scripts/test-offboarding.ts`) requires `PLAID_CLIENT_ID` and `PLAID_SANDBOX_SECRET` in `.env.local` and exercises the full `/item/remove` flow against the Plaid sandbox.

## Development workflow

Main branch is protected — all changes go through PRs:

```bash
git checkout -b feat/my-feature
# make changes
git push origin feat/my-feature
gh pr create --fill
gh pr merge --squash
```
