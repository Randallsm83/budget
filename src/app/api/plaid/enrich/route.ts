import { NextRequest, NextResponse } from 'next/server'
import { and, eq } from 'drizzle-orm'
import { EnrichTransactionDirection } from 'plaid'
import type { ClientProvidedTransaction } from 'plaid'
import { auth } from '@/auth'
import { plaidClient } from '@/lib/plaid'
import { db } from '@/db'
import { accounts, transactions } from '@/db/schema'

/** Map our account type to Plaid's account_type for the Enrich API. */
function toPlaidAccountType(appType: string): string {
  if (appType === 'credit_card') return 'credit'
  return 'depository'
}

export async function POST(req: NextRequest) {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { accountId } = await req.json()
  if (!accountId) return NextResponse.json({ error: 'accountId required' }, { status: 400 })

  // Verify the account belongs to the authenticated user
  const account = await db.query.accounts.findFirst({
    where: and(eq(accounts.id, accountId), eq(accounts.userId, session.user.id)),
  })
  if (!account) return NextResponse.json({ error: 'Account not found' }, { status: 404 })

  // Fetch up to 100 transactions that have a payee description to enrich
  const rows = await db
    .select()
    .from(transactions)
    .where(and(eq(transactions.accountId, accountId), eq(transactions.userId, session.user.id)))
    .limit(100)

  const clientTransactions: ClientProvidedTransaction[] = rows
    .filter((t) => t.payee)
    .map((t) => ({
      id: t.id,
      description: t.payee!,
      // Plaid Enrich expects the absolute dollar value
      amount: Math.abs(t.amount) / 1000,
      // Our convention: negative = outflow, positive = inflow
      direction: t.amount < 0 ? EnrichTransactionDirection.Outflow : EnrichTransactionDirection.Inflow,
      iso_currency_code: 'USD',
    }))

  if (clientTransactions.length === 0) {
    return NextResponse.json({ enriched_transactions: [], request_id: null })
  }

  try {
    const res = await plaidClient.transactionsEnrich({
      account_type: toPlaidAccountType(account.type),
      transactions: clientTransactions,
    })
    return NextResponse.json({
      enriched_transactions: res.data.enriched_transactions,
      request_id: res.data.request_id,
    })
  } catch (err: unknown) {
    const axiosData = (err as { response?: { data?: unknown } })?.response?.data
    const msg = axiosData
      ? JSON.stringify(axiosData)
      : err instanceof Error
        ? err.message
        : String(err)
    console.error('[plaid/enrich]', msg)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
