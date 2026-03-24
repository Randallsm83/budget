import { NextResponse } from 'next/server'
import { and, eq, isNotNull } from 'drizzle-orm'
import { auth } from '@/auth'
import { db } from '@/db'
import { accounts, importConnections, transactions } from '@/db/schema'

/**
 * POST /api/plaid/cleanup-orphans
 *
 * Finds accounts that have NO active Plaid connection AND zero transactions,
 * then deletes them. These are duplicate/orphaned accounts left behind from
 * reconnect cycles before the soft-disconnect fix.
 *
 * Returns { deleted: [{ id, name, type }] }
 */
export async function POST() {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const userId = session.user.id

  // Account IDs that have an active connection
  const activeConns = await db
    .select({ accountId: importConnections.accountId })
    .from(importConnections)
    .where(and(
      eq(importConnections.userId, userId),
      isNotNull(importConnections.accessTokenEncrypted),
    ))
  const activeAccountIds = activeConns
    .map((c) => c.accountId)
    .filter((id): id is string => id !== null)

  // Account IDs that have at least one transaction
  const withTxns = await db
    .selectDistinct({ accountId: transactions.accountId })
    .from(transactions)
    .where(eq(transactions.userId, userId))
  const accountIdsWithTxns = withTxns.map((r) => r.accountId)

  // Candidates: no active connection AND no transactions
  const candidateQuery = db
    .select({ id: accounts.id, name: accounts.name, type: accounts.type })
    .from(accounts)
    .where(eq(accounts.userId, userId))

  const allAccounts = await candidateQuery

  const orphans = allAccounts.filter((a) =>
    !activeAccountIds.includes(a.id) &&
    !accountIdsWithTxns.includes(a.id)
  )

  if (orphans.length === 0) {
    return NextResponse.json({ deleted: [], message: 'No orphaned accounts found' })
  }

  // Delete orphans (cascade removes any related data)
  const deleted: { id: string; name: string; type: string }[] = []
  for (const orphan of orphans) {
    await db.delete(accounts).where(and(eq(accounts.id, orphan.id), eq(accounts.userId, userId)))
    deleted.push(orphan)
  }

  return NextResponse.json({ deleted, message: `Deleted ${deleted.length} orphaned account(s)` })
}
