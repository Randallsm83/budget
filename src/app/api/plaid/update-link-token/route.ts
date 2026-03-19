import { NextRequest, NextResponse } from 'next/server'
import { CountryCode } from 'plaid'
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
    // Update mode: pass access_token instead of products — Plaid re-authenticates
    // the existing Item without creating a new one. No token exchange needed on success.
    const res = await plaidClient.linkTokenCreate({
      user: { client_user_id: session.user.id },
      client_name: 'Coffer',
      access_token: accessToken,
      country_codes: [CountryCode.Us],
      language: 'en',
      ...(process.env.PLAID_REDIRECT_URI
        ? { redirect_uri: process.env.PLAID_REDIRECT_URI }
        : {}),
      ...(process.env.PLAID_WEBHOOK_URL
        ? { webhook: process.env.PLAID_WEBHOOK_URL }
        : {}),
    })
    return NextResponse.json({ link_token: res.data.link_token })
  } catch (err: unknown) {
    const axiosData = (err as { response?: { data?: unknown } })?.response?.data
    const msg = axiosData ? JSON.stringify(axiosData) : (err instanceof Error ? err.message : JSON.stringify(err))
    console.error('[plaid/update-link-token]', msg)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
