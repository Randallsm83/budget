# Account register

Each account has a register at `/accounts/<id>` listing its transactions. A user adds a transaction with date, payee, category, direction (Out/In) and amount. The account balance changes by the amount, the payee is remembered for auto-categorisation, and ALL-CAPS payees are displayed title-cased.

## Sub-features

- `register-add-outflow` adds an Out transaction with a category.
- `register-balance` updates the account balance (header, sidebar) by the signed amount.
- `register-payee-rule` learns payee → category in `payee_rules`.
- `register-payee-display` shows `VERIFY GROCER 123` as `Verify Grocer 123` (stored value unchanged).
- `register-row-appears` shows the new row in the register.

## How to get to it (user POV)

- `/accounts` → click the account row link, or click the account in the sidebar → `+ Add Transaction`.

## Driving it with drive.mjs

Preconditions:

- Baseline instance, signed in. The journey first creates `Verify Txn Acct <stamp>` with `500.00` through the Accounts modal.

- **Open.** On the register choose button `+ Add Transaction`. `node scripts/drive.mjs add-transaction`. Heading `Add Transaction`.
- **Fill.** Payee placeholder `Who did you pay?` → `VERIFY GROCER <token>`; second `select` in the form → label `Immediate Obligations: Groceries`; button `Out`; amount placeholder `0.00` → `42.17`. Same journey. Screenshot `02-add-transaction-filled`.
- **Submit.** Button `Add Transaction` (exact). Same journey. Modal closes; header and sidebar balance read `$457.83` (screenshot `03-register-after-add`).
- **Row before reload.** Assertion `new row visible in register without reload`.
- **Row after reload.** Reload; `Verify Grocer <token>` visible (screenshot `04-register-after-reload`).
- **Side effects.** `db-after.json`: one transaction, `amount=-42170`, category `Groceries`, account `balance=457830`. `db-after-payee-rules.json` has a rule mapped to `Groceries`.

## Gotchas

- Known failure at commit f41c09c: the new row does NOT appear until a full reload, although balances update immediately. `AccountRegister` copies its `transactions` prop into `useState` once and never re-syncs on `router.refresh()`. The journey reports this as a failed `new row visible in register without reload` assertion while every later assertion passes; that is the expected signature until the app is fixed. Do not remove the assertion.
- Each row exists twice in the DOM (hidden mobile copy first). Use `getByText(...).filter({ visible: true })`.
- Use digits in test payees: `displayPayee()` lowercases everything after the first letter of each word, so `ABC123Z` displays as `Abc123z`.
- `Connect Bank` on the register calls `/api/plaid/link-token` on render; the egress guard blocks the outbound `sandbox.plaid.com` request, so it logs a 500 here and `doctor.sh` shows a blocked-egress `WARN`. Harmless for this journey.
- Choosing a category in the modal resets Out/In to match it (income categories select In). Choose the category before the direction.
