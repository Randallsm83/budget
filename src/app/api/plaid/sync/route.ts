import { NextRequest, NextResponse } from 'next/server'
import { and, eq, sql } from 'drizzle-orm'
import type { Transaction as PlaidTransaction, RemovedTransaction } from 'plaid'
import { auth } from '@/auth'
import { plaidClient } from '@/lib/plaid'
import { decrypt } from '@/lib/crypto'
import { db } from '@/db'
import { accounts, importConnections, transactions, payeeRules } from '@/db/schema'
import { normalizePayee } from '@/lib/payee'

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
  let cursor: string | undefined = connection.cursor ?? undefined
  let hasMore = true
  let added: PlaidTransaction[] = []
  const modified: PlaidTransaction[] = []
  const removed: RemovedTransaction[] = []

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

  // Plaid sandbox can return 0 on first sync — fall back to transactionsGet
  if (added.length === 0 && !connection.cursor && plaidAccountId) {
    const today = new Date().toISOString().split('T')[0]
    try {
      const fallback = await plaidClient.transactionsGet({
        access_token: accessToken,
        start_date: '2020-01-01',
        end_date: today,
        options: { account_ids: [plaidAccountId] },
      })
      added = fallback.data.transactions
    } catch { /* ignore — fallback best-effort */ }
  }

  const userId = session.user.id

  // Load user's payee → category rules for auto-categorisation
  const userRules = await db.query.payeeRules.findMany({
    where: eq(payeeRules.userId, userId),
  })
  const ruleMap = new Map(userRules.map((r) => [r.payeeNormalized, r.categoryId]))

  // Insert new transactions (skip duplicates by importId)
  if (added.length > 0) {
    await db
      .insert(transactions)
      .values(
        added.map((t) => {
          const key = t.name ? normalizePayee(t.name) : null
          const categoryId = key ? (ruleMap.get(key) ?? null) : null
          return {
            userId,
            accountId,
            date: t.date,
            payee: t.name,
            categoryId,
            // Plaid: positive = outflow (debit), our schema: negative = outflow
            amount: -Math.round(t.amount * 1000),
            cleared: true,
            importId: t.transaction_id,
          }
        }),
      )
      .onConflictDoNothing()
  }

  // Update modified transactions
  for (const t of modified) {
    await db
      .update(transactions)
      .set({
        date: t.date,
        payee: t.name,
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

  // Recalculate account balance from all transactions, but only if we
  // actually have transactions — don't zero-out a Plaid-imported balance
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

  // Save new cursor and sync timestamp
  await db
    .update(importConnections)
    .set({ cursor, lastSyncedAt: new Date() })
    .where(eq(importConnections.id, connection.id))

  return NextResponse.json({ success: true, added: added.length, modified: modified.length, removed: removed.length })
}
