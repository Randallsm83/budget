# Accounts

A user adds a bank or tracking account by hand, with a starting balance. On-budget types (Checking, Savings, Cash, Credit Card) feed Ready to Assign; tracking types only count toward net worth. A non-zero starting balance is recorded as a cleared `Starting Balance` transaction. Adding a Credit Card also creates its CC Payment category.

## Sub-features

- `account-add-manual` creates a checking account with a starting balance.
- `account-starting-balance` records a cleared `Starting Balance` transaction equal to the balance.
- `account-listing` shows the account on `/accounts` and in the sidebar under `Cash & Bank` with the formatted balance.
- `account-add-credit-card` (not automated) adds a `💳 Credit Card Payments` category named after the card.

## How to get to it (user POV)

- Sidebar `🏦 Accounts` → `/accounts` → button `+ Add Account` → `Manual` tab (default).
- On an empty budget, `/budget/YYYY-MM` shows `No accounts yet` instead of the budget table.

## Driving it with drive.mjs

Preconditions:

- Baseline instance, signed in.

- **Open the modal.** Choose `+ Add Account` on `/accounts`. `node scripts/drive.mjs add-account`. A form with placeholder `e.g. Chase Checking` appears.
- **Fill.** Name `Verify Checking <stamp>`, select value `checking` in the type `select`, balance placeholder `0.00` → `1234.56`. Same journey. Screenshot `01-add-account-filled`.
- **Submit.** Choose button `Add Account` (exact). Same journey. The modal closes; the name appears in the Accounts list and the sidebar (screenshot `02-accounts-after-add`).
- **Side effects.** `db-after.json`: one `accounts` row, `type=checking`, `balance=1234560`, `cleared_balance=1234560`. `db-after-transactions.json`: one row `Starting Balance`, `amount=1234560`, `cleared=true`.

## Gotchas

- The `🏦 Connect via Plaid` tab calls `/api/plaid/link-token`, which returns 500 here (the guard blocks `sandbox.plaid.com`). Do not try to prove Plaid linking locally.
- Balance input accepts `$` and `,`; it is parsed with `parseFloat`, so a typo like `12a` silently becomes `12`.
- The Accounts page loads its list with a client fetch of `/api/accounts`; wait for the name, not for page load.
