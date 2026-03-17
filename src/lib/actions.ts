'use server'

import { revalidatePath } from 'next/cache'
import { and, eq, max, count, sql } from 'drizzle-orm'
import { auth } from '@/auth'
import { db } from '@/db'
import { accounts, categories, categoryGroups, monthBudgets, transactions } from '@/db/schema'

// ---------------------------------------------------------------------------
// Auth helper
// ---------------------------------------------------------------------------
async function requireUser(): Promise<string> {
  const session = await auth()
  if (!session?.user?.id) throw new Error('Not authenticated')
  return session.user.id
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

  const oldMonth = txn.date.substring(0, 7)
  const newMonth = data.date.substring(0, 7)
  revalidatePath(`/budget/${oldMonth}`)
  if (newMonth !== oldMonth) revalidatePath(`/budget/${newMonth}`)
  revalidatePath('/accounts')
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

  const [row] = await db
    .select({ val: count(transactions.id) })
    .from(transactions)
    .where(and(eq(transactions.accountId, id), eq(transactions.userId, userId)))

  if ((row?.val ?? 0) > 0) throw new Error('Account has transactions — delete them first')

  await db
    .delete(accounts)
    .where(and(eq(accounts.id, id), eq(accounts.userId, userId)))

  revalidatePath('/accounts')
}

// ---------------------------------------------------------------------------
// Category groups
// ---------------------------------------------------------------------------
export async function addCategoryGroup(name: string) {
  const userId = await requireUser()
  if (!name.trim()) throw new Error('Name is required')

  const [maxRow] = await db
    .select({ val: max(categoryGroups.sortOrder) })
    .from(categoryGroups)
    .where(eq(categoryGroups.userId, userId))

  const sortOrder = (maxRow?.val ?? -1) + 1

  const [group] = await db
    .insert(categoryGroups)
    .values({ userId, name: name.trim(), sortOrder })
    .returning()

  revalidatePath('/budget')
  return group
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
