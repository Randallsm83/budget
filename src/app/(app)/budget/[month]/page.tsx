import { auth } from '@/auth'
import { db } from '@/db'
import { transactions, monthBudgets, categoryGroups, categories } from '@/db/schema'
import { asc, and, eq, lt, lte } from 'drizzle-orm'
import Link from 'next/link'
import { BudgetTable, type GroupRow } from '@/components/BudgetTable'
import {
  firstDayOfNextMonth,
  prevMonth,
  nextMonth,
  formatMonthDisplay,
  formatMoney,
} from '@/lib/budget'

interface Props {
  params: Promise<{ month: string }>
}

// Validate 'YYYY-MM' format
function isValidMonth(m: string) {
  return /^\d{4}-\d{2}$/.test(m)
}

export default async function BudgetPage({ params }: Props) {
  const { month } = await params

  if (!isValidMonth(month)) {
    return (
      <div className="p-8 text-[#ce6f8f]">
        Invalid month format. Expected YYYY-MM (e.g. 2026-03).
      </div>
    )
  }

  const session = await auth()
  const userId = session!.user.id
  const nextMonthStart = firstDayOfNextMonth(month)

  // -------------------------------------------------------------------------
  // Fetch all groups + categories (for structure)
  // -------------------------------------------------------------------------
  const groups = await db.query.categoryGroups.findMany({
    where: eq(categoryGroups.userId, userId),
    with: {
      categories: { orderBy: [asc(categories.sortOrder)] },
    },
    orderBy: [asc(categoryGroups.sortOrder)],
  })

  const allCategoryIds = groups.flatMap((g) => g.categories.map((c) => c.id))
  // Set of category IDs that belong to income groups
  const incomeCatIds = new Set(
    groups.filter((g) => g.isIncome).flatMap((g) => g.categories.map((c) => c.id))
  )

  // -------------------------------------------------------------------------
  // Fetch all transactions up to (but not including) next month start
  // -------------------------------------------------------------------------
  const allTxns = await db
    .select()
    .from(transactions)
    .where(and(eq(transactions.userId, userId), lt(transactions.date, nextMonthStart)))

  // -------------------------------------------------------------------------
  // Fetch all month_budgets up to and including target month
  // -------------------------------------------------------------------------
  const allBudgets = await db
    .select()
    .from(monthBudgets)
    .where(and(eq(monthBudgets.userId, userId), lte(monthBudgets.month, month)))

  // -------------------------------------------------------------------------
  // Build lookup maps
  // activityMap[month][categoryId] = sum of amounts (all categorized txns)
  // inflowMap[month]               = sum of uncategorized positive amounts
  // incomeMap[month]               = sum of income-category transactions → feeds RTA
  // -------------------------------------------------------------------------
  const activityMap: Record<string, Record<string, number>> = {}
  const inflowMap: Record<string, number> = {}
  const incomeMap: Record<string, number> = {}

  for (const txn of allTxns) {
    const txnMonth = txn.date.substring(0, 7)
    if (txn.categoryId) {
      activityMap[txnMonth] ??= {}
      activityMap[txnMonth][txn.categoryId] =
        (activityMap[txnMonth][txn.categoryId] ?? 0) + txn.amount
      // Income category transactions also feed RTA
      if (incomeCatIds.has(txn.categoryId)) {
        incomeMap[txnMonth] = (incomeMap[txnMonth] ?? 0) + txn.amount
      }
    } else if (txn.amount > 0) {
      inflowMap[txnMonth] = (inflowMap[txnMonth] ?? 0) + txn.amount
    }
  }

  const budgetMap: Record<string, Record<string, number>> = {}
  for (const b of allBudgets) {
    budgetMap[b.month] ??= {}
    budgetMap[b.month][b.categoryId] = b.budgeted
  }

  // -------------------------------------------------------------------------
  // Sort all months from earliest to target, then compute iteratively
  // -------------------------------------------------------------------------
  const allMonths = new Set<string>([month])
  allTxns.forEach((t) => allMonths.add(t.date.substring(0, 7)))
  allBudgets.forEach((b) => allMonths.add(b.month))
  const sortedMonths = [...allMonths].filter((m) => m <= month).sort()

  // Running state
  const balanceMap: Record<string, number> = {} // categoryId -> end-of-month balance
  let rta = 0 // ready-to-assign

  for (const m of sortedMonths) {
    const mActivity = activityMap[m] ?? {}
    const mBudget = budgetMap[m] ?? {}
    let totalExpenseBudgeted = 0

    for (const catId of allCategoryIds) {
      const isIncomeCat = incomeCatIds.has(catId)
      const activity = mActivity[catId] ?? 0
      const budgeted = mBudget[catId] ?? 0
      // Income: balance = received - expected. Expense: balance = budgeted + spending
      balanceMap[catId] = (balanceMap[catId] ?? 0) + (isIncomeCat ? activity - budgeted : budgeted + activity)
      if (!isIncomeCat) totalExpenseBudgeted += budgeted
    }

    // RTA = uncategorized inflows + income-category receipts - expense budgeted
    rta += (inflowMap[m] ?? 0) + (incomeMap[m] ?? 0) - totalExpenseBudgeted
  }

  // -------------------------------------------------------------------------
  // Build display rows for the target month
  // -------------------------------------------------------------------------
  const targetActivity = activityMap[month] ?? {}
  const targetBudget = budgetMap[month] ?? {}

  const resultGroups: GroupRow[] = groups.map((g) => {
    const cats = g.categories.map((cat) => ({
      id: cat.id,
      name: cat.name,
      budgeted: targetBudget[cat.id] ?? 0,
      activity: targetActivity[cat.id] ?? 0,
      balance: balanceMap[cat.id] ?? 0,
    }))
    return {
      id: g.id,
      name: g.name,
      isIncome: g.isIncome,
      categories: cats,
      totalBudgeted: cats.reduce((s, c) => s + c.budgeted, 0),
      totalActivity: cats.reduce((s, c) => s + c.activity, 0),
      totalBalance: cats.reduce((s, c) => s + c.balance, 0),
    }
  })

  return (
    <div className="flex flex-col h-full">
      {/* ── Month header bar ── */}
      <div className="flex-shrink-0 bg-[#1f2039] border-b border-[#3a3b58] px-6 py-3
                      flex items-center justify-between">
        {/* Month navigator */}
        <div className="flex items-center gap-2">
          <Link
            href={`/budget/${prevMonth(month)}`}
            className="text-[#8a8fad] hover:text-[#ecf0f1] p-1.5 rounded hover:bg-[#2a2b45] transition-colors text-lg leading-none"
            title="Previous month"
          >
            ‹
          </Link>
          <h2 className="text-base font-semibold text-[#ecf0f1] min-w-[12rem] text-center">
            {formatMonthDisplay(month)}
          </h2>
          <Link
            href={`/budget/${nextMonth(month)}`}
            className="text-[#8a8fad] hover:text-[#ecf0f1] p-1.5 rounded hover:bg-[#2a2b45] transition-colors text-lg leading-none"
            title="Next month"
          >
            ›
          </Link>
        </div>

        {/* Ready to Assign */}
        <div className="text-right">
          <p className="text-xs text-[#8a8fad] uppercase tracking-wide">Ready to Assign</p>
          <p
            className={`text-xl font-bold tabular-nums ${
              rta < 0 ? 'text-[#ce6f8f]' : 'text-[#5ccc96]'
            }`}
          >
            {formatMoney(rta)}
          </p>
        </div>
      </div>

      {/* ── Budget table ── */}
      <BudgetTable month={month} groups={resultGroups} />
    </div>
  )
}
