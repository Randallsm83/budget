import { NextResponse } from 'next/server'
import { asc, eq } from 'drizzle-orm'
import { auth } from '@/auth'
import { db } from '@/db'
import { accounts } from '@/db/schema'

export async function GET() {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const rows = await db
    .select()
    .from(accounts)
    .where(eq(accounts.userId, session.user.id))
    .orderBy(asc(accounts.createdAt))

  return NextResponse.json(rows)
}
