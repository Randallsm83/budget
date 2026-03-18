import { NextResponse } from 'next/server'
import { auth } from '@/auth'

export async function GET() {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const clientId = process.env.PLAID_CLIENT_ID ?? ''
  const secret = process.env.PLAID_SECRET ?? ''
  const plaidEnv = process.env.PLAID_ENV ?? ''

  return NextResponse.json({
    PLAID_ENV: plaidEnv,
    PLAID_CLIENT_ID_length: clientId.length,
    PLAID_CLIENT_ID_last4: clientId.slice(-4),
    PLAID_CLIENT_ID_hex: [...clientId].map(c => c.charCodeAt(0).toString(16)).join(' '),
    PLAID_SECRET_length: secret.length,
    PLAID_SECRET_last4: secret.slice(-4),
  })
}
