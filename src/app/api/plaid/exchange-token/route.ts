import { NextRequest, NextResponse } from 'next/server'
import { and, eq } from 'drizzle-orm'
import { auth } from '@/auth'
import { plaidClient } from '@/lib/plaid'
import { encrypt } from '@/lib/crypto'
import { db } from '@/db'
import { importConnections } from '@/db/schema'

export async function POST(req: NextRequest) {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { public_token, accountId } = await req.json()

  const response = await plaidClient.itemPublicTokenExchange({ public_token })
  const accessToken = response.data.access_token
  const plaidItemId = response.data.item_id
  const accessTokenEncrypted = encrypt(accessToken)

  // Upsert: update existing connection or create new one
  const existing = await db.query.importConnections.findFirst({
    where: and(
      eq(importConnections.userId, session.user.id),
      eq(importConnections.accountId, accountId),
    ),
  })

  if (existing) {
    await db
      .update(importConnections)
      .set({ plaidItemId, accessTokenEncrypted, cursor: null, lastSyncedAt: null })
      .where(eq(importConnections.id, existing.id))
  } else {
    await db.insert(importConnections).values({
      userId: session.user.id,
      accountId,
      plaidItemId,
      accessTokenEncrypted,
    })
  }

  return NextResponse.json({ success: true })
}
