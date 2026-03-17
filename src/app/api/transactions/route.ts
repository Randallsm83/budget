import { NextResponse } from 'next/server'
import { and, desc, eq, gte, lt } from 'drizzle-orm'
import { auth } from '@/auth'
import { db } from '@/db'
import { transactions } from '@/db/schema'
import { firstDayOfNextMonth } from '@/lib/budget'

export async function GET(req: Request) {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { searchParams } = new URL(req.url)
  const accountId = searchParams.get('accountId')
  const month = searchParams.get('month') // 'YYYY-MM'

  const conditions = [eq(transactions.userId, session.user.id)]
  if (accountId) conditions.push(eq(transactions.accountId, accountId))
  if (month) {
    conditions.push(gte(transactions.date, `${month}-01`))
    conditions.push(lt(transactions.date, firstDayOfNextMonth(month)))
  }

  const rows = await db
    .select()
    .from(transactions)
    .where(and(...conditions))
    .orderBy(desc(transactions.date), desc(transactions.createdAt))

  return NextResponse.json(rows)
}
