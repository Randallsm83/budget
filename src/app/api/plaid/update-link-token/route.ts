import { NextRequest, NextResponse } from 'next/server'
import { CountryCode } from 'plaid'
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

  const { accountId, accountSelectionEnabled } = await req.json() as { accountId: string; accountSelectionEnabled?: boolean }

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
    // Update mode: pass access_token instead of products — Plaid re-authenticates
    // the existing Item without creating a new one. No token exchange needed on success.
    // account_selection_enabled=true opens the account picker so users can share new accounts.
    const res = await plaidClient.linkTokenCreate({
      user: { client_user_id: session.user.id },
      client_name: 'Coffer',
      access_token: accessToken,
      country_codes: [CountryCode.Us],
      language: 'en',
      ...(accountSelectionEnabled ? { update: { account_selection_enabled: true } } : {}),
      ...(process.env.PLAID_REDIRECT_URI
        ? { redirect_uri: process.env.PLAID_REDIRECT_URI }
        : {}),
      ...(process.env.PLAID_WEBHOOK_URL
        ? { webhook: process.env.PLAID_WEBHOOK_URL }
        : {}),
    })
    plaidLog('info', { route: 'plaid/update-link-token', userId: session.user.id, accountId, plaidItemId: connection.plaidItemId ?? undefined, requestId: res.data.request_id })
    return NextResponse.json({ link_token: res.data.link_token })
  } catch (err: unknown) {
    plaidLog('error', { route: 'plaid/update-link-token', userId: session.user.id, accountId, plaidItemId: connection.plaidItemId ?? undefined, ...extractPlaidError(err) })
    const data = (err as { response?: { data?: unknown } })?.response?.data
    return NextResponse.json({ error: data ? JSON.stringify(data) : (err instanceof Error ? err.message : 'Unknown error') }, { status: 500 })
  }
}
