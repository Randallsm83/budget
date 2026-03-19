import { NextResponse } from 'next/server'
import { CountryCode, Products } from 'plaid'
import { auth } from '@/auth'
import { plaidClient } from '@/lib/plaid'

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
    return NextResponse.json({ link_token: response.data.link_token })
  } catch (err: unknown) {
    const axiosData = (err as { response?: { data?: unknown } })?.response?.data
    const msg = axiosData ? JSON.stringify(axiosData) : (err instanceof Error ? err.message : JSON.stringify(err))
    console.error('[plaid/link-token]', msg)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
