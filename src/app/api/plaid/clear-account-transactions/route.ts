import { NextRequest, NextResponse } from 'next/server'
import { and, eq, isNotNull } from 'drizzle-orm'
import { auth } from '@/auth'
import { db } from '@/db'
import { accounts, transactions } from '@/db/schema'

/**
 * POST /api/plaid/clear-account-transactions
 * { accountId: string }
 *
 * Deletes all Plaid-imported transactions (importId set) from ONE account.
 * Saves importId→categoryId so categories are restored on next sync.
 * Manual transactions (no importId) are never touched.
 * Does NOT re-sync — user presses Sync manually after.
 */
export async function POST(req: NextRequest) {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const userId = session.user.id

  const { accountId } = await req.json() as { accountId: string }

  const account = await db.query.accounts.findFirst({
    where: and(eq(accounts.id, accountId), eq(accounts.userId, userId)),
  })
  if (!account) return NextResponse.json({ error: 'Account not found' }, { status: 404 })

  // Save importId → categoryId so next sync can restore categories
  const rows = await db
    .select({ importId: transactions.importId, categoryId: transactions.categoryId })
    .from(transactions)
    .where(and(eq(transactions.accountId, accountId), isNotNull(transactions.importId)))

  const categoryMap: Record<string, string> = {}
  for (const row of rows) {
    if (row.importId && row.categoryId) categoryMap[row.importId] = row.categoryId
  }

  // Delete the Plaid-imported transactions
  await db
    .delete(transactions)
    .where(and(eq(transactions.accountId, accountId), isNotNull(transactions.importId)))

  return NextResponse.json({
    success: true,
    deleted: rows.length,
    savedCategories: Object.keys(categoryMap).length,
  })
}
