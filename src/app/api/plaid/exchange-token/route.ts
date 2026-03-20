import { NextRequest, NextResponse } from 'next/server'
import { and, eq } from 'drizzle-orm'
import { auth } from '@/auth'
import { plaidClient } from '@/lib/plaid'
import { encrypt } from '@/lib/crypto'
import { db } from '@/db'
import { importConnections } from '@/db/schema'
import { syncTransactions } from '@/lib/plaid-sync'
import { plaidLog, extractPlaidError } from '@/lib/plaid-logger'

export async function POST(req: NextRequest) {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { public_token, accountId, institutionId } =
    (await req.json()) as { public_token: string; accountId: string; institutionId?: string }

  let response
  try {
    response = await plaidClient.itemPublicTokenExchange({ public_token })
  } catch (err) {
    plaidLog('error', { route: 'plaid/exchange-token', userId: session.user.id, accountId, institutionId, ...extractPlaidError(err) })
    return NextResponse.json({ error: 'Failed to exchange token' }, { status: 500 })
  }
  const accessToken = response.data.access_token
  const plaidItemId = response.data.item_id
  const requestId = response.data.request_id
  const accessTokenEncrypted = encrypt(accessToken)

  // ---------------------------------------------------------------------------
  // Duplicate Item detection
  // Per Plaid docs: check whether this user already has an Item from the same
  // institution before storing the new access token.
  //
  // Case 1 — same item_id: the user re-linked the same Plaid Item (e.g., to add
  //   another account from the same bank). This is intentional; fall through to
  //   the upsert below.
  //
  // Case 2 — different item_id, same institution_id: a second, separate Plaid
  //   Item was created for the same institution. This is a duplicate. Remove the
  //   newly created token immediately and return a 409 so the client can inform
  //   the user that this bank is already connected.
  // ---------------------------------------------------------------------------
  if (institutionId) {
    const existingInstitutionConn = await db.query.importConnections.findFirst({
      where: and(
        eq(importConnections.userId, session.user.id),
        eq(importConnections.plaidInstitutionId, institutionId),
      ),
    })
    if (existingInstitutionConn && existingInstitutionConn.plaidItemId !== plaidItemId) {
      // Duplicate: remove the newly exchanged token so we are not billed twice
      try { await plaidClient.itemRemove({ access_token: accessToken }) } catch { /* ignore */ }
      plaidLog('warn', { route: 'plaid/exchange-token', userId: session.user.id, accountId, institutionId, plaidItemId, requestId, msg: 'duplicate Item detected — removed new token' })
      return NextResponse.json(
        { duplicate: true, message: 'This bank is already connected to one of your accounts.' },
        { status: 409 },
      )
    }
  }

  // Upsert: update existing connection or create new one
  const existing = await db.query.importConnections.findFirst({
    where: and(
      eq(importConnections.userId, session.user.id),
      eq(importConnections.accountId, accountId),
    ),
  })

  if (existing) {
    await db
      .update(importConnections)
      .set({ plaidItemId, plaidInstitutionId: institutionId ?? null, accessTokenEncrypted, cursor: null, lastSyncedAt: null })
      .where(eq(importConnections.id, existing.id))
  } else {
    await db.insert(importConnections).values({
      userId: session.user.id,
      accountId,
      plaidItemId,
      plaidInstitutionId: institutionId ?? null,
      accessTokenEncrypted,
    })
  }

  plaidLog('info', { route: 'plaid/exchange-token', userId: session.user.id, accountId, plaidItemId, institutionId, requestId })

  // Auto-sync immediately so the account register isn't empty after linking.
  // The initial sync covers ~30 days; the webhook will pull full history as
  // Plaid completes the background historical pull.
  const freshConn = await db.query.importConnections.findFirst({
    where: and(
      eq(importConnections.userId, session.user.id),
      eq(importConnections.accountId, accountId),
    ),
  })
  if (freshConn) {
    const syncResult = await syncTransactions(freshConn)
    plaidLog('info', { route: 'plaid/exchange-token/auto-sync', userId: session.user.id, accountId, ...syncResult })
  }

  return NextResponse.json({ success: true })
}
