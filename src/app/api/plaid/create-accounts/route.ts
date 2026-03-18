import { NextRequest, NextResponse } from 'next/server'
import type { AccountBase } from 'plaid'
import { auth } from '@/auth'
import { plaidClient } from '@/lib/plaid'
import { encrypt } from '@/lib/crypto'
import { db } from '@/db'
import { accounts, importConnections } from '@/db/schema'

function mapType(account: AccountBase): string {
  if (account.type === 'credit') return 'credit_card'
  if (account.type === 'loan') return 'loan'
  if (account.type === 'depository') {
    if (account.subtype === 'savings') return 'savings'
    if (account.subtype === 'checking') return 'checking'
    return 'checking'
  }
  if (account.type === 'investment') return 'investment'
  return 'other'
}

function mapBalance(account: AccountBase): number {
  const current = account.balances.current ?? 0
  // Credit + loan: Plaid positive = amount owed → store as negative (debt)
  if (account.type === 'credit' || account.type === 'loan') return -Math.round(current * 1000)
  return Math.round(current * 1000)
}

export async function POST(req: NextRequest) {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  try {
    const { public_token } = await req.json()
    const userId = session.user.id

    const exchangeRes = await plaidClient.itemPublicTokenExchange({ public_token })
    const accessToken = exchangeRes.data.access_token
    const plaidItemId = exchangeRes.data.item_id
    const accessTokenEncrypted = encrypt(accessToken)

    const accountsRes = await plaidClient.accountsGet({ access_token: accessToken })
    const plaidAccounts = accountsRes.data.accounts

    const created: { id: string; name: string; type: string }[] = []

    for (const pa of plaidAccounts) {
      const balance = mapBalance(pa)
      const type = mapType(pa)

      const [newAccount] = await db
        .insert(accounts)
        .values({
          userId,
          name: pa.name,
          type,
          balance,
          clearedBalance: balance,
        })
        .returning({ id: accounts.id, name: accounts.name, type: accounts.type })

      await db.insert(importConnections).values({
        userId,
        accountId: newAccount.id,
        plaidItemId,
        accessTokenEncrypted,
      })

      created.push(newAccount)
    }

    return NextResponse.json({ success: true, accounts: created })
  } catch (err: unknown) {
    const axiosData = (err as { response?: { data?: unknown } })?.response?.data
    const msg = axiosData ? JSON.stringify(axiosData) : (err instanceof Error ? err.message : JSON.stringify(err))
    console.error('[plaid/create-accounts]', msg)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
