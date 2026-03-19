import { NextRequest, NextResponse } from 'next/server'
import { and, eq, sql } from 'drizzle-orm'
import type { Transaction as PlaidTransaction, RemovedTransaction } from 'plaid'
import { auth } from '@/auth'
import { plaidClient } from '@/lib/plaid'
import { decrypt } from '@/lib/crypto'
import { db } from '@/db'
import { accounts, importConnections, transactions, payeeRules, categories } from '@/db/schema'
import { normalizePayee } from '@/lib/payee'
import { getPlaidCategoryHints } from '@/lib/plaidCategories'

export async function POST(req: NextRequest) {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { accountId } = await req.json()

  const connection = await db.query.importConnections.findFirst({
    where: and(
      eq(importConnections.accountId, accountId),
      eq(importConnections.userId, session.user.id),
    ),
  })
  if (!connection?.accessTokenEncrypted) {
    return NextResponse.json({ error: 'No bank connection for this account' }, { status: 404 })
  }

  const accessToken = decrypt(connection.accessTokenEncrypted)

  const plaidAccountId = connection.plaidAccountId ?? undefined

  // Page through all available transaction updates, filtered to this account
  // Note: Plaid does an async historical pull in the background.  The first
  // sync typically returns only the last ~30 days.  Subsequent syncs (using
  // the saved cursor) will pick up the rest as Plaid completes the pull.
  const isFirstSync = !connection.cursor
  let cursor: string | undefined = connection.cursor ?? undefined
  let hasMore = true
  const added: PlaidTransaction[] = []
  const modified: PlaidTransaction[] = []
  const removed: RemovedTransaction[] = []

  try {
    while (hasMore) {
      const res = await plaidClient.transactionsSync({ access_token: accessToken, cursor })
      const filter = plaidAccountId
        ? (t: PlaidTransaction) => t.account_id === plaidAccountId
        : () => true
      added.push(...res.data.added.filter(filter))
      modified.push(...res.data.modified.filter(filter))
      removed.push(...res.data.removed)
      cursor = res.data.next_cursor
      hasMore = res.data.has_more
    }
  } catch (err: unknown) {
    const errData = (err as { response?: { data?: { error_code?: string } } })?.response?.data
    if (errData?.error_code === 'ITEM_LOGIN_REQUIRED') {
      // Persist the flag so the sidebar and account page immediately show the relink entry point
      if (connection.plaidItemId) {
        await db
          .update(importConnections)
          .set({ requiresRelink: true })
          .where(eq(importConnections.plaidItemId, connection.plaidItemId))
      }
      return NextResponse.json({ requiresRelink: true })
    }
    const msg = errData ? JSON.stringify(errData) : (err instanceof Error ? err.message : String(err))
    return NextResponse.json({ error: msg }, { status: 500 })
  }

  const userId = session.user.id

  // Load payee rules and user categories for auto-categorisation
  const [userRules, userCategories] = await Promise.all([
    db.query.payeeRules.findMany({ where: eq(payeeRules.userId, userId) }),
    db.select({ id: categories.id, name: categories.name })
      .from(categories)
      .where(eq(categories.userId, userId)),
  ])
  const ruleMap = new Map(userRules.map((r) => [r.payeeNormalized, r.categoryId]))

  /** Find a category by keyword hint against the user's category names. */
  function hintCategory(primary: string | null | undefined, detailed: string | null | undefined): string | null {
    if (!primary) return null
    const hints = getPlaidCategoryHints(primary, detailed ?? '')
    for (const hint of hints) {
      const match = userCategories.find((c) => c.name.toLowerCase().includes(hint))
      if (match) return match.id
    }
    return null
  }

  // Insert new transactions (skip duplicates by importId)
  if (added.length > 0) {
    await db
      .insert(transactions)
      .values(
        added.map((t) => {
          // Use merchant_name (cleaned, deduplicated) when available; it collapses
          // location variants like "STARBUCKS #1234 SEATTLE" to just "Starbucks",
          // making rules far more portable across stores.
          const storedPayee = t.merchant_name ?? t.name
          const key = storedPayee ? normalizePayee(storedPayee) : null
          const categoryId =
            (key ? ruleMap.get(key) : undefined)
            ?? hintCategory(
                t.personal_finance_category?.primary,
                t.personal_finance_category?.detailed,
              )
            ?? null
          const isTransfer = !!storedPayee && /^(online transfer|transfer (from|to|between)|ach transfer|wire transfer|book transfer)/i.test(storedPayee)
          return {
            userId,
            accountId,
            date: t.date,
            payee: storedPayee,
            categoryId: isTransfer ? null : categoryId,
            // Plaid: positive = outflow (debit), our schema: negative = outflow
            amount: -Math.round(t.amount * 1000),
            cleared: true,
            isTransfer,
            importId: t.transaction_id,
          }
        }),
      )
      .onConflictDoNothing()
  }

  // Update modified transactions
  // Prefer merchant_name (cleaned) over raw name, same convention as added
  for (const t of modified) {
    await db
      .update(transactions)
      .set({
        date: t.date,
        payee: t.merchant_name ?? t.name,
        amount: -Math.round(t.amount * 1000),
        cleared: true,
        updatedAt: new Date(),
      })
      .where(eq(transactions.importId, t.transaction_id))
  }

  // Delete removed transactions
  for (const t of removed) {
    await db.delete(transactions).where(eq(transactions.importId, t.transaction_id))
  }

  // Use Plaid's live account balance as the source of truth.
  // Recomputing from transaction sums is unreliable because Plaid's initial
  // historical pull is partial — recent payments can make the running sum
  // flip sign and produce a wrong result (e.g. credit card shows positive).
  try {
    const balRes = await plaidClient.accountsGet({ access_token: accessToken })
    const plaidAcc = plaidAccountId
      ? balRes.data.accounts.find((a) => a.account_id === plaidAccountId)
      : balRes.data.accounts[0]

    if (plaidAcc) {
      const current = plaidAcc.balances.current ?? 0
      // Credit + loan: Plaid positive = amount owed → negate for our convention (negative = debt)
      const isDebt = plaidAcc.type === 'credit' || plaidAcc.type === 'loan'
      const balanceMilliunits = isDebt ? -Math.round(current * 1000) : Math.round(current * 1000)
      await db
        .update(accounts)
        .set({ balance: balanceMilliunits, clearedBalance: balanceMilliunits, updatedAt: new Date() })
        .where(eq(accounts.id, accountId))
    }
  } catch {
    // If the balance call fails, fall back to recomputing from transactions
    const [{ txnCount }] = await db
      .select({ txnCount: sql<number>`count(*)` })
      .from(transactions)
      .where(eq(transactions.accountId, accountId))

    if (Number(txnCount) > 0) {
      const [{ total: balance }] = await db
        .select({ total: sql<number>`coalesce(sum(${transactions.amount}), 0)` })
        .from(transactions)
        .where(eq(transactions.accountId, accountId))

      const [{ total: clearedBalance }] = await db
        .select({ total: sql<number>`coalesce(sum(${transactions.amount}), 0)` })
        .from(transactions)
        .where(and(eq(transactions.accountId, accountId), eq(transactions.cleared, true)))

      await db
        .update(accounts)
        .set({ balance, clearedBalance, updatedAt: new Date() })
        .where(eq(accounts.id, accountId))
    }
  }

  // Clear requiresRelink for all accounts on this Item (the login is now working)
  if (connection.plaidItemId) {
    await db
      .update(importConnections)
      .set({ requiresRelink: false })
      .where(eq(importConnections.plaidItemId, connection.plaidItemId))
  }
  // Save new cursor and sync timestamp for this specific connection
  await db
    .update(importConnections)
    .set({ cursor, lastSyncedAt: new Date() })
    .where(eq(importConnections.id, connection.id))

  return NextResponse.json({
    success: true,
    added: added.length,
    modified: modified.length,
    removed: removed.length,
    // Hint to the client that Plaid’s background historical pull may still be
    // in progress — the user should sync again in a few minutes.
    firstSync: isFirstSync,
  })
}
