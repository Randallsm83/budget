---
name: verify-budget
description: Drive the budget app (Next.js 16 envelope budgeting web UI with NextAuth credentials+TOTP, Neon Postgres, Plaid) in headless Chrome against a fully local, isolated instance and capture proof. Use when you need to show that sign-in, MFA, accounts, the account register, budget assignment, or the cross-account transactions search actually work for a user, before or after a change in this repo.
---

# verify-budget

Proves budget behavior through the real browser UI on a private stack: a throwaway Postgres 16 cluster, a local stand-in for Neon's SQL-over-HTTP endpoint, and `next dev` running a snapshot of this checkout. Nothing here talks to live Neon, Plaid, Anthropic or OpenAI.

Why the stand-in: the app only speaks Neon's HTTP driver (`src/db/index.ts`, `drizzle-orm/neon-http`), so a plain local Postgres URL is not enough. `scripts/egress-guard.cjs` is preloaded into every Node process the helpers start. It reroutes Neon HTTP calls for the fake host `db.verify-budget.invalid` to `scripts/neon-shim.mjs`, and it refuses (and logs) any request to `*.neon.tech`, `*.plaid.com`, `*.anthropic.com` or `*.openai.com`.

Treat the user's real environment as production. Never point these helpers at a real `DATABASE_URL`, never copy `.env*` files into the run, and never drive an instance you did not launch.

Layout (all state under `${XDG_STATE_HOME:-$HOME/.local/state}/verify-budget/`):

| Path | What | Removed by cleanup |
| --- | --- | --- |
| `app/` | rsync snapshot of the checkout (no `.git`, `.next`, `node_modules`, `.env*`) + `npm ci` | yes |
| `pgdata/` | private Postgres cluster on `127.0.0.1:41010` | yes |
| `run/` | pids, logs, throwaway `secrets.env` (mode 600), `mfa.secret` | yes (logs archived first) |
| `tools/` | `playwright-core` and `pg` installs | only with `--all` |
| `evidence/` | proof artifacts | never |

Ports: Postgres `41010`, shim `41011`, app `41012` (override with `VERIFY_BUDGET_PG_PORT`, `VERIFY_BUDGET_SHIM_PORT`, `VERIFY_BUDGET_APP_PORT`; stay inside 41000-41099). The user's own dev server on 3000 is never touched; because the app runs from `app/`, it does not share `.next` with the checkout and can run beside it. One verify-budget instance per machine: launch refuses if its pid file is live or a port is taken.

Requirements: macOS with Homebrew `postgresql@16` (`/opt/homebrew/opt/postgresql@16/bin`, override with `VERIFY_BUDGET_PGBIN`), Node 20+, `rsync`, `openssl`, Google Chrome in `/Applications`. Agent shells: prefix commands with `source ~/.config/zsh/agent-env.zsh &&`.

## Launch

```bash
source ~/.config/zsh/agent-env.zsh && .omp/skills/verify-budget/scripts/launch.sh
```

From the repo root. It takes about 15 s and, in order:

1. Snapshots the checkout into `app/` and runs `npm ci` there (the checkout's own `node_modules` and lockfile are not touched). Records `git rev-parse HEAD` and a hash of `git status --porcelain` in `run/`.
2. Installs `playwright-core` and `pg` into `tools/` if missing.
3. Generates throwaway `AUTH_SECRET`, `ENCRYPTION_KEY` and a seed password into `run/secrets.env`.
4. `initdb` + `pg_ctl start` a fresh cluster (UTC, trust auth, listens on 127.0.0.1 only), `createdb budget`.
5. Applies the schema with the app's own `drizzle-kit push --force` (over TCP).
6. Starts the shim, then runs the app's own seed script (`src/db/seed.ts`) through it. That creates user `verify@budget.invalid` (name `Verifier`) and the default category groups: Immediate Obligations (incl. `Groceries`), True Expenses, Debt Payments, Quality of Life. No accounts or transactions.
7. Starts `next dev -H 127.0.0.1 -p 41012` under `env -i` with only the variables in `appenv()` (`scripts/env.sh`): `PLAID_ENV=sandbox` with empty Plaid credentials, no AI keys.

Ready is printed only after `GET /login` returns 200 and `POST /api/auth/check` authenticates the seeded user through app, shim and Postgres:

```
READY http://127.0.0.1:41012 commit=<sha> run=<state>/run evidence=<state>/evidence
```

Any failure names the log to read (`run/next.log`, `run/shim.log`, `run/seed.log`, `run/db-push.log`, `run/npm-ci.log`). Run `cleanup.sh` after a failed launch before retrying.

## Doctor

```bash
source ~/.config/zsh/agent-env.zsh && .omp/skills/verify-budget/scripts/doctor.sh
```

Read-only; exit 0 only if every line is `OK`. It checks: the recorded Postgres, shim and Next pids (or their children) own ports 41010/41011/41012; the local DB answers; `/login` is 200; the seeded user authenticates; that auth read raised the shim's `served` counter (so the app's database really is the local one); the checkout still matches the snapshot (if not, relaunch to test the new code); and whether the guard blocked any live-service egress (listed as `WARN` with host and time).

## Drive

```bash
source ~/.config/zsh/agent-env.zsh && node .omp/skills/verify-budget/scripts/drive.mjs <journey>
```

Journeys: `login`, `add-account`, `add-transaction`, `assign`, `search`, `mfa`, or `all` (runs them in that order). Each opens a fresh headless Chrome context (1360x900, so the desktop budget grid is used), signs in through `/login` like a user (and through the TOTP step once `mfa` has enabled it), performs the journey with the selectors listed in `features/`, then checks both the screen and the database. It prints `PASS`/`FAIL` per journey with each assertion and exits non-zero on any failure. Journeys create uniquely named data, so they can be re-run against the same instance.

The feature map is in [`features/README.md`](features/README.md). Each feature file names the user path, the exact handles, and the end state that proves it.

To drive something the script does not cover, copy the pattern in `drive.mjs`: `chromium.launch({ channel: 'chrome', headless: true })` from `tools/node_modules/playwright-core`, `BASE_URL` and secrets from `scripts/env.sh` / `run/secrets.env`, and the `login()` helper. Prefer `getByRole`/`getByPlaceholder`/visible text; the app has almost no ARIA labels or test ids.

## Evidence

Every journey writes `evidence/<UTC stamp>-<journey>/`:

- `steps.jsonl`: each user action, URL, browser console errors and HTTP >= 400 responses.
- `NN-<label>.png`: full-page screenshots before and after the action (and `failure.png` on error).
- `db-<label>.json`: rows read straight from the local Postgres before and after (the side effect, not just the screen).
- `result.json`: journey, pass/fail, every assertion with its observed value, commit.

`cleanup.sh` also archives `next.log`, `shim.log`, `seed.log`, `db-push.log`, `postgres.log`, `egress-blocked.log` and the commit into `evidence/run-logs-<stamp>/`. Secrets are never copied.

Proof standards for this app:

- Go through the UI the user uses (`/login`, buttons, modals, inline editors). Do not call server actions, `/api/*` routes or SQL to cause the change; SQL is for observing it.
- Capture the action and the result: a screenshot of the filled form or edited cell and one of the resulting page, plus the DB rows. Money is stored in milliunits (`$1.00 = 1000`); assert the integer, not the formatted string.
- Assert user-visible state after a reload as well as immediately, because several screens hold client state (see the register gotcha).
- Plaid, webhooks, AI coach panels and anything else that needs a live third party cannot be proven here. Expected noise in `steps.jsonl`: `/api/plaid/link-token` 500 (the register's `Connect Bank` widget calls it on render; the guard blocks `sandbox.plaid.com` and logs it to `run/egress-blocked.log`, so `doctor.sh` then shows a `WARN`) and `/api/ai/insights/monthly` 500 (`OPENAI_API_KEY is not configured`). A blocked-egress `WARN` means the feature that caused it is unverified, not passed. Do not add real credentials to make them work.

## Cleanup

```bash
source ~/.config/zsh/agent-env.zsh && .omp/skills/verify-budget/scripts/cleanup.sh        # keep tools/ cache
source ~/.config/zsh/agent-env.zsh && .omp/skills/verify-budget/scripts/cleanup.sh --all  # also drop tools/
```

Archives run logs into `evidence/`, stops the recorded Next and shim processes and their descendants (never by name), stops Postgres with `pg_ctl -D pgdata stop`, deletes `run/`, `app/`, `pgdata/`, and warns (exit 1) if any of the three ports still has a listener. `evidence/` survives. Run it after every launch, including failed ones.

Before signalling a recorded pid, cleanup confirms it is still the process launch started: its `ps -o lstart` must equal `run/<name>.start` (written at launch), Next's working directory must be `app/` and the shim's command line must be this skill's `neon-shim.mjs`. Any mismatch prints `REFUSE <name> pid <pid>: ...` and that pid is left alone; cleanup continues with the rest. The SIGKILL fallback only hits pids whose start time is unchanged since the SIGTERM pass. If cleanup refused a pid, find and stop the real leftover yourself by port (`lsof -nP -iTCP:41012 -sTCP:LISTEN`) after checking it is this run's.

## Helpers

All in `scripts/`, executable, run from anywhere:

| Script | Use |
| --- | --- |
| `launch.sh` | Start the isolated instance; prints `READY ...`. |
| `doctor.sh` | Read-only health and isolation check. |
| `drive.mjs <journey>` | Browser journeys with evidence (`node scripts/drive.mjs all`). |
| `cleanup.sh [--all]` | Tear down what launch started; keep evidence. |
| `env.sh` | Shared paths, ports, `appenv()` (env -i wrapper) and `pid_tree()`. Source it from bash, not zsh (it uses `BASH_SOURCE`). |
| `neon-shim.mjs` | Neon SQL-over-HTTP stand-in on node-postgres (started by launch). `GET /healthz` returns `served` count. |
| `egress-guard.cjs` | `--require` preload: reroutes the fake Neon host to the shim, blocks live Neon/Plaid/Anthropic/OpenAI. |

Inspect the local DB read-only while an instance runs:

```bash
/opt/homebrew/opt/postgresql@16/bin/psql postgresql://verify@127.0.0.1:41010/budget -c 'select name, type, balance from accounts'
```

Keep the map honest as the app changes with `/maintain-verification-skill`.
