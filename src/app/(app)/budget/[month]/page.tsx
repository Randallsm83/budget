import { unstable_noStore as noStore } from 'next/cache'
import { auth } from '@/auth'
import { db } from '@/db'
import { accounts, transactions, monthBudgets, categoryGroups, categories } from '@/db/schema'
import { asc, and, eq, inArray, lt, lte } from 'drizzle-orm'
import Link from 'next/link'
import { BudgetTable, type GroupRow } from '@/components/BudgetTable'
import { ensureCCPaymentCategories } from '@/lib/actions'
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
  noStore()
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

  // Backfill CC Payment categories for any existing CC accounts missing them
  await ensureCCPaymentCategories()

  // -------------------------------------------------------------------------
  // Determine on-budget account IDs + identify credit card accounts
  // -------------------------------------------------------------------------
  const ON_BUDGET_TYPES = ['checking', 'savings', 'cash', 'credit_card']

  const budgetAccts = await db
    .select({ id: accounts.id, type: accounts.type })
    .from(accounts)
    .where(and(eq(accounts.userId, userId), inArray(accounts.type, ON_BUDGET_TYPES)))

  const budgetAccountIds = budgetAccts.map((a) => a.id)
  const ccAccountIds = new Set(budgetAccts.filter((a) => a.type === 'credit_card').map((a) => a.id))

  // -------------------------------------------------------------------------
  // Fetch all groups + categories
  // -------------------------------------------------------------------------
  const groups = await db.query.categoryGroups.findMany({
    where: eq(categoryGroups.userId, userId),
    with: { categories: { orderBy: [asc(categories.sortOrder)] } },
    orderBy: [asc(categoryGroups.sortOrder)],
  })

  // Build CC Payment category maps
  // ccAccountToCatId: accountId → CC payment categoryId
  // ccCatIds: set of all CC payment category IDs
  const ccAccountToCatId = new Map<string, string>()
  const ccCatIds = new Set<string>()
  for (const g of groups) {
    if (g.isSystem && g.isTransfer) {
      for (const cat of g.categories) {
        if (cat.ccAccountId) {
          ccAccountToCatId.set(cat.ccAccountId, cat.id)
          ccCatIds.add(cat.id)
        }
      }
    }
  }

  // Legacy user-defined transfer categories (hidden from budget, excluded from math)
  const legacyTransferCatIds = new Set(
    groups.filter((g) => g.isTransfer && !g.isSystem).flatMap((g) => g.categories.map((c) => c.id))
  )

  // Regular budget category IDs (excludes income, CC payment, and legacy transfer)
  const allCategoryIds = groups
    .filter((g) => !g.isTransfer && !g.isSystem)
    .flatMap((g) => g.categories.map((c) => c.id))

  const incomeCatIds = new Set(
    groups.filter((g) => g.isIncome).flatMap((g) => g.categories.map((c) => c.id))
  )

  // -------------------------------------------------------------------------
  // Fetch transactions + budgets
  // -------------------------------------------------------------------------
  const allTxns = budgetAccountIds.length === 0
    ? []
    : await db
        .select()
        .from(transactions)
        .where(and(
          eq(transactions.userId, userId),
          lt(transactions.date, nextMonthStart),
          inArray(transactions.accountId, budgetAccountIds),
        ))

  const allBudgets = await db
    .select()
    .from(monthBudgets)
    .where(and(eq(monthBudgets.userId, userId), lte(monthBudgets.month, month)))

  // -------------------------------------------------------------------------
  // Build activity maps
  // activityMap[month][catId]     = sum of amounts for categorized txns
  // ccAutoFundMap[month][catId]   = auto-funded amount for CC payment category
  //                                 (= sum of categorized outflows on that CC account)
  // inflowMap[month]              = uncategorized positive inflows → RTA
  // incomeMap[month]              = income-category inflows → RTA
  // -------------------------------------------------------------------------
  const activityMap: Record<string, Record<string, number>> = {}
  const ccAutoFundMap: Record<string, Record<string, number>> = {}
  const inflowMap: Record<string, number> = {}
  const incomeMap: Record<string, number> = {}

  for (const txn of allTxns) {
    if (txn.isTransfer) continue // inter-account transfers are invisible to the budget
    const txnMonth = txn.date.substring(0, 7)

    if (txn.categoryId) {
      if (ccCatIds.has(txn.categoryId)) {
        // CC payment transaction (e.g. checking outflow to pay CC) — track activity only
        activityMap[txnMonth] ??= {}
        activityMap[txnMonth][txn.categoryId] = (activityMap[txnMonth][txn.categoryId] ?? 0) + txn.amount
      } else if (!legacyTransferCatIds.has(txn.categoryId)) {
        // Regular categorized transaction
        activityMap[txnMonth] ??= {}
        activityMap[txnMonth][txn.categoryId] = (activityMap[txnMonth][txn.categoryId] ?? 0) + txn.amount
        if (incomeCatIds.has(txn.categoryId)) {
          incomeMap[txnMonth] = (incomeMap[txnMonth] ?? 0) + txn.amount
        }
      }
    } else if (txn.amount > 0) {
      inflowMap[txnMonth] = (inflowMap[txnMonth] ?? 0) + txn.amount
    }

    // CC auto-funding: any categorized transaction on a CC account feeds the payment category
    // outflow (-$100 purchase) → +$100 reserved; refund (+$20) → -$20 reserved
    if (ccAccountIds.has(txn.accountId) && txn.categoryId && !ccCatIds.has(txn.categoryId)) {
      const ccPayCatId = ccAccountToCatId.get(txn.accountId)
      if (ccPayCatId) {
        ccAutoFundMap[txnMonth] ??= {}
        ccAutoFundMap[txnMonth][ccPayCatId] = (ccAutoFundMap[txnMonth][ccPayCatId] ?? 0) + (-txn.amount)
      }
    }
  }

  const budgetMap: Record<string, Record<string, number>> = {}
  for (const b of allBudgets) {
    budgetMap[b.month] ??= {}
    budgetMap[b.month][b.categoryId] = b.budgeted
  }

  // -------------------------------------------------------------------------
  // Iterative month-by-month balance computation
  // -------------------------------------------------------------------------
  const allMonths = new Set<string>([month])
  allTxns.forEach((t) => allMonths.add(t.date.substring(0, 7)))
  allBudgets.forEach((b) => allMonths.add(b.month))
  const sortedMonths = [...allMonths].filter((m) => m <= month).sort()

  const balanceMap: Record<string, number> = {}
  let rta = 0

  for (const m of sortedMonths) {
    const mActivity = activityMap[m] ?? {}
    const mBudget = budgetMap[m] ?? {}
    let totalExpenseBudgeted = 0

    // Regular expense/income categories
    for (const catId of allCategoryIds) {
      const isIncomeCat = incomeCatIds.has(catId)
      const activity = mActivity[catId] ?? 0
      const budgeted = mBudget[catId] ?? 0
      balanceMap[catId] = (balanceMap[catId] ?? 0) + (isIncomeCat ? activity - budgeted : budgeted + activity)
      if (!isIncomeCat) totalExpenseBudgeted += budgeted
    }

    // CC Payment categories: balance = auto-funded (from CC spending) + payments made
    // Does NOT affect totalExpenseBudgeted → does NOT reduce RTA
    for (const [, ccPayCatId] of ccAccountToCatId) {
      const autoFund = ccAutoFundMap[m]?.[ccPayCatId] ?? 0
      const paymentActivity = mActivity[ccPayCatId] ?? 0 // negative (payments from checking)
      balanceMap[ccPayCatId] = (balanceMap[ccPayCatId] ?? 0) + autoFund + paymentActivity
    }

    rta += (inflowMap[m] ?? 0) + (incomeMap[m] ?? 0) - totalExpenseBudgeted
  }

  // -------------------------------------------------------------------------
  // Build display rows
  // -------------------------------------------------------------------------
  const targetActivity = activityMap[month] ?? {}
  const targetBudget = budgetMap[month] ?? {}
  const targetCCAutoFund: Record<string, number> = {}
  for (const [, ccPayCatId] of ccAccountToCatId) {
    targetCCAutoFund[ccPayCatId] = ccAutoFundMap[month]?.[ccPayCatId] ?? 0
  }

  const resultGroups: GroupRow[] = groups
    .filter((g) => !g.isTransfer || g.isSystem) // hide legacy transfer groups
    .map((g) => {
      const isCC = g.isSystem && g.isTransfer
      const cats = g.categories.map((cat) => ({
        id: cat.id,
        name: cat.name,
        budgeted: isCC ? (targetCCAutoFund[cat.id] ?? 0) : (targetBudget[cat.id] ?? 0),
        activity: targetActivity[cat.id] ?? 0,
        balance: balanceMap[cat.id] ?? 0,
        isCCPayment: !!cat.ccAccountId,
      }))
      return {
        id: g.id,
        name: g.name,
        isIncome: g.isIncome,
        isSystem: g.isSystem,
        isTransfer: g.isTransfer,
        categories: cats,
        totalBudgeted: cats.reduce((s, c) => s + c.budgeted, 0),
        totalActivity: cats.reduce((s, c) => s + c.activity, 0),
        totalBalance: cats.reduce((s, c) => s + c.balance, 0),
      }
    })

  return (
    <div className="flex flex-col h-full">
      {/* ── Month header bar ── */}
      <div className="flex-shrink-0 bg-[#1f2039] border-b border-[#3a3b58] px-4 sm:px-6 py-3
                      flex items-center justify-between gap-2">
        {/* Month navigator */}
        <div className="flex items-center gap-1 sm:gap-2">
          <Link
            href={`/budget/${prevMonth(month)}`}
            className="text-[#8a8fad] hover:text-[#ecf0f1] p-1.5 rounded hover:bg-[#2a2b45] transition-colors text-lg leading-none"
            title="Previous month"
          >
            ‹
          </Link>
          <h2 className="text-sm sm:text-base font-semibold text-[#ecf0f1] min-w-[8rem] sm:min-w-[12rem] text-center">
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
          <p className="text-[10px] sm:text-xs text-[#8a8fad] uppercase tracking-wide">Ready to Assign</p>
          <p
            className={`text-lg sm:text-xl font-bold tabular-nums ${
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
