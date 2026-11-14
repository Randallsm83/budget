---
name: formal-verify-plaid-sync
description: Model-check (TLA+, TLC) that Plaid transaction sync keeps the account register equal to the bank, with no missing, extra or stale imported transaction once the stored cursor is caught up. Use before and after any change to src/lib/plaid-sync.ts, the Plaid sync, webhook, exchange-token, repair or clear-account-transactions routes, import_connections.cursor, transactions.import_id, or the database driver in src/db/index.ts.
---

# Formal verification: Plaid sync and its cursor

## What is checked

**The promise.** When no Sync, Repair or Clear request is running and the connection's stored cursor is Plaid's newest, the register holds exactly the bank's transactions for that account, each at the bank's current amount.

**The harm.** From that moment Plaid has nothing more to send about those transactions, so a missing, extra or stale one stays in the register for good, and category activity and Ready to Assign are wrong by its amount.

The check splits the promise into rules:

| Rule | Plain words |
| --- | --- |
| `NoMissing` | Every transaction the bank has is in the register. |
| `NoGhost` | The register holds no imported transaction that the bank does not have. |
| `NoStale` | Every imported transaction shows the bank's current amount. |
| `NoRejectedInsert` | The insert of new transactions never fails on a duplicate `import_id`. A failed insert stops the sync before it saves the cursor, so every later sync fails at the same row. |

**The tool** is a TLA+ model checked by TLC 1.7.4. The question is whether the statements of separate requests, or of one request that dies partway, can happen in an order that breaks the promise. A model checker tries every order. No test in `src/lib/__tests__/` runs `syncTransactions`, and no verifier for TypeScript explores the orders of database statements.

## Does your change touch the verified code

Each action of `model/PlaidSync.tla` is one database statement or one Plaid call in these places. Line numbers are those of the sync commit.

| Model action | Code |
| --- | --- |
| `RequestArrives`, `ReadConnectionRow` (a sync) | The caller reads the `import_connections` row and passes it on: `src/app/api/plaid/sync/route.ts` 16-21 and 85, `src/app/api/plaid/webhook/route.ts` 103-108, `src/app/api/plaid/exchange-token/route.ts` 100-107. `syncTransactions` starts from the cursor in that object: `src/lib/plaid-sync.ts` 56-57. |
| `FetchFromPlaid` | `src/lib/plaid-sync.ts` 65-76, the `transactionsSync` loop. On a Plaid error, lines 77-89 return without writing transactions or the cursor. |
| `InsertAdded` | `src/lib/plaid-sync.ts` 109-134: one `db.insert(transactions)` with `.onConflictDoNothing()`. The unique key is `transactions.import_id`, `src/db/schema.ts` 123. |
| `UpdateModified` | `src/lib/plaid-sync.ts` 136-140: one `db.update(transactions)` for each modified transaction. |
| `DeleteRemoved` | `src/lib/plaid-sync.ts` 142-144: one `db.delete(transactions)` for each removed transaction. |
| `SaveCursor` | `src/lib/plaid-sync.ts` 167. The column is `import_connections.cursor`, `src/db/schema.ts` 161. |
| `ReadConnectionRow`, `WipeImported`, `ResetCursor`, then the sync actions (Repair) | `src/app/api/plaid/repair/route.ts` 35-37, 54-59, 62-67, 79-83. |
| `WipeImported` (Clear) | `src/app/api/plaid/clear-account-transactions/route.ts` 40-42. |
| `RequestDies` | Any point between two statements of the above. |
| Other requests can run between any two actions | `src/db/index.ts` 2 and 18: the Neon HTTP driver sends each statement as its own request, and no covered code opens a transaction. |

Sync commit: `f41c09cdb53e05b184865c86d98486ff9d49e219`

The sync commit is the last commit at which someone confirmed that the model describes the code above. Move it forward only after you have read every change to the covered files since that commit and confirmed that each model action still matches its code. A passing run is not that confirmation.

Your change touches the verified code if it edits a file in the table, adds a caller of `syncTransactions`, adds a writer of `import_connections.cursor`, or adds code that inserts, updates or deletes `transactions` rows that have an `import_id`. `check.sh` lists the covered files that differ from the sync commit, and it stops if the statement order or the set of callers and cursor writers is not the recorded one.

## Run

```sh
.omp/skills/formal-verify-plaid-sync/check.sh
```

It takes about 15 seconds. It reads only `src/`, and it writes only to a new folder for each run under `${XDG_STATE_HOME:-$HOME/.local/state}/verify-budget/formal-plaid-sync/`. The last line of the output names that folder.

It needs two things:

- `~/.cache/tlaplus/tla2tools-1.7.4.jar` with sha256 `936a262061c914694dfd669a543be24573c45d5aa0ff20a8b96b23d01e050e88`. The script checks the hash. If the file is absent, fetch `tla2tools.jar` from the tlaplus v1.7.4 GitHub release: `mkdir -p ~/.cache/tlaplus && curl -fsSL -o ~/.cache/tlaplus/tla2tools-1.7.4.jar https://github.com/tlaplus/tlaplus/releases/download/v1.7.4/tla2tools.jar`. Set `TLA_JAR` to use a copy in another place.
- Java, which the script takes from `mise where java@temurin-21.0.13+9.0.LTS`. Install it with `mise install java@temurin-21.0.13+9.0.LTS`, or set `JAVA_BIN` to a Java 11 or later binary. In a non-interactive agent shell where `mise` is not on `PATH`, put `source ~/.config/zsh/agent-env.zsh &&` before the command.

What the script does:

1. It reads the order of the statements from the source files and writes it to `CodeShape.tla` in the run folder. The model runs the statements in that order. So a reordered, removed or changed statement in `src/` changes what TLC checks, with no edit to the model.
2. It runs TLC once for each line of `expected.tsv`: one scenario and one rule.
3. It compares each result with `expected.tsv`.

| Exit | Meaning |
| --- | --- |
| 0 | Every result is as recorded. The known findings below still stand. |
| 1 | A result changed. Either a rule that held now breaks, or a known finding no longer shows. |
| 2 | The check could not run: a tool is missing, TLC stopped on an error, or the code map stopped. |
| 3 | Every result is as recorded, but the statement order, or the set of callers and cursor writers, is not the recorded one. |

## Read the result

Each output line is a scenario, a rule, the recorded result and the result of this run. `violated` on a line with an `F` number is a known finding. A line that ends in `<--` changed.

Read every result with the pstack `/statechart` skill, a violation and a pass alike. For a violation, give it `PlaidSync.tla`, `CodeShape.tla` and the `.cfg` file from the folder of that line under the run folder. It gives the shortest path to the broken rule, one model action for each step. For a pass, the scenarios are too large to draw whole, so give it `model/PlaidSync.tla`, `model/CodeShape.tla` and `model/Chart.cfg`, the smallest scenario: it draws how one sync moves between states. The comments on `VARIABLES` in `model/PlaidSync.tla` say what each value in a path means, and the table above says which statement each action is. `tlc.log` in the folder of each line holds TLC's own trace.

When a rule that held now breaks, decide whether the code or the model is wrong:

1. Replay the path against the code, one model action for each statement, with the table above. Name the file and line of every step.
2. If a step cannot happen in the code, the model is wrong. Typical causes: two statements now run in one transaction or one `db.batch`, a new lock or lease keeps two syncs apart, or the code map matched the wrong line. Fix the model as "Update the verification" says, and do not touch the rule.
3. If every step can happen, it is a bug in the code. Report it as the steps in the code's words and the harm. Do not weaken a rule, shrink a bound, or edit `expected.tsv` to make the line pass.

A replay can also be a throwaway test that runs the real route files against a fake `@/db` and a fake `@/lib/plaid`. Keep such a test outside the repo: `npm test` runs every `*.test.ts` it finds, also under `.omp/`.

When a known finding no longer shows, the change may have fixed it. Confirm that with the same replay: find the step of the finding's path that the new code makes impossible. Then record the fix as "Update the verification" says.

## Known findings at the sync commit

These five lines are `violated` in `expected.tsv`. Each is a bug in the code, not in the model. F1 and F2 were replayed at the sync commit by running the real route files and the real `syncTransactions` against a fake database and a fake Plaid client. F3, F4 and F5 were replayed by reading the code. None was run against a live database or Plaid.

- **F1, Repair / NoMissing: Repair deletes the imported history and does not fetch it again.** `repair/route.ts` reads the connection rows at line 35, deletes every imported transaction at 54-59, and sets the stored cursor to null at 62-67. At line 81 it calls `syncTransactions(c)` with the row object it read at line 35, which still holds the old cursor. `syncTransactions` starts from that cursor (`plaid-sync.ts` 57), Plaid returns only what changed since, and line 167 stores the newest cursor. The register has lost every imported transaction that the old cursor already covered, and no later sync brings them back. Their categories are lost too, because the map built at lines 40-51 lives only in that request.
- **F2, Clear / NoMissing: after Clear, Sync does not import the deleted transactions again.** `clear-account-transactions/route.ts` deletes the account's imported transactions at lines 40-42 and never writes the cursor. The UI then says "press Sync to re-import" (`src/components/AccountRegister.tsx` 756). The sync route reads the stored cursor, which did not change, so Plaid returns only what changed since the last sync. The route also builds a category map at lines 34-37 and does not store it.
- **F3, Overlap / NoGhost: two overlapping syncs bring back a removed transaction.** Sync A and sync B both read the connection row with the same cursor. A fetches and gets transaction T as added. The bank drops T, for example a pending charge. B fetches and gets T as removed, and its delete finds no row. A inserts T. A saves its cursor, then B saves the newer one. The cursor is now Plaid's newest and T is in the register.
- **F4, Overlap / NoStale: two overlapping syncs keep an old amount.** A and B both read the same cursor. A fetches T at the first amount. The bank changes the amount. B fetches T at the new amount. A inserts T. B's insert meets the conflict and does nothing. A saves its cursor, then B saves the newer one. T keeps the first amount. The same happens with no insert at all: T is already in the register, both syncs get T as modified, B's update writes the newest amount, A's update then writes the older one, and B saves its cursor last. For that reason an insert that updates on conflict does not repair F4, and `check.sh --self-test` shows that the rule still breaks with it.
- **F5, Crash / NoStale: a retried sync keeps the old amount.** A sync inserts T and dies before line 167, for example on a function timeout or a failed database request in one of the loops. The bank changes T's amount. The next sync starts from the old cursor, so Plaid lists T as added with the new amount. `.onConflictDoNothing()` keeps the old row, and line 167 saves the newest cursor.

Two syncs overlap whenever a `SYNC_UPDATES_AVAILABLE` webhook arrives while another webhook delivery, a pressed Sync, or the auto-sync in `exchange-token/route.ts` has read the connection row and has not yet saved the cursor at line 167. Nothing in the code keeps them apart.

`check.sh --self-test` shows what repairs F1, F2 and F5 in the model: read the connection rows after the reset, reset the cursor in Clear, and update on conflict. For F3 and F4 the model passes only when one sync of a connection runs at a time, which is the `Serial` scenario.

## Scenarios, bounds and assumptions

| Scenario | What may happen |
| --- | --- |
| `Serial` | Up to 4 syncs, one at a time. None dies. |
| `Crash` | Up to 4 syncs, one at a time. Any of them may die between two statements. |
| `Overlap` | Up to 3 syncs, 2 of them at the same time. None dies. |
| `Repair` | Up to 3 requests, each a sync or a Repair, one at a time. None dies. |
| `Clear` | Up to 4 requests, each a sync or a Clear, one at a time. None dies. |

Every scenario has one connection, 2 transactions, up to 3 amounts for a transaction, and up to 4 bank changes: add a transaction, change its amount, or remove it. A pass covers these bounds and nothing larger.

The model assumes:

- **Plaid condenses.** A transaction that the cursor has not seen appears in `added` with its newest data, and never in `modified` as well. Plaid Academy's Transactions tutorial says that Plaid condenses the changes since the cursor. F5 and the first path of F4 rest on this. F1, F2, F3 and the second path of F4 do not.
- **Plaid lists a removal even when the cursor never saw the transaction** (`EchoRemovals = TRUE` in each `.cfg`). This is the kinder choice for the code. With `FALSE`, `Crash / NoGhost` breaks as well.
- **The `transactionsSync` loop sees one state of the bank.** Plaid fails the call with `TRANSACTIONS_SYNC_MUTATION_DURING_PAGINATION` when its data moves between pages, and the code then writes nothing.
- **Plaid never uses a transaction id again** after it removes the transaction.
- **Each statement commits on its own.** This holds for the Neon HTTP driver as long as the code opens no transaction and uses no `db.batch`.

The check does not cover:

- Whether the model's statement order is the code's when the code map cannot see the change. The map finds statements by their text. It does not see a changed `where` clause or a changed filter.
- The account filter at `plaid-sync.ts` 68-72, and two connections of one Plaid Item, each with its own cursor.
- What happens to the category, the transfer flag, and a row that the user edited or deleted by hand.
- The balance update at `plaid-sync.ts` 146-162 and the `requiresRelink` flag.
- Repair or Clear that overlaps a sync, and a Repair or Clear that dies partway.
- The cursor resets without a delete in `exchange-token/route.ts` 83, `create-accounts/route.ts` 68 and `src/lib/actions.ts` 662, and what a new Plaid Item does to the ids of old rows.
- Whether a sync ever finishes. The rules say what is true once the cursor is caught up, not that it gets there.
- Investments and liabilities sync, and CSV import.

## Update the verification

Do this when a change to the covered code is intended, and when the code map changed (exit 3).

1. Read every change to the covered files since the sync commit: `git diff f41c09cdb53e05b184865c86d98486ff9d49e219 -- src/lib/plaid-sync.ts src/app/api/plaid src/db/index.ts src/db/schema.ts`. The notice at the top of the `check.sh` output lists the files that differ.
2. Make the model describe the new code. Start from the code, not from the result you want.
   - A statement moved, or the conflict clause changed: nothing to edit. `check.sh` already runs the new order. Copy the run folder's `CodeShape.tla` over `model/CodeShape.tla` once you agree that it says what the code does.
   - A statement was added, split, or put in a transaction with others: edit `model/PlaidSync.tla`. One indivisible step in the code is one action in the model. Statements that commit together become one action. Add the step name to `Program`, and teach `read_code` in `check.sh` to find its line.
   - A new caller of `syncTransactions` or a new cursor writer: decide which request it is in the model, or add a request kind and a scenario for it. Then add the file to `known_touching` and `covered` in `check.sh` and to the table above.
3. Change a rule only when the code's promise changed on purpose, and write down the evidence: the doc comment, the test, or the commit message.
4. Run `check.sh`. For each changed line, follow "Read the result". Then set that line in `expected.tsv` to what the code now gives, and update "Known findings".
5. Run `check.sh --self-test`. It runs the model on broken statement orders and expects each rule to break, and on repaired orders and expects a pass. If it fails, the model can no longer tell a broken order from a working one. Fix the model before you trust any pass. When you add a rule or a step, add a broken order for it to the table in `self_test`.
6. Update the line numbers in the table above. Set the sync commit to the commit you checked, in the `Sync commit:` line and in the command of step 1.

### When the code map stops

`check.sh` exits 2 with `code map: want exactly one ...` when it cannot find a statement by its text, or finds it twice. The code changed shape: the statement was removed, duplicated, renamed, or moved into another function. Open the function it names. If the statement is still there in another form, fix its search text in `read_code`. If the shape changed, follow step 2 above.

For drift from merges and edits that did not use this skill, use the pstack `/maintain-formal-verification-skill` skill.
