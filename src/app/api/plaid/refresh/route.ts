import { NextRequest, NextResponse } from 'next/server'
import { and, eq } from 'drizzle-orm'
import { auth } from '@/auth'
import { plaidClient } from '@/lib/plaid'
import { decrypt } from '@/lib/crypto'
import { db } from '@/db'
import { importConnections } from '@/db/schema'

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
    await plaidClient.transactionsRefresh({ access_token: accessToken })
    return NextResponse.json({ success: true })
  } catch (err: unknown) {
    const axiosData = (err as { response?: { data?: unknown } })?.response?.data
    const msg = axiosData ? JSON.stringify(axiosData) : (err instanceof Error ? err.message : String(err))
    console.error('[plaid/refresh]', msg)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
