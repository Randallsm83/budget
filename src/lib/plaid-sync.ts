import { and, eq, notInArray, sql } from 'drizzle-orm'
import type { Transaction as PlaidTransaction, RemovedTransaction } from 'plaid'
import { db } from '@/db'
import { accounts, categories, importConnections, payeeRules, transactions, investmentHoldings, liabilityDetails } from '@/db/schema'
import { plaidClient } from '@/lib/plaid'
import { decrypt } from '@/lib/crypto'
import { normalizePayee } from '@/lib/payee'
import { getPlaidCategoryHints } from '@/lib/plaidCategories'
import { plaidLog, extractPlaidError } from '@/lib/plaid-logger'

// Patterns that indicate a true bank-to-bank inter-account transfer.
// IMPORTANT: Do NOT add CC bill payment patterns here (autopay, bill pay,
// online payment, etc.). Those are checking outflows that must be categorised
// to the CC Payment category so they appear in budget activity.
// Only patterns that unambiguously mean "money moved between bank accounts"
// belong here.
// Exported so actions.ts reapplyTransferDetection can use the same logic.
export const TRANSFER_RE = /\b(online transfer|ach transfer|wire transfer|book transfer)\b|^transfer (from|to|between)/i

// Plaid personal_finance_category.detailed codes that unambiguously indicate
// a bank-to-bank transfer. LOAN_PAYMENTS_CREDIT_CARD_PAYMENT is intentionally
// excluded — those are CC bill payments from checking and must be categorised
// to the CC Payment category, not hidden as transfers.
export const TRANSFER_PFC_CODES = new Set([
  'TRANSFER_IN_ACCOUNT_TRANSFER',
  'TRANSFER_OUT_ACCOUNT_TRANSFER',
])

type SyncConnection = typeof importConnections.$inferSelect

export type SyncResult =
  | { added: number; modified: number; removed: number; firstSync: boolean }
  | { requiresRelink: true }
  | { error: string }

/**
 * Core transaction sync for one Plaid connection. Safe to call from both the
 * manual-sync API route and the SYNC_UPDATES_AVAILABLE webhook handler.
 */
export async function syncTransactions(connection: SyncConnection): Promise<SyncResult> {
  if (!connection.accessTokenEncrypted) return { error: 'No access token' }
  if (!connection.accountId) return { error: 'No account ID' }

  const accessToken = decrypt(connection.accessTokenEncrypted)
  const userId = connection.userId
  const accountId: string = connection.accountId
  const plaidAccountId = connection.plaidAccountId ?? undefined

  // Safety: without plaidAccountId we would dump ALL item transactions into this
  // account (filter becomes () => true). Bail out rather than corrupt the register.
  if (!plaidAccountId) {
    plaidLog('warn', { route: 'plaid-sync/transactions', userId, accountId, msg: 'skipped sync — connection has no plaidAccountId' })
    return { error: 'Connection has no plaidAccountId — re-link the account to repair' }
  }

  const isFirstSync = !connection.cursor
  let cursor: string | undefined = connection.cursor ?? undefined
  let hasMore = true
  const added: PlaidTransaction[] = []
  const modified: PlaidTransaction[] = []
  const removed: RemovedTransaction[] = []

  let lastRequestId: string | undefined
  try {
    while (hasMore) {
      const res = await plaidClient.transactionsSync({ access_token: accessToken, cursor })
      lastRequestId = res.data.request_id
      const filter = plaidAccountId
        ? (t: PlaidTransaction) => t.account_id === plaidAccountId
        : () => true
      added.push(...res.data.added.filter(filter))
      modified.push(...res.data.modified.filter(filter))
      removed.push(...res.data.removed)
      cursor = res.data.next_cursor
      hasMore = res.data.has_more
    }
  } catch (err: unknown) {
    const errFields = extractPlaidError(err)
    plaidLog('error', { route: 'plaid-sync/transactions', userId, accountId, plaidItemId: connection.plaidItemId ?? undefined, ...errFields })
    if (errFields.errorCode === 'ITEM_LOGIN_REQUIRED') {
      if (connection.plaidItemId) {
        await db.update(importConnections)
          .set({ requiresRelink: true })
          .where(eq(importConnections.plaidItemId, connection.plaidItemId))
      }
      return { requiresRelink: true }
    }
    return { error: errFields.errorMessage ?? 'Unknown error' }
  }

  // Load payee rules and categories for auto-categorisation
  const [userRules, userCategories] = await Promise.all([
    db.query.payeeRules.findMany({ where: eq(payeeRules.userId, userId) }),
    db.select({ id: categories.id, name: categories.name })
      .from(categories).where(eq(categories.userId, userId)),
  ])
  const ruleMap = new Map(userRules.map((r) => [r.payeeNormalized, r.categoryId]))

  function hintCategory(primary?: string | null, detailed?: string | null): string | null {
    if (!primary) return null
    const hints = getPlaidCategoryHints(primary, detailed ?? '')
    for (const hint of hints) {
      const match = userCategories.find((c) => c.name.toLowerCase().includes(hint))
      if (match) return match.id
    }
    return null
  }

  if (added.length > 0) {
    await db.insert(transactions).values(
      added.map((t) => {  // satisfies array overload
        const storedPayee = t.merchant_name ?? t.name
        const key = storedPayee ? normalizePayee(storedPayee) : null
        const isTransfer =
          (!!storedPayee && TRANSFER_RE.test(storedPayee)) ||
          (t.personal_finance_category?.detailed != null &&
            TRANSFER_PFC_CODES.has(t.personal_finance_category.detailed))
        const categoryId = isTransfer ? null :
          (key ? ruleMap.get(key) : undefined)
          ?? hintCategory(t.personal_finance_category?.primary, t.personal_finance_category?.detailed)
          ?? null
        return {
          userId, accountId,
          date: t.date,
          payee: storedPayee,
          categoryId,
          amount: -Math.round(t.amount * 1000),
          cleared: true,
          isTransfer,
          importId: t.transaction_id,
        }
      }),
    ).onConflictDoNothing()
  }

  for (const t of modified) {
    await db.update(transactions)
      .set({ date: t.date, payee: t.merchant_name ?? t.name, amount: -Math.round(t.amount * 1000), cleared: true, updatedAt: new Date() })
      .where(eq(transactions.importId, t.transaction_id))
  }

  for (const t of removed) {
    await db.delete(transactions).where(eq(transactions.importId, t.transaction_id))
  }

  // Update balance from Plaid live data
  try {
    const balRes = await plaidClient.accountsGet({ access_token: accessToken })
    const plaidAcc = plaidAccountId
      ? balRes.data.accounts.find((a) => a.account_id === plaidAccountId)
      : balRes.data.accounts[0]
    if (plaidAcc) {
      const current = plaidAcc.balances.current ?? 0
      const isDebt = plaidAcc.type === 'credit' || plaidAcc.type === 'loan'
      const bal = isDebt ? -Math.round(current * 1000) : Math.round(current * 1000)
      await db.update(accounts).set({ balance: bal, clearedBalance: bal, updatedAt: new Date() }).where(eq(accounts.id, accountId))
    }
  } catch {
    const [row] = await db.select({ total: sql<number>`coalesce(sum(${transactions.amount}), 0)` })
      .from(transactions).where(eq(transactions.accountId, accountId as string))
    if (row) await db.update(accounts).set({ balance: row.total, clearedBalance: row.total, updatedAt: new Date() }).where(eq(accounts.id, accountId as string))
  }

  if (connection.plaidItemId) {
    await db.update(importConnections).set({ requiresRelink: false }).where(eq(importConnections.plaidItemId, connection.plaidItemId))
  }
  await db.update(importConnections).set({ cursor, lastSyncedAt: new Date() }).where(eq(importConnections.id, connection.id))

  plaidLog('info', { route: 'plaid-sync/transactions', userId, accountId, plaidItemId: connection.plaidItemId ?? undefined, requestId: lastRequestId, added: added.length, modified: modified.length, removed: removed.length, firstSync: isFirstSync })
  return { added: added.length, modified: modified.length, removed: removed.length, firstSync: isFirstSync }
}

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
