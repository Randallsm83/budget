import { NextRequest, NextResponse } from 'next/server'
import { and, eq } from 'drizzle-orm'
import { auth } from '@/auth'
import { db } from '@/db'
import { importConnections } from '@/db/schema'
import { decrypt } from '@/lib/crypto'
import { syncLiabilityDetails } from '@/lib/plaid-sync'

export async function POST(req: NextRequest) {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  try {
    const { accountId } = await req.json()
    const userId = session.user.id

    const connection = await db.query.importConnections.findFirst({
      where: and(
        eq(importConnections.accountId, accountId),
        eq(importConnections.userId, userId),
      ),
    })
    if (!connection?.accessTokenEncrypted || !connection.plaidAccountId) {
      return NextResponse.json({ error: 'No Plaid connection found' }, { status: 404 })
    }

    const accessToken = decrypt(connection.accessTokenEncrypted)
    const result = await syncLiabilityDetails(userId, accountId, connection.plaidAccountId, accessToken)

    return NextResponse.json(result)
  } catch (err: unknown) {
    const axiosData = (err as { response?: { data?: unknown } })?.response?.data
    const msg = axiosData ? JSON.stringify(axiosData) : (err instanceof Error ? err.message : JSON.stringify(err))
    console.error('[plaid/liabilities/sync]', msg)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
