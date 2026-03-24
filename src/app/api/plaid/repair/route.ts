import { NextRequest, NextResponse } from 'next/server'
import { and, eq, isNotNull, inArray } from 'drizzle-orm'
import { auth } from '@/auth'
import { db } from '@/db'
import { importConnections, transactions } from '@/db/schema'
import { syncTransactions } from '@/lib/plaid-sync'
import { plaidLog } from '@/lib/plaid-logger'

/**
 * POST /api/plaid/repair
 * { accountId: string }
 *
 * Finds the Plaid Item for the given account, wipes ALL Plaid-imported
 * transactions (have importId) from every account on that Item, clears
 * sync cursors, and re-syncs from scratch so each account gets only its
 * own transactions.
 *
 * Manual transactions (no importId) are never touched.
 */
export async function POST(req: NextRequest) {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const userId = session.user.id

  const { accountId } = await req.json() as { accountId: string }

  // Find the connection for the given account
  const conn = await db.query.importConnections.findFirst({
    where: and(eq(importConnections.accountId, accountId), eq(importConnections.userId, userId)),
  })
  if (!conn?.accessTokenEncrypted) {
    return NextResponse.json({ error: 'No active bank connection for this account' }, { status: 404 })
  }

  // Find all connections sharing the same Plaid Item (all accounts at this bank)
  const itemConns = conn.plaidItemId
    ? await db.query.importConnections.findMany({
        where: and(eq(importConnections.plaidItemId, conn.plaidItemId), eq(importConnections.userId, userId)),
      })
    : [conn]

  // Also include soft-disconnected connections (null token) for same institution
  // They may have received bad transactions too
  const allConns = itemConns

  const affectedAccountIds = allConns
    .map((c) => c.accountId)
    .filter((id): id is string => id !== null)

  // Save importId → categoryId before deleting so we can restore user's categorizations
  const categoryByImportId = new Map<string, string>()
  for (const acctId of affectedAccountIds) {
    const rows = await db
      .select({ importId: transactions.importId, categoryId: transactions.categoryId })
      .from(transactions)
      .where(and(eq(transactions.accountId, acctId), isNotNull(transactions.importId)))
    for (const row of rows) {
      if (row.importId && row.categoryId) {
        categoryByImportId.set(row.importId, row.categoryId)
      }
    }
  }

  let deletedTotal = 0
  for (const acctId of affectedAccountIds) {
    const result = await db
      .delete(transactions)
      .where(and(eq(transactions.accountId, acctId), isNotNull(transactions.importId)))
    deletedTotal += (result as unknown as { rowCount?: number }).rowCount ?? 0
  }

  // Clear cursors so next sync fetches full history
  for (const c of allConns) {
    await db
      .update(importConnections)
      .set({ cursor: null, lastSyncedAt: null })
      .where(eq(importConnections.id, c.id))
  }

  plaidLog('info', {
    route: 'plaid/repair',
    userId,
    plaidItemId: conn.plaidItemId ?? undefined,
    affectedAccounts: affectedAccountIds.length,
    deletedTransactions: deletedTotal,
  })

  // Re-sync all active connections on this Item
  const syncResults: Record<string, unknown> = {}
  for (const c of allConns) {
    if (!c.accessTokenEncrypted || !c.accountId) continue
    const result = await syncTransactions(c)
    syncResults[c.accountId] = result
  }

  // Restore saved category assignments by importId
  let restoredCategories = 0
  if (categoryByImportId.size > 0) {
    const importIds = [...categoryByImportId.keys()]
    const reinserted = await db
      .select({ id: transactions.id, importId: transactions.importId })
      .from(transactions)
      .where(inArray(transactions.importId, importIds))
    for (const txn of reinserted) {
      if (!txn.importId) continue
      const savedCategoryId = categoryByImportId.get(txn.importId)
      if (savedCategoryId) {
        await db
          .update(transactions)
          .set({ categoryId: savedCategoryId })
          .where(eq(transactions.id, txn.id))
        restoredCategories++
      }
    }
  }

  return NextResponse.json({
    success: true,
    affectedAccounts: affectedAccountIds.length,
    deletedTransactions: deletedTotal,
    restoredCategories,
    syncResults,
  })
}
