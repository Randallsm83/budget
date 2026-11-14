# Budget verification map

The maintained recipes for proving budget's user-facing behavior through the browser. Read this index, then the matching feature file. Every recipe runs against an instance started by `scripts/launch.sh`; `scripts/drive.mjs <journey>` automates the drives listed here.

## Baseline preconditions

- `launch.sh` printed `READY http://127.0.0.1:41012 ...` and `doctor.sh` exits 0 (all `OK`).
- Fresh seed: one user `verify@budget.invalid` (name `Verifier`, password in `run/secrets.env`), MFA off, no accounts, no transactions, default groups Immediate Obligations (`Rent / Mortgage`, `Electric`, `Water`, `Internet`, `Groceries`, `Transportation`, `Phone`), True Expenses, Debt Payments, Quality of Life.
- Browser viewport at least 640px wide (the drives use 1360x900). Below `sm` the app swaps to mobile card layouts with different markup.
- Never drive the user's own server on port 3000 or any instance this run did not launch.

## Driving conventions

- Sign in through `/login` like a user; there is no test login route. The `login()` helper in `drive.mjs` handles the TOTP step once MFA is on.
- Prefer visible text, roles and placeholders: the app has almost no `aria-label`s or test ids. Many rows render twice (hidden mobile copy + visible desktop copy): filter locators with `{ visible: true }`.
- Data created by a journey carries a unique stamp or token so journeys can repeat on one instance. They do not delete what they create; relaunch for a clean slate.
- Money in the DB is integer milliunits (`$1.00 = 1000`). Assert integers in SQL, formatted strings (`$1,234.56`, `-$42.17`) on screen.
- First visit to each route compiles it in `next dev`; allow up to 60 s.

## Proof and skip reporting

- Capture the filled form or edited cell, the resulting screen, and the DB rows (`db-*.json`) for every mutation.
- Re-check the screen after a reload when a component keeps client state.
- Plaid linking, relink/new-account banners, webhooks, CSV-import against real bank exports, and the AI coach panels need live third parties or credentials and are not proven here. Report them as unverified with the reason; never as passed through another path.
- Expected noise: `/api/plaid/link-token` 500 (guard blocks `sandbox.plaid.com`, logged in `run/egress-blocked.log`) and `/api/ai/insights/monthly` 500 (no AI key).

## Feature entry contract

Each feature file has an H1 and a one-paragraph description, then exactly four H2s: `Sub-features`, `How to get to it (user POV)`, `Driving it with drive.mjs` (starting with `Preconditions:`), `Gotchas`.

## Features

- [Sign-in and MFA](./sign-in-and-mfa.md): auth gate, credentials sign-in, TOTP enrolment, wrong/right code at sign-in. Journeys `login`, `mfa`.
- [Accounts](./accounts.md): add a manual on-budget account with a starting balance. Journey `add-account`.
- [Account register](./account-register.md): add an outflow transaction with a category; balance, payee rule, register row. Journey `add-transaction`.
- [Budget assignment](./budget-assignment.md): assign money to a category for the month; Ready to Assign moves by the same amount. Journey `assign`.
- [Transactions search](./transactions-search.md): cross-account list with client-side text search. Journey `search`.

Not mapped yet: Categories settings (`/settings/categories`: `+ Add Group`, `+ Add Category`, drag reorder), transfer toggle, cleared toggle, close/delete account, CSV import, `Delete Account` in Security settings (deletes the seeded user; relaunch afterwards).
