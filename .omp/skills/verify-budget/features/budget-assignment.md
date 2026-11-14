# Budget assignment

The budget page for a month lists category groups with Assigned, Activity and Available per category, and a `Ready to Assign` total at the top. A user clicks a category's Assigned amount, types a new amount and presses Enter. The amount is saved for that month and Ready to Assign drops by the same amount. Invalid input is rejected without saving.

## Sub-features

- `assign-edit` saves a new Assigned amount for a category and month (`month_budgets`).
- `assign-rta` lowers Ready to Assign by exactly the amount assigned.
- `assign-persist` keeps the value after a reload.
- `assign-invalid` (not automated) rejects input like `12x` with a message starting `Invalid amount` and keeps the old value.
- `assign-month-nav` (not automated) moves between months via the month header; `/budget` redirects to the current month.

## How to get to it (user POV)

- Sidebar `📊 Budget` → `/budget` → redirects to `/budget/YYYY-MM`.

## Driving it with drive.mjs

Preconditions:

- Baseline instance, signed in, and at least one on-budget account. The journey adds `Verify Budget Acct <stamp>` (`1234.56`) through the Accounts modal if none exists; otherwise it uses the current Ready to Assign.

- **Read the start.** On `/budget/YYYY-MM` find the desktop row `div.hidden.sm\:grid` containing exact text `Groceries`; its first button is the Assigned amount. Read `Ready to Assign` (the `p` after that label). `node scripts/drive.mjs assign`. Screenshot `NN-budget-before`, `db-before.json`.
- **Edit.** Click the Assigned button, fill the row's `input` with current + `100.00`, press `Enter`. Same journey. The button text becomes the new amount.
- **Persist.** Reload. Same journey. Screenshot `NN-budget-after-reload`; Assigned shows the new amount and Ready to Assign is `$100.00` lower.
- **Side effects.** `db-after.json`: `month_budgets` row for `Groceries` in that month with `budgeted` = new amount in milliunits (`100000` on a fresh instance).

## Gotchas

- With zero accounts the page shows `No accounts yet` and no table.
- `/budget` picks the month with the server's clock (`currentMonth()` in a server component); the journey reads the month from the resulting URL rather than computing it.
- Assigned uses `parseMoneyStrict`: blank means `0`, anything else must be a whole amount. A rejected value leaves the old amount and shows a red `role="alert"` message.
- The AI coach section on this page calls `/api/ai/insights/monthly` on load; without keys it returns 500 (`OPENAI_API_KEY is not configured`) and writes an `app_logs` error row. That is expected here.
- Rows exist twice (mobile card + desktop grid); select the desktop grid.
