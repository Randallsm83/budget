import { NextResponse } from 'next/server'
import { eq } from 'drizzle-orm'
import { auth } from '@/auth'
import { db } from '@/db'
import { importConnections, users } from '@/db/schema'
import { removeItem } from '@/lib/plaid-item'

// POST /api/user/delete
// Offboarding: calls /item/remove for every Plaid Item, then deletes the user
// row. All related data (accounts, transactions, holdings, etc.) cascades via
// onDelete: 'cascade' in the schema.
export async function POST() {
  const session = await auth()
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const userId = session.user.id

  // Fetch all connections and remove each unique Plaid Item
  const conns = await db.query.importConnections.findMany({
    where: eq(importConnections.userId, userId),
  })

  const removedItems = new Set<string>()
  for (const conn of conns) {
    if (!conn.accessTokenEncrypted) continue
    const key = conn.plaidItemId ?? conn.id
    if (removedItems.has(key)) continue
    removedItems.add(key)
    await removeItem(conn.accessTokenEncrypted)
  }

  // Delete the user — all associated data cascades
  await db.delete(users).where(eq(users.id, userId))

  return NextResponse.json({ ok: true })
}
