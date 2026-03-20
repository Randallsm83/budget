import { NextResponse } from 'next/server'
import { CountryCode, Products } from 'plaid'
import { auth } from '@/auth'
import { plaidClient } from '@/lib/plaid'
import { plaidLog, extractPlaidError } from '@/lib/plaid-logger'

export async function POST() {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  try {
    const response = await plaidClient.linkTokenCreate({
      user: { client_user_id: session.user.id },
      client_name: 'Coffer',
      products: [Products.Transactions],
      optional_products: [Products.Investments, Products.Liabilities],
      country_codes: [CountryCode.Us],
      language: 'en',
      ...(process.env.PLAID_REDIRECT_URI
        ? { redirect_uri: process.env.PLAID_REDIRECT_URI }
        : {}),
      ...(process.env.PLAID_WEBHOOK_URL
        ? { webhook: process.env.PLAID_WEBHOOK_URL }
        : {}),
    })
    plaidLog('info', { route: 'plaid/link-token', userId: session.user.id, requestId: response.data.request_id })
    return NextResponse.json({ link_token: response.data.link_token })
  } catch (err: unknown) {
    plaidLog('error', { route: 'plaid/link-token', userId: session.user.id, ...extractPlaidError(err) })
    const data = (err as { response?: { data?: unknown } })?.response?.data
    return NextResponse.json({ error: data ? JSON.stringify(data) : (err instanceof Error ? err.message : 'Unknown error') }, { status: 500 })
  }
}
