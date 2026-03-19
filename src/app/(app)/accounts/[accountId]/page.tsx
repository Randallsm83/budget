import { auth } from '@/auth'
import { db } from '@/db'
import { accounts, transactions, categories, categoryGroups, importConnections } from '@/db/schema'
import { and, asc, desc, eq } from 'drizzle-orm'
import { notFound } from 'next/navigation'
import { AccountRegister } from '@/components/AccountRegister'

interface Props {
  params: Promise<{ accountId: string }>
}

export default async function AccountRegisterPage({ params }: Props) {
  const { accountId } = await params
  const session = await auth()
  const userId = session!.user.id

  const account = await db.query.accounts.findFirst({
    where: and(eq(accounts.id, accountId), eq(accounts.userId, userId)),
  })
  if (!account) notFound()

  const txns = await db
    .select({
      id: transactions.id,
      date: transactions.date,
      payee: transactions.payee,
      amount: transactions.amount,
      cleared: transactions.cleared,
      reconciled: transactions.reconciled,
      memo: transactions.memo,
      categoryId: transactions.categoryId,
      categoryName: categories.name,
      categoryGroupName: categoryGroups.name,
    })
    .from(transactions)
    .leftJoin(categories, eq(transactions.categoryId, categories.id))
    .leftJoin(categoryGroups, eq(categories.groupId, categoryGroups.id))
    .where(eq(transactions.accountId, accountId))
    .orderBy(desc(transactions.date), desc(transactions.createdAt))

  // All user accounts (for the transaction modal)
  const allAccounts = await db
    .select({ id: accounts.id, name: accounts.name })
    .from(accounts)
    .where(and(eq(accounts.userId, userId)))
    .orderBy(asc(accounts.createdAt))

  const connection = await db.query.importConnections.findFirst({
    where: and(
      eq(importConnections.accountId, accountId),
      eq(importConnections.userId, userId),
    ),
  })

  // All user categories (for the transaction modal)
  const allCats = await db
    .select({
      id: categories.id,
      name: categories.name,
      groupName: categoryGroups.name,
      isIncome: categoryGroups.isIncome,
      isTransfer: categoryGroups.isTransfer,
    })
    .from(categories)
    .leftJoin(categoryGroups, eq(categories.groupId, categoryGroups.id))
    .where(eq(categories.userId, userId))
    .orderBy(asc(categoryGroups.sortOrder), asc(categories.sortOrder))

  return (
    <AccountRegister
      account={{ id: account.id, name: account.name, type: account.type, balance: account.balance, clearedBalance: account.clearedBalance }}
      connection={connection ? { id: connection.id, lastSyncedAt: connection.lastSyncedAt?.toISOString() ?? null } : null}
      transactions={txns.map((t) => ({
        id: t.id,
        accountId: account.id,
        date: t.date,
        payee: t.payee ?? '',
        amount: t.amount,
        cleared: t.cleared,
        reconciled: t.reconciled,
        memo: t.memo ?? '',
        categoryId: t.categoryId ?? null,
        categoryName: t.categoryName
          ? `${t.categoryGroupName}: ${t.categoryName}`
          : null,
      }))}
      allAccounts={allAccounts}
      allCategories={allCats.map((c) => ({
        id: c.id,
        name: c.name,
        groupName: c.groupName ?? '',
        isIncome: c.isIncome ?? false,
        isTransfer: c.isTransfer ?? false,
      }))}
    />
  )
}
