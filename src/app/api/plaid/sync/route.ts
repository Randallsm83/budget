import { NextRequest, NextResponse } from 'next/server'
import { and, eq } from 'drizzle-orm'
import { auth } from '@/auth'
import { db } from '@/db'
import { accounts, importConnections } from '@/db/schema'
import { plaidClient } from '@/lib/plaid'
import { decrypt } from '@/lib/crypto'
import { syncTransactions } from '@/lib/plaid-sync'

export async function POST(req: NextRequest) {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { accountId } = await req.json()

  let connection = await db.query.importConnections.findFirst({
    where: and(
      eq(importConnections.accountId, accountId),
      eq(importConnections.userId, session.user.id),
    ),
  })
  if (!connection?.accessTokenEncrypted) {
    return NextResponse.json({ error: 'No bank connection for this account' }, { status: 404 })
  }

  // Auto-heal: if plaidAccountId is missing, look it up from Plaid and save it
  if (!connection.plaidAccountId) {
    try {
      const account = await db.query.accounts.findFirst({
        where: and(eq(accounts.id, accountId), eq(accounts.userId, session.user.id)),
      })
      const accessToken = decrypt(connection.accessTokenEncrypted)
      const res = await plaidClient.accountsGet({ access_token: accessToken })
      const plaidAccounts = res.data.accounts

      // Match by name, falling back to sole account on the Item
      const match = plaidAccounts.length === 1
        ? plaidAccounts[0]
        : plaidAccounts.find((a) => a.name.toLowerCase() === (account?.name ?? '').toLowerCase())
          ?? plaidAccounts.find((a) => a.name.toLowerCase().includes((account?.name ?? '').toLowerCase().split(' ')[0]))

      if (match) {
        await db
          .update(importConnections)
          .set({ plaidAccountId: match.account_id })
          .where(eq(importConnections.id, connection.id))
        // Reload with the saved plaidAccountId
        connection = { ...connection, plaidAccountId: match.account_id }
      }
    } catch {
      // Non-fatal — sync will fail with the existing guard if still null
    }
  }

  const result = await syncTransactions(connection)

  if ('requiresRelink' in result) return NextResponse.json({ requiresRelink: true })
  if ('error' in result) return NextResponse.json({ error: result.error }, { status: 500 })

  return NextResponse.json({ success: true, ...result })
}
