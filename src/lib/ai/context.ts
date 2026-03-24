import { and, asc, eq, gte, lt, inArray } from 'drizzle-orm'
import { db } from '@/db'
import { accounts, monthBudgets, transactions, categories, categoryGroups } from '@/db/schema'
import { firstDayOfNextMonth } from '@/lib/budget'

export async function buildMonthlyContext(userId: string, month: string) {
  const monthStart = `${month}-01`
  const monthEnd = firstDayOfNextMonth(month)

  const userAccounts = await db
    .select({ id: accounts.id, name: accounts.name, type: accounts.type, balance: accounts.balance })
    .from(accounts)
    .where(eq(accounts.userId, userId))
    .orderBy(asc(accounts.sortOrder))

  const categoryRows = await db
    .select({
      id: categories.id,
      name: categories.name,
      groupName: categoryGroups.name,
      isIncome: categoryGroups.isIncome,
      isTransfer: categoryGroups.isTransfer,
      isSystem: categoryGroups.isSystem,
    })
    .from(categories)
    .leftJoin(categoryGroups, eq(categories.groupId, categoryGroups.id))
    .where(eq(categories.userId, userId))

  const budgets = await db
    .select({ categoryId: monthBudgets.categoryId, budgeted: monthBudgets.budgeted })
    .from(monthBudgets)
    .where(and(eq(monthBudgets.userId, userId), eq(monthBudgets.month, month)))

  const onBudgetTypes = ['checking', 'savings', 'cash', 'credit_card']
  const onBudgetIds = userAccounts.filter((a) => onBudgetTypes.includes(a.type)).map((a) => a.id)

  const txns = onBudgetIds.length === 0
    ? []
    : await db
        .select({
          id: transactions.id,
          date: transactions.date,
          amount: transactions.amount,
          categoryId: transactions.categoryId,
          isTransfer: transactions.isTransfer,
        })
        .from(transactions)
        .where(and(
          eq(transactions.userId, userId),
          inArray(transactions.accountId, onBudgetIds),
          gte(transactions.date, monthStart),
          lt(transactions.date, monthEnd),
        ))

  const budgetMap = new Map(budgets.map((b) => [b.categoryId, b.budgeted]))
  const catMap = new Map(categoryRows.map((c) => [c.id, c]))

  let inflows = 0
  let outflows = 0
  let categorizedSpend = 0
  for (const t of txns) {
    if (t.isTransfer) continue
    if (t.amount > 0) inflows += t.amount
    if (t.amount < 0) outflows += Math.abs(t.amount)
    if (t.amount < 0 && t.categoryId) categorizedSpend += Math.abs(t.amount)
  }

  const expenseBudgeted = categoryRows
    .filter((c) => !c.isIncome && !c.isTransfer && !c.isSystem)
    .reduce((sum, c) => sum + (budgetMap.get(c.id) ?? 0), 0)

  const debtAccounts = userAccounts
    .filter((a) => a.type === 'credit_card' || a.type === 'loan')
    .map((a) => ({ ...a, owed: Math.abs(Math.min(0, a.balance)) }))

  return {
    month,
    accounts: userAccounts,
    totals: {
      inflows,
      outflows,
      categorizedSpend,
      expenseBudgeted,
    },
    debtAccounts,
    transactionCount: txns.length,
    categoryCount: categoryRows.length,
    generatedAt: new Date().toISOString(),
    topExpenseCategories: categoryRows
      .filter((c) => !c.isIncome && !c.isTransfer && !c.isSystem)
      .slice(0, 15)
      .map((c) => ({
        id: c.id,
        name: c.name,
        groupName: c.groupName ?? 'Uncategorized',
        budgeted: budgetMap.get(c.id) ?? 0,
      })),
    _catMapSize: catMap.size,
  }
}
