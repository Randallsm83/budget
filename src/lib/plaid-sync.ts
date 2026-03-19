import { and, eq, notInArray } from 'drizzle-orm'
import { db } from '@/db'
import { investmentHoldings, liabilityDetails, accounts } from '@/db/schema'
import { plaidClient } from '@/lib/plaid'

/**
 * Fetches investment holdings for a specific Plaid account, upserts them,
 * removes stale entries, and recomputes the account balance from total market value.
 */
export async function syncInvestmentHoldings(
  userId: string,
  accountId: string,
  plaidAccountId: string,
  accessToken: string,
): Promise<{ synced: number; balance: number }> {
  const holdingsRes = await plaidClient.investmentsHoldingsGet({
    access_token: accessToken,
  })

  const { holdings, securities } = holdingsRes.data
  const securityMap = new Map(securities.map((s) => [s.security_id, s]))

  // Filter to holdings for this specific Plaid account
  const accountHoldings = holdings.filter((h) => h.account_id === plaidAccountId)

  const upsertedSecurityIds: string[] = []
  for (const h of accountHoldings) {
    const sec = securityMap.get(h.security_id)
    await db
      .insert(investmentHoldings)
      .values({
        userId,
        accountId,
        plaidSecurityId: h.security_id,
        name: sec?.name ?? h.security_id,
        tickerSymbol: sec?.ticker_symbol ?? null,
        securityType: sec?.type ?? null,
        quantity: h.quantity,
        institutionPrice: h.institution_price,
        institutionValue: h.institution_value,
        costBasis: h.cost_basis ?? null,
        isoCurrencyCode: h.iso_currency_code ?? null,
        updatedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: [investmentHoldings.accountId, investmentHoldings.plaidSecurityId],
        set: {
          name: sec?.name ?? h.security_id,
          tickerSymbol: sec?.ticker_symbol ?? null,
          securityType: sec?.type ?? null,
          quantity: h.quantity,
          institutionPrice: h.institution_price,
          institutionValue: h.institution_value,
          costBasis: h.cost_basis ?? null,
          isoCurrencyCode: h.iso_currency_code ?? null,
          updatedAt: new Date(),
        },
      })
    upsertedSecurityIds.push(h.security_id)
  }

  // Remove stale holdings (securities no longer present for this account)
  if (upsertedSecurityIds.length > 0) {
    await db.delete(investmentHoldings).where(
      and(
        eq(investmentHoldings.accountId, accountId),
        notInArray(investmentHoldings.plaidSecurityId, upsertedSecurityIds),
      ),
    )
  } else {
    await db.delete(investmentHoldings).where(eq(investmentHoldings.accountId, accountId))
  }

  // Recompute account balance from total holdings market value (stored as milliunits)
  const totalValue = accountHoldings.reduce((sum, h) => sum + h.institution_value, 0)
  const balanceMilliunits = Math.round(totalValue * 1000)
  await db
    .update(accounts)
    .set({ balance: balanceMilliunits, clearedBalance: balanceMilliunits, updatedAt: new Date() })
    .where(and(eq(accounts.id, accountId), eq(accounts.userId, userId)))

  return { synced: accountHoldings.length, balance: balanceMilliunits }
}

/**
 * Fetches liabilities for an Item, matches to the given Plaid account ID,
 * and upserts the relevant liability details row.
 */
export async function syncLiabilityDetails(
  userId: string,
  accountId: string,
  plaidAccountId: string,
  accessToken: string,
): Promise<{ synced: boolean; liabilityType: string | null }> {
  const liabRes = await plaidClient.liabilitiesGet({
    access_token: accessToken,
  })

  const { credit, student, mortgage } = liabRes.data.liabilities

  // Match the Plaid account ID against each liability type
  const creditItem = credit?.find((c) => c.account_id === plaidAccountId)
  const studentItem = student?.find((s) => s.account_id === plaidAccountId)
  const mortgageItem = mortgage?.find((m) => m.account_id === plaidAccountId)

  const matched = creditItem ?? studentItem ?? mortgageItem
  const liabilityType = creditItem ? 'credit' : studentItem ? 'student' : mortgageItem ? 'mortgage' : null

  if (!matched || !liabilityType) return { synced: false, liabilityType: null }

  await db
    .insert(liabilityDetails)
    .values({
      userId,
      accountId,
      liabilityType,
      details: matched as unknown,
      syncedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: liabilityDetails.accountId,
      set: {
        liabilityType,
        details: matched as unknown,
        syncedAt: new Date(),
      },
    })

  return { synced: true, liabilityType }
}
