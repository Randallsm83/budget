import { auth } from '@/auth'
import { db } from '@/db'
import { accounts, transactions, categories, categoryGroups } from '@/db/schema'
import { and, asc, desc, eq, gte, lt } from 'drizzle-orm'
import { firstDayOfNextMonth } from '@/lib/budget'
import { TransactionsList } from '@/components/TransactionsList'

interface Props {
  searchParams: Promise<{
    category?: string
    month?: string
    account?: string
  }>
}

export default async function TransactionsPage({ searchParams }: Props) {
  const session = await auth()
  const userId = session!.user.id
  const { category, month, account } = await searchParams

  // Build WHERE conditions
  const conditions = [eq(transactions.userId, userId)]
  if (category) conditions.push(eq(transactions.categoryId, category))
  if (account)  conditions.push(eq(transactions.accountId, account))
  if (month) {
    conditions.push(
      gte(transactions.date, `${month}-01`),
      lt(transactions.date, firstDayOfNextMonth(month)),
    )
  }

  const txns = await db
    .select({
      id:            transactions.id,
      date:          transactions.date,
      payee:         transactions.payee,
      amount:        transactions.amount,
      memo:          transactions.memo,
      cleared:       transactions.cleared,
      isTransfer:    transactions.isTransfer,
      categoryId:    transactions.categoryId,
      categoryName:  categories.name,
      groupName:     categoryGroups.name,
      accountId:     transactions.accountId,
      accountName:   accounts.name,
      accountType:   accounts.type,
    })
    .from(transactions)
    .leftJoin(accounts,        eq(transactions.accountId,  accounts.id))
    .leftJoin(categories,      eq(transactions.categoryId, categories.id))
    .leftJoin(categoryGroups,  eq(categories.groupId,      categoryGroups.id))
    .where(and(...conditions))
    .orderBy(desc(transactions.date), desc(transactions.createdAt))
    .limit(500)

  // All categories for the filter + re-categorize dropdown
  const allCategories = await db
    .select({
      id:        categories.id,
      name:      categories.name,
      groupName: categoryGroups.name,
      isIncome:  categoryGroups.isIncome,
      isSystem:  categoryGroups.isSystem,
      ccAccountId: categories.ccAccountId,
    })
    .from(categories)
    .leftJoin(categoryGroups, eq(categories.groupId, categoryGroups.id))
    .where(eq(categories.userId, userId))
    .orderBy(asc(categoryGroups.sortOrder), asc(categories.sortOrder))

  // All accounts for the filter dropdown
  const allAccounts = await db
    .select({ id: accounts.id, name: accounts.name, type: accounts.type })
    .from(accounts)
    .where(eq(accounts.userId, userId))
    .orderBy(asc(accounts.sortOrder), asc(accounts.createdAt))

  return (
    <TransactionsList
      transactions={txns.map((t) => ({
        id:           t.id,
        date:         t.date,
        payee:        t.payee ?? '',
        amount:       t.amount,
        memo:         t.memo ?? '',
        cleared:      t.cleared,
        isTransfer:   t.isTransfer,
        categoryId:   t.categoryId ?? null,
        categoryName: t.categoryName ?? null,
        groupName:    t.groupName ?? null,
        accountId:    t.accountId,
        accountName:  t.accountName ?? '',
        accountType:  t.accountType ?? '',
      }))}
      allCategories={allCategories.map((c) => ({
        id:         c.id,
        name:       c.name,
        groupName:  c.groupName ?? '',
        isIncome:   c.isIncome ?? false,
        isSystem:   c.isSystem ?? false,
        isCCPayment: !!c.ccAccountId,
      }))}
      allAccounts={allAccounts}
      filters={{ category: category ?? null, month: month ?? null, account: account ?? null }}
    />
  )
}
