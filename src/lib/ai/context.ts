import { and, asc, eq, gte, lt, inArray } from 'drizzle-orm'
import { db } from '@/db'
import { accounts, monthBudgets, transactions, categories, categoryGroups, liabilityDetails } from '@/db/schema'
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
          payee: transactions.payee,
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

  // All DB amounts are INTEGER MILLIUNITS (1000 = $1.00). Convert to dollars for the AI.
  const toDollars = (mu: number) => parseFloat((mu / 1000).toFixed(2))

  // Per-category activity for this month
  const activityByCat: Record<string, number> = {}
  let inflowsMu = 0
  let outflowsMu = 0
  let categorizedSpendMu = 0
  const incomeByCat: Record<string, number> = {}

  for (const t of txns) {
    if (t.isTransfer) continue
    if (t.amount > 0) inflowsMu += t.amount
    if (t.amount < 0) outflowsMu += Math.abs(t.amount)
    if (t.categoryId) {
      activityByCat[t.categoryId] = (activityByCat[t.categoryId] ?? 0) + t.amount
      if (t.amount < 0) categorizedSpendMu += Math.abs(t.amount)
    }
  }

  // Categorize income activity
  const incomeCatIds = new Set(
    categoryRows.filter((c) => c.isIncome).map((c) => c.id)
  )
  for (const [catId, amt] of Object.entries(activityByCat)) {
    if (incomeCatIds.has(catId) && amt > 0) incomeByCat[catId] = amt
  }

  const expenseBudgetedMu = categoryRows
    .filter((c) => !c.isIncome && !c.isTransfer && !c.isSystem)
    .reduce((sum, c) => sum + (budgetMap.get(c.id) ?? 0), 0)

  // Liability details (APR, minimum payment) for debt accounts
  const debtAccountIds = userAccounts
    .filter((a) => a.type === 'credit_card' || a.type === 'loan')
    .map((a) => a.id)

  const liabilities = debtAccountIds.length > 0
    ? await db
        .select()
        .from(liabilityDetails)
        .where(inArray(liabilityDetails.accountId, debtAccountIds))
    : []
  const liabilityByAccount = new Map(liabilities.map((l) => [l.accountId, l.details as Record<string, unknown>]))

  const debtAccounts = userAccounts
    .filter((a) => a.type === 'credit_card' || a.type === 'loan')
    .map((a) => {
      const details = liabilityByAccount.get(a.id)
      return {
        name: a.name,
        type: a.type,
        balanceDollars: toDollars(a.balance),
        owedDollars: toDollars(Math.abs(Math.min(0, a.balance))),
        aprPercent: (details?.aprs as Array<{apr_percentage?: number}> | undefined)?.[0]?.apr_percentage ?? null,
        minimumPaymentDollars: typeof details?.minimum_payment_amount === 'number'
          ? toDollars(details.minimum_payment_amount as number)
          : null,
      }
    })

  // Expense categories: budget vs actual, sorted by overspend first
  const expenseCategories = categoryRows
    .filter((c) => !c.isIncome && !c.isTransfer && !c.isSystem)
    .map((c) => {
      const budgetedMu = budgetMap.get(c.id) ?? 0
      const activityMu = activityByCat[c.id] ?? 0 // negative = spending
      const spentMu = Math.abs(Math.min(0, activityMu))
      return {
        name: c.name,
        groupName: c.groupName ?? 'Uncategorized',
        budgetedDollars: toDollars(budgetedMu),
        spentDollars: toDollars(spentMu),
        remainingDollars: toDollars(budgetedMu + activityMu), // positive = under budget
      }
    })
    .filter((c) => c.budgetedDollars > 0 || c.spentDollars > 0) // only categories with activity
    .sort((a, b) => (a.remainingDollars - b.remainingDollars)) // overspent first
    .slice(0, 20)

  // Income sources with actual received amounts (categorized)
  const incomeCategories = categoryRows
    .filter((c) => c.isIncome)
    .map((c) => ({
      name: c.name,
      receivedDollars: toDollars(incomeByCat[c.id] ?? 0),
    }))
    .filter((c) => c.receivedDollars > 0)

  // Uncategorized inflows — group by payee so AI can identify income sources
  const uncategorizedInflowsByPayee: Record<string, number> = {}
  for (const t of txns) {
    if (t.isTransfer || t.categoryId || t.amount <= 0) continue
    const payee = t.payee?.trim() || 'Unknown'
    uncategorizedInflowsByPayee[payee] = (uncategorizedInflowsByPayee[payee] ?? 0) + t.amount
  }
  const uncategorizedInflows = Object.entries(uncategorizedInflowsByPayee)
    .map(([payee, mu]) => ({ payee, totalDollars: toDollars(mu) }))
    .sort((a, b) => b.totalDollars - a.totalDollars)
    .slice(0, 10)

  return {
    month,
    note: 'All dollar amounts are in USD. Do not re-scale them.',
    totals: {
      inflowsDollars: toDollars(inflowsMu),
      outflowsDollars: toDollars(outflowsMu),
      categorizedSpendDollars: toDollars(categorizedSpendMu),
      expenseBudgetedDollars: toDollars(expenseBudgetedMu),
      surplusOrDeficitDollars: toDollars(inflowsMu - outflowsMu),
    },
    incomeCategories,
    uncategorizedInflows,
    expenseCategories,
    debtAccounts,
    liquidAccounts: userAccounts
      .filter((a) => ['checking', 'savings', 'cash'].includes(a.type))
      .map((a) => ({ name: a.name, balanceDollars: toDollars(a.balance) })),
    transactionCount: txns.length,
    generatedAt: new Date().toISOString(),
  }
}
