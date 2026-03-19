import { NextRequest, NextResponse } from 'next/server'
import { and, eq } from 'drizzle-orm'
import { auth } from '@/auth'
import { db } from '@/db'
import { importConnections } from '@/db/schema'
import { syncTransactions } from '@/lib/plaid-sync'

export async function POST(req: NextRequest) {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { accountId } = await req.json()

  const connection = await db.query.importConnections.findFirst({
    where: and(
      eq(importConnections.accountId, accountId),
      eq(importConnections.userId, session.user.id),
    ),
  })
  if (!connection?.accessTokenEncrypted) {
    return NextResponse.json({ error: 'No bank connection for this account' }, { status: 404 })
  }

  const result = await syncTransactions(connection)

  if ('requiresRelink' in result) return NextResponse.json({ requiresRelink: true })
  if ('error' in result) return NextResponse.json({ error: result.error }, { status: 500 })

  return NextResponse.json({ success: true, ...result })
}
