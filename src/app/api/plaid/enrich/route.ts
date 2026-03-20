import { NextRequest, NextResponse } from 'next/server'
import { and, eq } from 'drizzle-orm'
import { EnrichTransactionDirection } from 'plaid'
import type { ClientProvidedTransaction } from 'plaid'
import { auth } from '@/auth'
import { plaidClient } from '@/lib/plaid'
import { db } from '@/db'
import { accounts, categories, payeeRules, transactions } from '@/db/schema'
import { normalizePayee } from '@/lib/payee'
import { getPlaidCategoryHints } from '@/lib/plaidCategories'
import { plaidLog, extractPlaidError } from '@/lib/plaid-logger'

const BATCH_SIZE = 100

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

  const userId = session.user.id

  // Verify the account belongs to the authenticated user
  const account = await db.query.accounts.findFirst({
    where: and(eq(accounts.id, accountId), eq(accounts.userId, userId)),
  })
  if (!account) return NextResponse.json({ error: 'Account not found' }, { status: 404 })

  // Load user categories once for auto-categorization hints
  const userCategories = await db
    .select({ id: categories.id, name: categories.name })
    .from(categories)
    .where(eq(categories.userId, userId))

  function hintCategory(
    primary: string | null | undefined,
    detailed: string | null | undefined,
  ): string | null {
    if (!primary) return null
    const hints = getPlaidCategoryHints(primary, detailed ?? '')
    for (const hint of hints) {
      const match = userCategories.find((c) => c.name.toLowerCase().includes(hint))
      if (match) return match.id
    }
    return null
  }

  // Fetch all transactions that have a payee description
  const rows = await db
    .select()
    .from(transactions)
    .where(and(eq(transactions.accountId, accountId), eq(transactions.userId, userId)))

  const eligible = rows.filter((t) => t.payee)
  if (eligible.length === 0) {
    return NextResponse.json({ enriched: 0, categorized: 0 })
  }

  let enrichedCount = 0
  let categorizedCount = 0

  try {
    // Plaid Enrich accepts max 100 transactions per request — batch accordingly
    for (let i = 0; i < eligible.length; i += BATCH_SIZE) {
      const batch = eligible.slice(i, i + BATCH_SIZE)

      const clientTransactions: ClientProvidedTransaction[] = batch.map((t) => ({
        id: t.id,
        description: t.payee!,
        // Plaid Enrich expects the absolute dollar value
        amount: Math.abs(t.amount) / 1000,
        // Our convention: negative = outflow, positive = inflow
        direction:
          t.amount < 0 ? EnrichTransactionDirection.Outflow : EnrichTransactionDirection.Inflow,
        iso_currency_code: 'USD',
        // Posting date improves merchant matching accuracy
        date_posted: t.date,
      }))

      const res = await plaidClient.transactionsEnrich({
        account_type: toPlaidAccountType(account.type),
        transactions: clientTransactions,
      })

      for (const enriched of res.data.enriched_transactions) {
        const original = batch.find((t) => t.id === enriched.id)
        if (!original) continue

        const e = enriched.enrichments
        const merchantName = e?.merchant_name
        const pfc = e?.personal_finance_category

        // Use the enriched merchant name when available — it strips location
        // codes and store numbers (e.g. "WHOLEFDS MKT #10025" → "Whole Foods")
        const newPayee = merchantName ?? original.payee

        // Only auto-categorize if the transaction has no category yet;
        // never overwrite a category the user has set manually.
        const newCategoryId =
          original.categoryId ?? hintCategory(pfc?.primary, pfc?.detailed) ?? null

        const payeeChanged = newPayee !== original.payee
        const categoryChanged = newCategoryId !== original.categoryId

        if (payeeChanged || categoryChanged) {
          await db
            .update(transactions)
            .set({
              ...(payeeChanged ? { payee: newPayee } : {}),
              ...(categoryChanged ? { categoryId: newCategoryId } : {}),
              updatedAt: new Date(),
            })
            .where(eq(transactions.id, original.id))

          enrichedCount++
          if (categoryChanged && newCategoryId) categorizedCount++
        }

        // Learn the enriched payee → category mapping so future imports
        // (Plaid sync, CSV) auto-categorize without needing to call Enrich again.
        if (newPayee && newCategoryId) {
          const key = normalizePayee(newPayee)
          if (key) {
            await db
              .insert(payeeRules)
              .values({ userId, payeeNormalized: key, categoryId: newCategoryId })
              .onConflictDoUpdate({
                target: [payeeRules.userId, payeeRules.payeeNormalized],
                set: { categoryId: newCategoryId, updatedAt: new Date() },
              })
          }
        }
      }
    }
  } catch (err: unknown) {
    plaidLog('error', { route: 'plaid/enrich', userId, accountId, ...extractPlaidError(err) })
    const data = (err as { response?: { data?: unknown } })?.response?.data
    return NextResponse.json({ error: data ? JSON.stringify(data) : (err instanceof Error ? err.message : 'Unknown error') }, { status: 500 })
  }

  return NextResponse.json({ enriched: enrichedCount, categorized: categorizedCount })
}
