import { NextResponse } from 'next/server'
import { CountryCode, Products } from 'plaid'
import { auth } from '@/auth'
import { plaidClient } from '@/lib/plaid'

export async function POST() {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const response = await plaidClient.linkTokenCreate({
    user: { client_user_id: session.user.id },
    client_name: 'Coffer',
    products: [Products.Transactions],
    country_codes: [CountryCode.Us],
    language: 'en',
  })

  return NextResponse.json({ link_token: response.data.link_token })
}
