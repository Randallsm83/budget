import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@/auth'
import { db } from '@/db'
import { accounts, transactions, monthBudgets, categories, categoryGroups } from '@/db/schema'
import { and, eq, gte, lt, inArray } from 'drizzle-orm'
import { firstDayOfNextMonth } from '@/lib/budget'
import { appLog } from '@/lib/logger'

export async function POST(req: NextRequest) {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const userId = session.user.id

  const body = await req.json().catch(() => null) as { month?: string } | null
  const month = body?.month?.trim()
  if (!month || !/^\d{4}-\d{2}$/.test(month)) {
    return NextResponse.json({ error: 'month must be YYYY-MM' }, { status: 400 })
  }

  try {
  const monthStart = `${month}-01`
  const monthEnd = firstDayOfNextMonth(month)

  // Spending pace for the current month
  const [y, mo] = month.split('-').map(Number)
  const today = new Date()
  const isCurrentMonth = today.getFullYear() === y && today.getMonth() + 1 === mo
  const daysInMonth = new Date(y, mo, 0).getDate()
  const daysElapsed = isCurrentMonth ? today.getDate() : daysInMonth
  const pacePct = daysElapsed / daysInMonth

  const ON_BUDGET_TYPES = ['checking', 'savings', 'cash', 'credit_card']

  const userAccounts = await db
    .select({ id: accounts.id, type: accounts.type })
    .from(accounts)
    .where(and(eq(accounts.userId, userId), inArray(accounts.type, ON_BUDGET_TYPES)))

  const onBudgetIds = userAccounts.map((a) => a.id)

  if (onBudgetIds.length === 0) {
    return NextResponse.json({ categories: [], pace: { daysElapsed, daysInMonth, pacePercent: Math.round(pacePct * 100) } })
  }

  // Fetch category metadata
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

  // Fetch current-month budgets
  const budgets = await db
    .select({ categoryId: monthBudgets.categoryId, budgeted: monthBudgets.budgeted })
    .from(monthBudgets)
    .where(and(eq(monthBudgets.userId, userId), eq(monthBudgets.month, month)))

  const budgetMap = new Map(budgets.map((b) => [b.categoryId, b.budgeted]))

  // Fetch current-month transactions
  const txns = await db
    .select({
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

  // Per-category spending for this month
  const spentMap: Record<string, number> = {}
  for (const t of txns) {
    if (t.isTransfer || !t.categoryId || t.amount >= 0) continue
    spentMap[t.categoryId] = (spentMap[t.categoryId] ?? 0) + Math.abs(t.amount)
  }

  const toDollars = (mu: number) => parseFloat((mu / 1000).toFixed(2))

  // Build forecast rows for expense categories with a non-zero budget or spending
  const rows = categoryRows
    .filter((c) => !c.isIncome && !c.isTransfer && !c.isSystem)
    .map((c) => {
      const budgetedMu = budgetMap.get(c.id) ?? 0
      const spentMu = spentMap[c.id] ?? 0
      // Extrapolate ongoing spending, but not one-time charges.
      // If spending is already > pace + 15 percentage points ahead of schedule,
      // the category was likely paid in one shot (rent, mortgage, subscriptions).
      // Projecting it higher would produce false over-budget warnings.
      const pctUsed = budgetedMu > 0 ? spentMu / budgetedMu : 0
      const shouldExtrapolate = pacePct > 0 && spentMu < budgetedMu && pctUsed < pacePct + 0.15
      const projectedMu = shouldExtrapolate ? Math.round(spentMu / pacePct) : spentMu
      const overspendMu = projectedMu - budgetedMu
      return {
        categoryId: c.id,
        name: c.name,
        groupName: c.groupName ?? '',
        budgetedDollars: toDollars(budgetedMu),
        spentDollars: toDollars(spentMu),
        projectedDollars: toDollars(projectedMu),
        // positive = projected to exceed budget; negative = projected under
        projectedOverspendDollars: toDollars(overspendMu),
        pctUsed: budgetedMu > 0 ? parseFloat(((spentMu / budgetedMu) * 100).toFixed(1)) : null,
      }
    })
    .filter((r) => r.budgetedDollars > 0 || r.spentDollars > 0)
    // Sort: most over-budget first, then by spend
    .sort((a, b) => b.projectedOverspendDollars - a.projectedOverspendDollars)
    .slice(0, 8)

  return NextResponse.json({
    categories: rows,
    pace: { daysElapsed, daysInMonth, pacePercent: parseFloat((pacePct * 100).toFixed(1)) },
  })
  } catch (e) {
    appLog('error', '/api/ai/forecast', e instanceof Error ? e.message : 'Forecast failed', { userId, metadata: { month } })
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Forecast failed' }, { status: 500 })
  }
}
