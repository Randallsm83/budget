import { NextRequest, NextResponse } from 'next/server'
import { and, eq } from 'drizzle-orm'
import { auth } from '@/auth'
import { plaidClient } from '@/lib/plaid'
import { decrypt } from '@/lib/crypto'
import { db } from '@/db'
import { importConnections } from '@/db/schema'
import { plaidLog, extractPlaidError } from '@/lib/plaid-logger'

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
    return NextResponse.json({ error: 'No connection found' }, { status: 404 })
  }

  const accessToken = decrypt(connection.accessTokenEncrypted)

  try {
    // Tells Plaid to kick off an async historical pull for this Item.
    // The new transactions won't appear immediately — they'll show up on
    // the next transactionsSync call (usually within a few minutes).
    const refreshRes = await plaidClient.transactionsRefresh({ access_token: accessToken })
    plaidLog('info', { route: 'plaid/refresh', userId: session.user.id, accountId, plaidItemId: connection.plaidItemId ?? undefined, requestId: refreshRes.data.request_id })
    return NextResponse.json({ success: true })
  } catch (err: unknown) {
    plaidLog('error', { route: 'plaid/refresh', userId: session.user.id, accountId, plaidItemId: connection.plaidItemId ?? undefined, ...extractPlaidError(err) })
    const data = (err as { response?: { data?: unknown } })?.response?.data
    return NextResponse.json({ error: data ? JSON.stringify(data) : (err instanceof Error ? err.message : 'Unknown error') }, { status: 500 })
  }
}
