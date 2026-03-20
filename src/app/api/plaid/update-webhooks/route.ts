import { NextResponse } from 'next/server'
import { eq } from 'drizzle-orm'
import { auth } from '@/auth'
import { plaidClient } from '@/lib/plaid'
import { decrypt } from '@/lib/crypto'
import { db } from '@/db'
import { importConnections } from '@/db/schema'
import { plaidLog, extractPlaidError } from '@/lib/plaid-logger'

// POST /api/plaid/update-webhooks
// Updates the webhook URL on every Plaid Item for this user.
// Call once after setting PLAID_WEBHOOK_URL in production.
export async function POST() {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const webhookUrl = process.env.PLAID_WEBHOOK_URL
  if (!webhookUrl) return NextResponse.json({ error: 'PLAID_WEBHOOK_URL not set' }, { status: 500 })

  const connections = await db.query.importConnections.findMany({
    where: eq(importConnections.userId, session.user.id),
  })

  const results: { accountId: string | null; status: string }[] = []

  for (const conn of connections) {
    if (!conn.accessTokenEncrypted) continue
    try {
      const accessToken = decrypt(conn.accessTokenEncrypted)
      const wRes = await plaidClient.itemWebhookUpdate({ access_token: accessToken, webhook: webhookUrl })
      plaidLog('info', { route: 'plaid/update-webhooks', userId: session.user.id, plaidItemId: conn.plaidItemId ?? undefined, accountId: conn.accountId ?? undefined, requestId: wRes.data.request_id })
      results.push({ accountId: conn.accountId, status: 'updated' })
    } catch (err) {
      const errFields = extractPlaidError(err)
      plaidLog('error', { route: 'plaid/update-webhooks', userId: session.user.id, plaidItemId: conn.plaidItemId ?? undefined, accountId: conn.accountId ?? undefined, ...errFields })
      results.push({ accountId: conn.accountId, status: `error: ${errFields.errorMessage ?? 'unknown'}` })
    }
  }

  return NextResponse.json({ updated: results.filter(r => r.status === 'updated').length, results })
}
