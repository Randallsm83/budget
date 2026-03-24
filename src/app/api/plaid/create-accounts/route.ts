import { NextRequest, NextResponse } from 'next/server'
import type { AccountBase } from 'plaid'
import { and, eq, isNull } from 'drizzle-orm'
import { auth } from '@/auth'
import { plaidClient } from '@/lib/plaid'
import { encrypt } from '@/lib/crypto'
import { db } from '@/db'
import { accounts, importConnections } from '@/db/schema'
import { syncInvestmentHoldings, syncLiabilityDetails } from '@/lib/plaid-sync'
import { plaidLog, extractPlaidError } from '@/lib/plaid-logger'

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
    plaidLog('info', { route: 'plaid/create-accounts', userId, plaidItemId, requestId: exchangeRes.data.request_id })
    const accessTokenEncrypted = encrypt(accessToken)

    const accountsRes = await plaidClient.accountsGet({ access_token: accessToken })
    const plaidAccounts = accountsRes.data.accounts

    const created: { id: string; name: string; type: string; reconnected?: boolean }[] = []

    for (const pa of plaidAccounts) {
      const balance = mapBalance(pa)
      const type = mapType(pa)

      // Check for a soft-disconnected connection with the same plaidAccountId.
      // If found, reconnect the existing account instead of creating a duplicate.
      const existingConn = await db.query.importConnections.findFirst({
        where: and(
          eq(importConnections.plaidAccountId, pa.account_id),
          eq(importConnections.userId, userId),
          isNull(importConnections.accessTokenEncrypted),
        ),
      })

      if (existingConn?.accountId) {
        // Reconnect: restore the token on the existing connection row
        await db
          .update(importConnections)
          .set({ plaidItemId, accessTokenEncrypted, cursor: null, requiresRelink: false })
          .where(eq(importConnections.id, existingConn.id))
        // Refresh the account balance from Plaid
        await db
          .update(accounts)
          .set({ balance, clearedBalance: balance, updatedAt: new Date() })
          .where(eq(accounts.id, existingConn.accountId))
        const acct = await db.query.accounts.findFirst({ where: eq(accounts.id, existingConn.accountId) })
        if (acct) created.push({ id: acct.id, name: acct.name, type: acct.type, reconnected: true })
        continue
      }

      // No existing connection found — create a new account
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
        plaidAccountId: pa.account_id,
        accessTokenEncrypted,
      })

      // Bootstrap product-specific data on first link (best-effort)
      if (type === 'investment') {
        try {
          await syncInvestmentHoldings(userId, newAccount.id, pa.account_id, accessToken)
        } catch (err) {
          plaidLog('warn', { route: 'plaid/create-accounts', userId, plaidItemId, accountId: newAccount.id, plaidAccountId: pa.account_id, msg: 'investments bootstrap failed', ...extractPlaidError(err) })
        }
      }
      if (type === 'loan' || type === 'credit_card') {
        try {
          await syncLiabilityDetails(userId, newAccount.id, pa.account_id, accessToken)
        } catch (err) {
          plaidLog('warn', { route: 'plaid/create-accounts', userId, plaidItemId, accountId: newAccount.id, plaidAccountId: pa.account_id, msg: 'liabilities bootstrap failed', ...extractPlaidError(err) })
        }
      }

      created.push(newAccount)
    }

    plaidLog('info', { route: 'plaid/create-accounts', userId, plaidItemId, createdCount: created.length })
    return NextResponse.json({ success: true, accounts: created })
  } catch (err: unknown) {
    plaidLog('error', { route: 'plaid/create-accounts', userId: session.user.id, ...extractPlaidError(err) })
    const data = (err as { response?: { data?: unknown } })?.response?.data
    return NextResponse.json({ error: data ? JSON.stringify(data) : (err instanceof Error ? err.message : 'Unknown error') }, { status: 500 })
  }
}
