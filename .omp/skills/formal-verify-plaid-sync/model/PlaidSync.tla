----------------------------- MODULE PlaidSync -----------------------------
(* How Plaid transactions reach the account register, and how the stored    *)
(* cursor keeps track of what has been applied.                             *)
(*                                                                          *)
(* Every action is one database statement or one Plaid call in the code.    *)
(* The app uses the Neon HTTP driver (src/db/index.ts): each statement is   *)
(* its own request and commits on its own, and syncTransactions opens no    *)
(* transaction. So other requests can run between any two actions here.     *)
(*                                                                          *)
(* The order of the statements comes from module CodeShape, which check.sh  *)
(* derives from the source files on every run.                              *)
EXTENDS Naturals, Sequences, FiniteSets, TLC, CodeShape

CONSTANTS
  Txns,         \* Plaid transaction_id values (transactions.import_id)
  MaxVer,       \* how many amounts one transaction can have over its life
  MaxHist,      \* bank changes explored = MaxHist - 1
  MaxOps,       \* requests explored (sync, repair, clear)
  MaxInFlight,  \* how many requests may run at the same time
  Kinds,        \* which requests may arrive: subset of {"sync", "repair", "clear"}
  Crashes,      \* TRUE: a request may die between two statements
  EchoRemovals  \* TRUE: Plaid lists a removal even if the cursor never saw the add

VARIABLES
  hist,     \* Plaid's side: hist[i] is the bank's transactions after update i
  reg,      \* transactions rows with an import_id: reg[t] = amount version, 0 = no row
  cursor,   \* import_connections.cursor, as an index into hist
  kind,     \* kind[o]: what request o is
  pc,       \* pc[o]: next statement of request o; 0 = not arrived
  cur,      \* cur[o]: the cursor in the connection row object that request o holds
  nxt,      \* nxt[o]: next_cursor from request o's transactionsSync call
  modLeft,  \* modLeft[o]: `modified` entries the UPDATE loop has not written yet
  delLeft,  \* delLeft[o]: `removed` entries the DELETE loop has not written yet
  rejected  \* TRUE once an INSERT failed on a duplicate import_id

vars == <<hist, reg, cursor, kind, pc, cur, nxt, modLeft, delLeft, rejected>>

\* A transaction at the bank: 0 = does not exist yet, 1..MaxVer = exists with
\* that amount version, Removed = the bank dropped it. Plaid never reuses an id.
Removed == MaxVer + 1
Present(v) == v \in 1..MaxVer

\* importConnections.cursor IS NULL: "send everything from the start".
Base == 1

Ops == 1..MaxOps
Latest == Len(hist)
Bank == hist[Latest]

\* repair/route.ts calls syncTransactions(c) in the middle of its own statements.
RECURSIVE Expand(_)
Expand(s) ==
  IF s = <<>> THEN <<>>
  ELSE (IF Head(s) = "sync" THEN <<"fetch">> \o ApplySteps ELSE <<Head(s)>>)
       \o Expand(Tail(s))

\* The statements of each request, in the order the code runs them.
\*   sync:   sync/route.ts, webhook/route.ts and exchange-token/route.ts read the
\*           connection row ("load"), then call syncTransactions (plaid-sync.ts).
\*   repair: repair/route.ts.
\*   clear:  clear-account-transactions/route.ts.
Program(k) ==
  CASE k = "sync"   -> <<"load", "fetch">> \o ApplySteps
    [] k = "repair" -> Expand(RepairSteps)
    [] k = "clear"  -> ClearSteps

End(o) == Len(Program(kind[o])) + 1
InFlight(o) == pc[o] > 0 /\ pc[o] < End(o)
At(o, step) == InFlight(o) /\ Program(kind[o])[pc[o]] = step
Quiet == \A o \in Ops : ~InFlight(o)

Advance(o) == pc' = [pc EXCEPT ![o] = @ + 1]

Init ==
  /\ hist = << [t \in Txns |-> 0] >>
  /\ reg = [t \in Txns |-> 0]
  /\ cursor = Base
  /\ kind = [o \in Ops |-> "sync"]
  /\ pc = [o \in Ops |-> 0]
  /\ cur = [o \in Ops |-> Base]
  /\ nxt = [o \in Ops |-> Base]
  /\ modLeft = [o \in Ops |-> {}]
  /\ delLeft = [o \in Ops |-> {}]
  /\ rejected = FALSE

---------------------------------------------------------------------------
(* The bank.                                                                *)

BankChange(t, v) ==
  /\ Len(hist) < MaxHist
  /\ hist' = Append(hist, [Bank EXCEPT ![t] = v])
  /\ UNCHANGED <<reg, cursor, kind, pc, cur, nxt, modLeft, delLeft, rejected>>

BankAddsTransaction ==
  \E t \in Txns : Bank[t] = 0 /\ BankChange(t, 1)

BankChangesAmount ==
  \E t \in Txns : Bank[t] \in 1..(MaxVer - 1) /\ BankChange(t, Bank[t] + 1)

\* For example a pending charge that the bank drops when it posts under a new id.
BankRemovesTransaction ==
  \E t \in Txns : Present(Bank[t]) /\ BankChange(t, Removed)

---------------------------------------------------------------------------
(* The requests.                                                            *)

\* A request arrives: the user presses Sync, Repair or Clear, or Plaid
\* delivers SYNC_UPDATES_AVAILABLE. Requests take ids in order of arrival.
RequestArrives ==
  \E o \in Ops, k \in Kinds :
    /\ pc[o] = 0
    /\ \A p \in 1..(o - 1) : pc[p] > 0
    /\ Cardinality({p \in Ops : InFlight(p)}) < MaxInFlight
    /\ kind' = [kind EXCEPT ![o] = k]
    /\ pc' = [pc EXCEPT ![o] = 1]
    /\ UNCHANGED <<hist, reg, cursor, cur, nxt, modLeft, delLeft, rejected>>

\* The caller reads the import_connections row. syncTransactions later takes
\* its starting cursor from this object (plaid-sync.ts: connection.cursor).
ReadConnectionRow ==
  \E o \in Ops :
    /\ At(o, "load")
    /\ cur' = [cur EXCEPT ![o] = cursor]
    /\ Advance(o)
    /\ UNCHANGED <<hist, reg, cursor, kind, nxt, modLeft, delLeft, rejected>>

\* The transactionsSync loop. One step, because Plaid fails the call with
\* TRANSACTIONS_SYNC_MUTATION_DURING_PAGINATION if its data moves between pages,
\* and the code then returns { error } without writing anything.
\* Plaid condenses: each transaction appears in one list, with its newest data.
FetchFromPlaid ==
  \E o \in Ops :
    /\ At(o, "fetch")
    /\ LET old == hist[cur[o]]
           new == Bank
       IN /\ nxt' = [nxt EXCEPT ![o] = Latest]
          /\ modLeft' = [modLeft EXCEPT ![o] =
               {t \in Txns : Present(old[t]) /\ Present(new[t]) /\ old[t] # new[t]}]
          /\ delLeft' = [delLeft EXCEPT ![o] =
               {t \in Txns : /\ new[t] = Removed
                             /\ Present(old[t]) \/ (EchoRemovals /\ old[t] = 0)}]
    /\ Advance(o)
    /\ UNCHANGED <<hist, reg, cursor, kind, cur, rejected>>

\* db.insert(transactions).values(added...) with its conflict clause: one statement.
InsertAdded ==
  \E o \in Ops :
    /\ At(o, "insert")
    /\ LET old == hist[cur[o]]
           new == hist[nxt[o]]
           added == {t \in Txns : ~Present(old[t]) /\ Present(new[t])}
           clash == {t \in added : reg[t] # 0}
       IN IF clash # {} /\ OnConflict = "error"
          THEN \* no conflict clause: the duplicate import_id fails the statement and the request
               /\ pc' = [pc EXCEPT ![o] = End(o)]
               /\ rejected' = TRUE
               /\ UNCHANGED reg
          ELSE /\ reg' = [t \in Txns |->
                    IF t \in added /\ (reg[t] = 0 \/ OnConflict = "update")
                    THEN new[t] ELSE reg[t]]
               /\ Advance(o)
               /\ UNCHANGED rejected
    /\ UNCHANGED <<hist, cursor, kind, cur, nxt, modLeft, delLeft>>

\* for (const t of modified) db.update(transactions)...: one statement per row.
UpdateModified ==
  \E o \in Ops :
    /\ At(o, "update")
    /\ IF modLeft[o] = {}
       THEN Advance(o) /\ UNCHANGED <<reg, modLeft>>
       ELSE \E t \in modLeft[o] :
              /\ reg' = [reg EXCEPT ![t] = IF @ # 0 THEN hist[nxt[o]][t] ELSE 0]
              /\ modLeft' = [modLeft EXCEPT ![o] = @ \ {t}]
              /\ UNCHANGED pc
    /\ UNCHANGED <<hist, cursor, kind, cur, nxt, delLeft, rejected>>

\* for (const t of removed) db.delete(transactions)...: one statement per row.
DeleteRemoved ==
  \E o \in Ops :
    /\ At(o, "delete")
    /\ IF delLeft[o] = {}
       THEN Advance(o) /\ UNCHANGED <<reg, delLeft>>
       ELSE \E t \in delLeft[o] :
              /\ reg' = [reg EXCEPT ![t] = 0]
              /\ delLeft' = [delLeft EXCEPT ![o] = @ \ {t}]
              /\ UNCHANGED pc
    /\ UNCHANGED <<hist, cursor, kind, cur, nxt, modLeft, rejected>>

\* db.update(importConnections).set({ cursor, lastSyncedAt }).
SaveCursor ==
  \E o \in Ops :
    /\ At(o, "cursor")
    /\ cursor' = nxt[o]
    /\ Advance(o)
    /\ UNCHANGED <<hist, reg, kind, cur, nxt, modLeft, delLeft, rejected>>

\* Repair and Clear delete every row that has an import_id.
WipeImported ==
  \E o \in Ops :
    /\ At(o, "wipe")
    /\ reg' = [t \in Txns |-> 0]
    /\ Advance(o)
    /\ UNCHANGED <<hist, cursor, kind, cur, nxt, modLeft, delLeft, rejected>>

\* db.update(importConnections).set({ cursor: null, ... }).
ResetCursor ==
  \E o \in Ops :
    /\ At(o, "reset")
    /\ cursor' = Base
    /\ Advance(o)
    /\ UNCHANGED <<hist, reg, kind, cur, nxt, modLeft, delLeft, rejected>>

\* The request dies between two statements: a function timeout, a failed
\* database request, a thrown Plaid error. What it already wrote stays.
RequestDies ==
  /\ Crashes
  /\ \E o \in Ops :
       /\ InFlight(o)
       /\ pc' = [pc EXCEPT ![o] = End(o)]
       /\ UNCHANGED <<hist, reg, cursor, kind, cur, nxt, modLeft, delLeft, rejected>>

\* Keeps the end states from counting as deadlocks.
NothingRunning == Quiet /\ UNCHANGED vars

Next ==
  \/ BankAddsTransaction
  \/ BankChangesAmount
  \/ BankRemovesTransaction
  \/ RequestArrives
  \/ ReadConnectionRow
  \/ FetchFromPlaid
  \/ InsertAdded
  \/ UpdateModified
  \/ DeleteRemoved
  \/ SaveCursor
  \/ WipeImported
  \/ ResetCursor
  \/ RequestDies
  \/ NothingRunning

Spec == Init /\ [][Next]_vars

---------------------------------------------------------------------------
(* The rules. The first three speak about one moment: no request is running *)
(* and the stored cursor is Plaid's newest. From then on Plaid has nothing  *)
(* more to send, so whatever is wrong in the register stays wrong.          *)

CaughtUp == Quiet /\ cursor = Latest

\* Every transaction the bank has is in the register.
NoMissing == CaughtUp => \A t \in Txns : Present(Bank[t]) => reg[t] # 0

\* The register holds no imported transaction that the bank does not have.
NoGhost == CaughtUp => \A t \in Txns : ~Present(Bank[t]) => reg[t] = 0

\* Every imported transaction shows the bank's current amount.
NoStale == CaughtUp => \A t \in Txns : reg[t] # 0 /\ Present(Bank[t]) => reg[t] = Bank[t]

\* The INSERT never fails on a duplicate import_id. A failed insert stops the
\* sync before it saves the cursor, so the next sync fails at the same row.
NoRejectedInsert == ~rejected

TypeOK ==
  /\ Len(hist) \in 1..MaxHist
  /\ reg \in [Txns -> 0..MaxVer]
  /\ cursor \in 1..Len(hist)
  /\ kind \in [Ops -> {"sync", "repair", "clear"}]
  /\ \A o \in Ops : cur[o] \in 1..Len(hist) /\ nxt[o] \in 1..Len(hist)
  /\ rejected \in BOOLEAN

TxnSymmetry == Permutations(Txns)
=============================================================================
