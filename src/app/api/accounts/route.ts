import { NextResponse } from 'next/server'
import { asc, eq, and, sql } from 'drizzle-orm'
import { auth } from '@/auth'
import { db } from '@/db'
import { accounts, importConnections } from '@/db/schema'

export async function GET() {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  // LEFT JOIN to pick up requiresRelink from the import connection (if any)
  const rows = await db
    .select({
      id: accounts.id,
      name: accounts.name,
      type: accounts.type,
      balance: accounts.balance,
      closed: accounts.closed,
      createdAt: accounts.createdAt,
      updatedAt: accounts.updatedAt,
      requiresRelink: sql<boolean>`coalesce(bool_or(${importConnections.requiresRelink}), false)`,
    })
    .from(accounts)
    .leftJoin(
      importConnections,
      and(
        eq(importConnections.accountId, accounts.id),
        eq(importConnections.userId, session.user.id),
      ),
    )
    .where(eq(accounts.userId, session.user.id))
    .groupBy(accounts.id)
    .orderBy(asc(accounts.createdAt))

  return NextResponse.json(rows)
}
