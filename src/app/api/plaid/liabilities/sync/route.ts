import { NextRequest, NextResponse } from 'next/server'
import { and, eq } from 'drizzle-orm'
import { auth } from '@/auth'
import { db } from '@/db'
import { importConnections } from '@/db/schema'
import { decrypt } from '@/lib/crypto'
import { syncLiabilityDetails } from '@/lib/plaid-sync'
import { plaidLog, extractPlaidError } from '@/lib/plaid-logger'

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
    plaidLog('info', { route: 'plaid/liabilities/sync', userId, accountId, plaidItemId: connection.plaidItemId ?? undefined, plaidAccountId: connection.plaidAccountId, synced: result.synced, liabilityType: result.liabilityType })
    return NextResponse.json(result)
  } catch (err: unknown) {
    const errFields = extractPlaidError(err)
    plaidLog('error', { route: 'plaid/liabilities/sync', userId: session.user.id, ...errFields })
    const CONSENT_CODES = new Set(['PRODUCT_NOT_READY', 'PRODUCTS_NOT_READY', 'PRODUCT_NOT_ENABLED'])
    if (errFields.errorCode && CONSENT_CODES.has(errFields.errorCode)) {
      return NextResponse.json({ error: 'This account needs additional consent to access liability data. Re-link the account to grant access.', requiresConsent: true }, { status: 403 })
    }
    const data = (err as { response?: { data?: unknown } })?.response?.data
    return NextResponse.json({ error: data ? JSON.stringify(data) : (err instanceof Error ? err.message : 'Unknown error') }, { status: 500 })
  }
}
