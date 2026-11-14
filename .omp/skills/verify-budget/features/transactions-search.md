# Transactions search

`/transactions` lists up to 500 transactions across all accounts, newest first, with server-side filters (category, month, account) and a client-side text box that narrows the list by payee, memo or account name. The header shows the visible count and inflow/outflow totals.

## Sub-features

- `txsearch-text` filters by text and updates the `N transaction(s)` header.
- `txsearch-payee-display` shows ALL-CAPS payees title-cased.
- `txsearch-filters` (not automated) narrows by `All categories` / month / `All accounts` selects via `?category=`, `?month=`, `?account=`.
- `txsearch-inline` (not automated) recategorise, toggle cleared, delete from the row.

## How to get to it (user POV)

- Sidebar `🔍 Transactions` → `/transactions`.
- Clicking an Activity amount on the budget page opens `/transactions?category=<id>&month=YYYY-MM`.

## Driving it with drive.mjs

Preconditions:

- Baseline instance, signed in. The journey creates `Verify Search Acct <stamp>` (`300.00`) and an Out transaction `VERIFY GROCER <token>` of `12.34` through the UI first.

- **Open.** Go to `/transactions`. `node scripts/drive.mjs search`. Heading `Transactions` with a count.
- **Search.** Fill placeholder `Search payee, memo…` with `<token>` (digits only). Same journey. Header text starts `1 transaction`; screenshot `03-search-result`.
- **Result.** Row `Verify Grocer <token>` is visible; `Starting Balance` rows are filtered out.
- **Side effects.** Read-only page; `db-after.json` shows the one matching stored row (payee still upper-case).

## Gotchas

- The text filter also matches account names. Search for a token that appears only in the payee, or every row of a stamped account matches.
- An invalid `?month=` now returns 404 (`notFound()`), not an empty list.
- The list is capped at 500 rows server-side before the text filter runs.
