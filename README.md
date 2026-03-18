# Budget

A personal budgeting app built on envelope budgeting principles (YNAB-style). Assign every dollar to a category, track spending across accounts, and optionally sync transactions automatically via Plaid.

## Features

- Envelope budgeting — assign money to categories per month, carry balances forward
- Account register — manual transactions, CSV import, or Plaid bank sync
- Payee auto-categorization — learns your corrections and applies them to future imports
- TOTP two-factor authentication
- Plaid integration — link bank accounts and sync transactions with cursor-based incremental updates

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
| `ENCRYPTION_KEY` | 64 hex chars (32 bytes) for AES-256-GCM encryption of Plaid tokens |

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
