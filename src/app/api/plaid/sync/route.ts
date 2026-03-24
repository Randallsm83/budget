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

  const connRaw = await db.query.importConnections.findFirst({
    where: and(
      eq(importConnections.accountId, accountId),
      eq(importConnections.userId, session.user.id),
    ),
  })
  if (!connRaw?.accessTokenEncrypted) {
    return NextResponse.json({ error: 'No bank connection for this account' }, { status: 404 })
  }
  let connection = connRaw

  // Auto-heal: if plaidAccountId is missing, resolve it from Plaid and save it
  if (!connection.plaidAccountId) {
    try {
      const account = await db.query.accounts.findFirst({
        where: and(eq(accounts.id, accountId), eq(accounts.userId, session.user.id)),
      })
      const accessToken = decrypt(connection.accessTokenEncrypted!)
      const res = await plaidClient.accountsGet({ access_token: accessToken })
      const plaidAccounts = res.data.accounts

      // Find which Plaid account IDs are already claimed by OTHER connections on this Item
      const siblingConns = connection.plaidItemId
        ? await db.query.importConnections.findMany({
            where: and(
              eq(importConnections.plaidItemId, connection.plaidItemId),
              eq(importConnections.userId, session.user.id),
            ),
          })
        : []
      const claimedIds = new Set(
        siblingConns
          .filter((c) => c.id !== connection.id && c.plaidAccountId)
          .map((c) => c.plaidAccountId as string)
      )
      const unclaimed = plaidAccounts.filter((a) => !claimedIds.has(a.account_id))

      // Determine Plaid type for this account
      const appType = account?.type ?? ''
      const plaidTypeMap: Record<string, string[]> = {
        credit_card: ['credit'], loan: ['loan'],
        checking: ['depository'], savings: ['depository'],
        investment: ['investment'], cash: ['depository'],
      }
      const expectedPlaidTypes = plaidTypeMap[appType] ?? []

      const appName = (account?.name ?? '').toLowerCase()
      const match =
        // 1. Exact name match among unclaimed
        unclaimed.find((a) => a.name.toLowerCase() === appName) ??
        // 2. Partial name match
        unclaimed.find((a) => a.name.toLowerCase().includes(appName) || appName.includes(a.name.toLowerCase())) ??
        // 3. Type match among unclaimed
        unclaimed.find((a) => expectedPlaidTypes.includes(a.type as string)) ??
        // 4. Only one unclaimed — must be ours
        (unclaimed.length === 1 ? unclaimed[0] : undefined)

      if (match) {
        await db
          .update(importConnections)
          .set({ plaidAccountId: match.account_id })
          .where(eq(importConnections.id, connection.id))
        connection = { ...connection, plaidAccountId: match.account_id }
      }
    } catch {
      // Non-fatal — sync will fail with the guard message if still unresolved
    }
  }

  const result = await syncTransactions(connection)

  if ('requiresRelink' in result) return NextResponse.json({ requiresRelink: true })
  if ('error' in result) return NextResponse.json({ error: result.error }, { status: 500 })

  return NextResponse.json({ success: true, ...result })
}
