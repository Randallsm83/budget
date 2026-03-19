'use server'

import { revalidatePath } from 'next/cache'
import { and, asc, eq, inArray, isNull, isNotNull, max, count, sql } from 'drizzle-orm'
import { auth } from '@/auth'
import { db } from '@/db'
import { accounts, categories, categoryGroups, monthBudgets, transactions, payeeRules } from '@/db/schema'
import { normalizePayee } from '@/lib/payee'

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------
async function learnPayeeRule(userId: string, payee: string | null | undefined, categoryId: string | null) {
  if (!payee || !categoryId) return
  const key = normalizePayee(payee)
  if (!key) return
  await db
    .insert(payeeRules)
    .values({ userId, payeeNormalized: key, categoryId })
    .onConflictDoUpdate({
      target: [payeeRules.userId, payeeRules.payeeNormalized],
      set: { categoryId, updatedAt: new Date() },
    })
}

// ---------------------------------------------------------------------------
// Auth helper
// ---------------------------------------------------------------------------
async function requireUser(): Promise<string> {
  const session = await auth()
  if (!session?.user?.id) throw new Error('Not authenticated')
  return session.user.id
}

// ---------------------------------------------------------------------------
// CC Payment helpers (internal)
// ---------------------------------------------------------------------------
async function getOrCreateCCPaymentGroup(userId: string) {
  const existing = await db.query.categoryGroups.findFirst({
    where: and(
      eq(categoryGroups.userId, userId),
      eq(categoryGroups.isSystem, true),
      eq(categoryGroups.isTransfer, true),
    ),
  })
  if (existing) return existing

  const [group] = await db
    .insert(categoryGroups)
    .values({ userId, name: 'Credit Card Payments', isIncome: false, isTransfer: true, isSystem: true, sortOrder: 9999 })
    .returning()
  return group
}

// Backfills CC Payment categories for any CC accounts that don't have one yet.
// Safe to call on every budget page load — no-ops if already up to date.
export async function ensureCCPaymentCategories() {
  const userId = await requireUser()

  const ccAccounts = await db
    .select({ id: accounts.id, name: accounts.name })
    .from(accounts)
    .where(and(eq(accounts.userId, userId), eq(accounts.type, 'credit_card')))

  if (ccAccounts.length === 0) return

  const group = await getOrCreateCCPaymentGroup(userId)

  // Find which CC accounts already have a linked payment category
  const existing = await db
    .select({ id: categories.id, name: categories.name, ccAccountId: categories.ccAccountId })
    .from(categories)
    .where(and(eq(categories.userId, userId), eq(categories.groupId, group.id)))

  // Sync names: if the account was renamed but the category wasn't updated, fix it now
  for (const cat of existing) {
    if (!cat.ccAccountId) continue
    const acct = ccAccounts.find((a) => a.id === cat.ccAccountId)
    if (acct && cat.name !== acct.name) {
      await db.update(categories).set({ name: acct.name }).where(eq(categories.id, cat.id))
    }
  }

  const existingIds = new Set(existing.map((c) => c.ccAccountId))
  const missing = ccAccounts.filter((a) => !existingIds.has(a.id))
  if (missing.length === 0) return

  const [maxRow] = await db
    .select({ val: max(categories.sortOrder) })
    .from(categories)
    .where(eq(categories.groupId, group.id))

  let sortOrder = (maxRow?.val ?? -1) + 1
  for (const acct of missing) {
    await db.insert(categories).values({ userId, groupId: group.id, name: acct.name, ccAccountId: acct.id, sortOrder })
    sortOrder++
  }

  revalidatePath('/budget')
}

// ---------------------------------------------------------------------------
// Accounts
// ---------------------------------------------------------------------------
export async function addAccount(data: {
  name: string
  type: string
  startingBalanceDollars: string // user-entered dollar string, e.g. "1234.56"
}) {
  const userId = await requireUser()

  const balanceDollars = parseFloat(data.startingBalanceDollars.replace(/[$,]/g, '')) || 0
  const balanceMilliunits = Math.round(balanceDollars * 1000)

  const [account] = await db
    .insert(accounts)
    .values({
      userId,
      name: data.name,
      type: data.type,
      balance: balanceMilliunits,
      clearedBalance: balanceMilliunits,
    })
    .returning()

  // Create a starting balance transaction so it appears in the register
  if (balanceMilliunits !== 0) {
    await db.insert(transactions).values({
      userId,
      accountId: account.id,
      date: new Date().toISOString().substring(0, 10),
      payee: 'Starting Balance',
      amount: balanceMilliunits,
      cleared: true,
    })
  }

  // Auto-create CC Payment category for new credit card accounts
  if (data.type === 'credit_card') {
    const group = await getOrCreateCCPaymentGroup(userId)
    const [maxRow] = await db
      .select({ val: max(categories.sortOrder) })
      .from(categories)
      .where(eq(categories.groupId, group.id))
    await db.insert(categories).values({
      userId,
      groupId: group.id,
      name: account.name,
      ccAccountId: account.id,
      sortOrder: (maxRow?.val ?? -1) + 1,
    })
    revalidatePath('/budget')
  }

  revalidatePath('/accounts')
  return account
}

// ---------------------------------------------------------------------------
// Transactions
// ---------------------------------------------------------------------------
export async function addTransaction(data: {
  accountId: string
  categoryId?: string | null
  date: string
  payee: string
  amountDollars: string // user-entered, e.g. "-45.00" or "45.00"
  memo?: string
  isOutflow: boolean // if true, negate the amount
}) {
  const userId = await requireUser()

  // Verify this account belongs to the user
  const account = await db.query.accounts.findFirst({
    where: and(eq(accounts.id, data.accountId), eq(accounts.userId, userId)),
  })
  if (!account) throw new Error('Account not found')

  const rawDollars = parseFloat(data.amountDollars.replace(/[$,]/g, '')) || 0
  const amountMilliunits = data.isOutflow
    ? -Math.abs(Math.round(rawDollars * 1000))
    : Math.abs(Math.round(rawDollars * 1000))

  const [txn] = await db
    .insert(transactions)
    .values({
      userId,
      accountId: data.accountId,
      categoryId: data.categoryId ?? null,
      date: data.date,
      payee: data.payee || null,
      amount: amountMilliunits,
      memo: data.memo || null,
    })
    .returning()

  // Learn payee → category mapping
  await learnPayeeRule(userId, data.payee, data.categoryId ?? null)

  // Update account balance
  await db
    .update(accounts)
    .set({ balance: account.balance + amountMilliunits })
    .where(eq(accounts.id, account.id))

  const month = data.date.substring(0, 7)
  revalidatePath(`/budget/${month}`)
  revalidatePath('/accounts')
  revalidatePath(`/accounts/${data.accountId}`)
  return txn
}

export async function updateTransaction(id: string, data: {
  accountId: string
  categoryId?: string | null
  date: string
  payee: string
  amountDollars: string
  memo?: string
  isOutflow: boolean
}) {
  const userId = await requireUser()

  const txn = await db.query.transactions.findFirst({
    where: and(eq(transactions.id, id), eq(transactions.userId, userId)),
  })
  if (!txn) throw new Error('Transaction not found')

  const account = await db.query.accounts.findFirst({
    where: and(eq(accounts.id, txn.accountId), eq(accounts.userId, userId)),
  })
  if (!account) throw new Error('Account not found')

  const rawDollars = parseFloat(data.amountDollars.replace(/[$,]/g, '')) || 0
  const newAmount = data.isOutflow
    ? -Math.abs(Math.round(rawDollars * 1000))
    : Math.abs(Math.round(rawDollars * 1000))

  const balanceDelta = newAmount - txn.amount

  await db
    .update(transactions)
    .set({
      categoryId: data.categoryId ?? null,
      date: data.date,
      payee: data.payee || null,
      amount: newAmount,
      memo: data.memo || null,
      updatedAt: new Date(),
    })
    .where(eq(transactions.id, id))

  await db
    .update(accounts)
    .set({
      balance: account.balance + balanceDelta,
      ...(txn.cleared ? { clearedBalance: account.clearedBalance + balanceDelta } : {}),
    })
    .where(eq(accounts.id, account.id))

  // Learn payee → category mapping
  await learnPayeeRule(userId, data.payee, data.categoryId ?? null)

  const oldMonth = txn.date.substring(0, 7)
  const newMonth = data.date.substring(0, 7)
  revalidatePath(`/budget/${oldMonth}`)
  if (newMonth !== oldMonth) revalidatePath(`/budget/${newMonth}`)
  revalidatePath('/accounts')
  revalidatePath(`/accounts/${txn.accountId}`)
}

export async function updateTransactionCategory(id: string, categoryId: string | null) {
  const userId = await requireUser()

  const txn = await db.query.transactions.findFirst({
    where: and(eq(transactions.id, id), eq(transactions.userId, userId)),
  })
  if (!txn) throw new Error('Transaction not found')

  await db
    .update(transactions)
    .set({ categoryId, updatedAt: new Date() })
    .where(eq(transactions.id, id))

  // Learn payee → category mapping
  await learnPayeeRule(userId, txn.payee ?? '', categoryId)

  const month = txn.date.substring(0, 7)
  revalidatePath(`/budget/${month}`)
  revalidatePath(`/accounts/${txn.accountId}`)
}

export async function toggleCleared(id: string) {
  const userId = await requireUser()

  const txn = await db.query.transactions.findFirst({
    where: and(eq(transactions.id, id), eq(transactions.userId, userId)),
  })
  if (!txn) throw new Error('Transaction not found')

  const nowCleared = !txn.cleared

  await db
    .update(transactions)
    .set({ cleared: nowCleared })
    .where(eq(transactions.id, id))

  // Update clearedBalance: add amount if newly cleared, subtract if uncleared
  const delta = nowCleared ? txn.amount : -txn.amount
  await db
    .update(accounts)
    .set({ clearedBalance: sql`cleared_balance + ${delta}` })
    .where(and(eq(accounts.id, txn.accountId), eq(accounts.userId, userId)))

  revalidatePath(`/accounts/${txn.accountId}`)
  revalidatePath('/accounts')
}

export async function deleteTransaction(id: string) {
  const userId = await requireUser()

  const txn = await db.query.transactions.findFirst({
    where: and(eq(transactions.id, id), eq(transactions.userId, userId)),
  })
  if (!txn) throw new Error('Transaction not found')

  const account = await db.query.accounts.findFirst({
    where: eq(accounts.id, txn.accountId),
  })

  await db.delete(transactions).where(eq(transactions.id, id))

  if (account) {
    await db
      .update(accounts)
      .set({
        balance: account.balance - txn.amount,
        ...(txn.cleared ? { clearedBalance: account.clearedBalance - txn.amount } : {}),
      })
      .where(eq(accounts.id, txn.accountId))
  }

  const month = txn.date.substring(0, 7)
  revalidatePath(`/budget/${month}`)
  revalidatePath('/accounts')
  revalidatePath(`/accounts/${txn.accountId}`)
}

export async function updateAccount(id: string, data: { name: string; type: string }) {
  const userId = await requireUser()
  if (!data.name.trim()) throw new Error('Name is required')

  await db
    .update(accounts)
    .set({ name: data.name.trim(), type: data.type })
    .where(and(eq(accounts.id, id), eq(accounts.userId, userId)))

  // Keep linked CC Payment category name in sync
  if (data.type === 'credit_card') {
    await db
      .update(categories)
      .set({ name: data.name.trim() })
      .where(and(eq(categories.userId, userId), eq(categories.ccAccountId, id)))
    revalidatePath('/budget')
  }

  revalidatePath('/accounts')
  revalidatePath(`/accounts/${id}`)
}

export async function closeAccount(id: string) {
  const userId = await requireUser()

  const account = await db.query.accounts.findFirst({
    where: and(eq(accounts.id, id), eq(accounts.userId, userId)),
  })
  if (!account) throw new Error('Account not found')

  await db
    .update(accounts)
    .set({ closed: !account.closed })
    .where(and(eq(accounts.id, id), eq(accounts.userId, userId)))

  revalidatePath('/accounts')
  revalidatePath(`/accounts/${id}`)
}

export async function deleteAccount(id: string) {
  const userId = await requireUser()

  const account = await db.query.accounts.findFirst({
    where: and(eq(accounts.id, id), eq(accounts.userId, userId)),
  })
  if (!account) throw new Error('Account not found')

  // Delete linked CC Payment category before deleting the account
  // (ccAccountId will become null via onDelete:set null, so we delete it explicitly first)
  if (account.type === 'credit_card') {
    const ccCat = await db.query.categories.findFirst({
      where: and(eq(categories.userId, userId), eq(categories.ccAccountId, id)),
    })
    if (ccCat) {
      await db.delete(categories).where(eq(categories.id, ccCat.id))
      // Clean up empty CC Payment group
      const [remaining] = await db
        .select({ cnt: count(categories.id) })
        .from(categories)
        .where(eq(categories.groupId, ccCat.groupId))
      if ((remaining?.cnt ?? 0) === 0) {
        await db.delete(categoryGroups).where(eq(categoryGroups.id, ccCat.groupId))
      }
      revalidatePath('/budget')
    }
  }

  // Transactions are cascade-deleted by the DB (onDelete: 'cascade').
  await db
    .delete(accounts)
    .where(and(eq(accounts.id, id), eq(accounts.userId, userId)))

  revalidatePath('/accounts')
  revalidatePath('/')
}

// ---------------------------------------------------------------------------
// Category groups
// ---------------------------------------------------------------------------
export async function addCategoryGroup(name: string, isIncome = false) {
  const userId = await requireUser()
  if (!name.trim()) throw new Error('Name is required')

  const [maxRow] = await db
    .select({ val: max(categoryGroups.sortOrder) })
    .from(categoryGroups)
    .where(eq(categoryGroups.userId, userId))

  const sortOrder = (maxRow?.val ?? -1) + 1

  const [group] = await db
    .insert(categoryGroups)
    .values({ userId, name: name.trim(), isIncome, isTransfer: false, sortOrder })
    .returning()

  revalidatePath('/budget')
  return group
}

export async function moveCategoryGroup(id: string, direction: 'up' | 'down') {
  const userId = await requireUser()

  const group = await db.query.categoryGroups.findFirst({
    where: and(eq(categoryGroups.id, id), eq(categoryGroups.userId, userId)),
  })
  if (!group) return

  // Get all groups of the same type, ordered by sortOrder
  const sameType = await db
    .select({ id: categoryGroups.id, sortOrder: categoryGroups.sortOrder })
    .from(categoryGroups)
    .where(and(
      eq(categoryGroups.userId, userId),
      eq(categoryGroups.isIncome, group.isIncome),
      eq(categoryGroups.isTransfer, group.isTransfer),
    ))
    .orderBy(asc(categoryGroups.sortOrder))

  const idx = sameType.findIndex((g) => g.id === id)
  const targetIdx = direction === 'up' ? idx - 1 : idx + 1
  if (targetIdx < 0 || targetIdx >= sameType.length) return

  // Swap in array, then reassign all sortOrders (normalizes duplicates too)
  ;[sameType[idx], sameType[targetIdx]] = [sameType[targetIdx], sameType[idx]]
  await Promise.all(
    sameType.map((g, i) =>
      db.update(categoryGroups)
        .set({ sortOrder: i })
        .where(eq(categoryGroups.id, g.id))
    )
  )

  revalidatePath('/budget')
}

export async function moveCategory(id: string, direction: 'up' | 'down') {
  const userId = await requireUser()

  const cat = await db.query.categories.findFirst({
    where: and(eq(categories.id, id), eq(categories.userId, userId)),
  })
  if (!cat) return

  // Get all categories in the same group, ordered by sortOrder
  const siblings = await db
    .select({ id: categories.id, sortOrder: categories.sortOrder })
    .from(categories)
    .where(and(eq(categories.groupId, cat.groupId), eq(categories.userId, userId)))
    .orderBy(asc(categories.sortOrder))

  const idx = siblings.findIndex((c) => c.id === id)
  const targetIdx = direction === 'up' ? idx - 1 : idx + 1
  if (targetIdx < 0 || targetIdx >= siblings.length) return

  // Swap in array, then reassign all sortOrders (normalizes duplicates too)
  ;[siblings[idx], siblings[targetIdx]] = [siblings[targetIdx], siblings[idx]]
  await Promise.all(
    siblings.map((c, i) =>
      db.update(categories)
        .set({ sortOrder: i })
        .where(eq(categories.id, c.id))
    )
  )

  revalidatePath('/budget')
}

export async function reorderGroups(ids: string[]) {
  const userId = await requireUser()
  await Promise.all(
    ids.map((id, i) =>
      db.update(categoryGroups)
        .set({ sortOrder: i })
        .where(and(eq(categoryGroups.id, id), eq(categoryGroups.userId, userId)))
    )
  )
  revalidatePath('/budget')
}

export async function reorderCategories(ids: string[]) {
  const userId = await requireUser()
  await Promise.all(
    ids.map((id, i) =>
      db.update(categories)
        .set({ sortOrder: i })
        .where(and(eq(categories.id, id), eq(categories.userId, userId)))
    )
  )
  revalidatePath('/budget')
}

export async function renameCategoryGroup(id: string, name: string) {
  const userId = await requireUser()
  if (!name.trim()) throw new Error('Name is required')

  await db
    .update(categoryGroups)
    .set({ name: name.trim() })
    .where(and(eq(categoryGroups.id, id), eq(categoryGroups.userId, userId)))

  revalidatePath('/budget')
}

export async function deleteCategoryGroup(id: string) {
  const userId = await requireUser()

  const [row] = await db
    .select({ val: count(categories.id) })
    .from(categories)
    .where(and(eq(categories.groupId, id), eq(categories.userId, userId)))

  if ((row?.val ?? 0) > 0) throw new Error('Remove all categories first')

  await db
    .delete(categoryGroups)
    .where(and(eq(categoryGroups.id, id), eq(categoryGroups.userId, userId)))

  revalidatePath('/budget')
}

// ---------------------------------------------------------------------------
// Categories
// ---------------------------------------------------------------------------
export async function addCategory(groupId: string, name: string) {
  const userId = await requireUser()
  if (!name.trim()) throw new Error('Name is required')

  // Verify group belongs to user
  const group = await db.query.categoryGroups.findFirst({
    where: and(eq(categoryGroups.id, groupId), eq(categoryGroups.userId, userId)),
  })
  if (!group) throw new Error('Group not found')

  const [maxRow] = await db
    .select({ val: max(categories.sortOrder) })
    .from(categories)
    .where(and(eq(categories.groupId, groupId), eq(categories.userId, userId)))

  const sortOrder = (maxRow?.val ?? -1) + 1

  const [cat] = await db
    .insert(categories)
    .values({ userId, groupId, name: name.trim(), sortOrder })
    .returning()

  revalidatePath('/budget')
  return cat
}

export async function renameCategory(id: string, name: string) {
  const userId = await requireUser()
  if (!name.trim()) throw new Error('Name is required')

  await db
    .update(categories)
    .set({ name: name.trim() })
    .where(and(eq(categories.id, id), eq(categories.userId, userId)))

  revalidatePath('/budget')
}

export async function deleteCategory(id: string) {
  const userId = await requireUser()

  const [txnRow] = await db
    .select({ val: count(transactions.id) })
    .from(transactions)
    .where(and(eq(transactions.categoryId, id), eq(transactions.userId, userId)))

  if ((txnRow?.val ?? 0) > 0) throw new Error('Category has transactions — reassign them first')

  const [budgetRow] = await db
    .select({ val: count(monthBudgets.id) })
    .from(monthBudgets)
    .where(and(eq(monthBudgets.categoryId, id), eq(monthBudgets.userId, userId), sql`${monthBudgets.budgeted} != 0`))

  if ((budgetRow?.val ?? 0) > 0) throw new Error('Category has budget allocations — clear them first')

  await db
    .delete(categories)
    .where(and(eq(categories.id, id), eq(categories.userId, userId)))

  revalidatePath('/budget')
}

// ---------------------------------------------------------------------------
// CSV Import
// ---------------------------------------------------------------------------
export interface CsvRow {
  date: string        // 'YYYY-MM-DD'
  payee: string
  amount: number      // milliunits, negative = outflow
  memo?: string
  importId: string    // dedup key
}

export async function importTransactions(
  accountId: string,
  rows: CsvRow[],
): Promise<{ imported: number; skipped: number }> {
  const userId = await requireUser()

  const account = await db.query.accounts.findFirst({
    where: and(eq(accounts.id, accountId), eq(accounts.userId, userId)),
  })
  if (!account) throw new Error('Account not found')

  let imported = 0
  let skipped = 0
  let balanceDelta = 0

  for (const row of rows) {
    const result = await db
      .insert(transactions)
      .values({
        userId,
        accountId,
        date: row.date,
        payee: row.payee || null,
        amount: row.amount,
        memo: row.memo || null,
        importId: row.importId,
        cleared: true,
      })
      .onConflictDoNothing({ target: transactions.importId })
      .returning({ id: transactions.id })

    if (result.length > 0) {
      imported++
      balanceDelta += row.amount
    } else {
      skipped++
    }
  }

  if (balanceDelta !== 0) {
    await db
      .update(accounts)
      .set({
        balance: account.balance + balanceDelta,
        clearedBalance: account.clearedBalance + balanceDelta,
      })
      .where(eq(accounts.id, accountId))
  }

  revalidatePath('/accounts')
  revalidatePath(`/accounts/${accountId}`)
  return { imported, skipped }
}

// ---------------------------------------------------------------------------
// Payee rules — bulk back-fill
// ---------------------------------------------------------------------------
/**
 * Re-applies payee rules to all uncategorized transactions for this user.
 *
 * Rather than trusting the payee_rules table (which may contain keys from an
 * older normaliser or per-order merchant codes), we rebuild the rule map live
 * from every already-categorized transaction.  This means:
 *   - "Amazon.com*ABC123" and "Amazon.com*XYZ789" both resolve to "amazon com"
 *     and share a single rule, regardless of what is stored in payee_rules.
 *   - Rules saved with a previous normaliser are auto-corrected on each run.
 *
 * We also persist the rebuilt rules back to payee_rules so the sync route can
 * apply them to incoming transactions without re-scanning all history.
 */
export async function applyPayeeRules(): Promise<{ updated: number; scanned: number; rules: number }> {
  const userId = await requireUser()

  // Step 1 — Build a fresh rule map from every categorized transaction
  const categorized = await db
    .select({ payee: transactions.payee, categoryId: transactions.categoryId })
    .from(transactions)
    .where(and(
      eq(transactions.userId, userId),
      isNotNull(transactions.categoryId),
    ))

  const freshMap = new Map<string, string>()
  for (const txn of categorized) {
    if (!txn.payee || !txn.categoryId) continue
    const key = normalizePayee(txn.payee)
    if (key) freshMap.set(key, txn.categoryId)
  }

  if (freshMap.size === 0) return { updated: 0, scanned: 0, rules: 0 }

  // Step 2 — Persist fresh rules (upsert) so sync can use them going forward
  for (const [key, categoryId] of freshMap) {
    await db
      .insert(payeeRules)
      .values({ userId, payeeNormalized: key, categoryId })
      .onConflictDoUpdate({
        target: [payeeRules.userId, payeeRules.payeeNormalized],
        set: { categoryId, updatedAt: new Date() },
      })
  }

  // Step 3 — Apply to uncategorized transactions
  const uncategorized = await db
    .select({ id: transactions.id, payee: transactions.payee, accountId: transactions.accountId, date: transactions.date })
    .from(transactions)
    .where(and(
      eq(transactions.userId, userId),
      isNull(transactions.categoryId),
    ))

  let updated = 0
  const affectedAccounts = new Set<string>()
  const affectedMonths = new Set<string>()

  for (const txn of uncategorized) {
    if (!txn.payee) continue
    const key = normalizePayee(txn.payee)
    const categoryId = freshMap.get(key)
    if (!categoryId) continue

    await db
      .update(transactions)
      .set({ categoryId, updatedAt: new Date() })
      .where(eq(transactions.id, txn.id))

    updated++
    affectedAccounts.add(txn.accountId)
    affectedMonths.add(txn.date.substring(0, 7))
  }

  for (const accountId of affectedAccounts) {
    revalidatePath(`/accounts/${accountId}`)
  }
  for (const month of affectedMonths) {
    revalidatePath(`/budget/${month}`)
  }

  return { updated, scanned: uncategorized.length, rules: freshMap.size }
}

// ---------------------------------------------------------------------------
// Recategorize all transactions for a payee
// ---------------------------------------------------------------------------
/**
 * Updates the category on EVERY transaction whose normalized payee matches
 * the given payee string.  Used for the "Apply to all" prompt.
 */
export async function recategorizePayee(
  payee: string,
  categoryId: string | null,
): Promise<{ updated: number }> {
  const userId = await requireUser()
  const key = normalizePayee(payee)
  if (!key) return { updated: 0 }

  // Persist / update the payee rule
  await learnPayeeRule(userId, payee, categoryId)

  // Fetch all transactions for this user and filter by normalized payee in JS
  // (normalizePayee is a JS function so we can't push the predicate to SQL)
  const allTxns = await db
    .select({ id: transactions.id, accountId: transactions.accountId, date: transactions.date, payee: transactions.payee })
    .from(transactions)
    .where(eq(transactions.userId, userId))

  const matching = allTxns.filter(
    (t) => t.payee && normalizePayee(t.payee) === key,
  )
  if (matching.length === 0) return { updated: 0 }

  await db
    .update(transactions)
    .set({ categoryId, updatedAt: new Date() })
    .where(inArray(transactions.id, matching.map((t) => t.id)))

  const affectedAccounts = new Set(matching.map((t) => t.accountId))
  const affectedMonths = new Set(matching.map((t) => t.date.substring(0, 7)))
  for (const accountId of affectedAccounts) revalidatePath(`/accounts/${accountId}`)
  for (const month of affectedMonths) revalidatePath(`/budget/${month}`)
  revalidatePath('/accounts')

  return { updated: matching.length }
}

// ---------------------------------------------------------------------------
// Budget assignments
// ---------------------------------------------------------------------------
export async function setBudgeted(categoryId: string, month: string, amountMilliunits: number) {
  const userId = await requireUser()

  if (!/^\d{4}-\d{2}$/.test(month)) throw new Error('Invalid month format')

  // Verify category belongs to user
  const cat = await db.query.categories.findFirst({
    where: and(eq(categories.id, categoryId), eq(categories.userId, userId)),
  })
  if (!cat) throw new Error('Category not found')

  await db
    .insert(monthBudgets)
    .values({ userId, categoryId, month, budgeted: Math.round(amountMilliunits) })
    .onConflictDoUpdate({
      target: [monthBudgets.userId, monthBudgets.categoryId, monthBudgets.month],
      set: { budgeted: Math.round(amountMilliunits) },
    })

  revalidatePath(`/budget/${month}`)
}
