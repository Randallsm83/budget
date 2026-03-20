import { NextRequest, NextResponse } from 'next/server'
import { eq } from 'drizzle-orm'
import { db } from '@/db'
import { importConnections } from '@/db/schema'
import { syncTransactions } from '@/lib/plaid-sync'

/** Flag every connection sharing this Item as needing re-authentication. */
async function markRelinkRequired(plaidItemId: string) {
  await db
    .update(importConnections)
    .set({ requiresRelink: true })
    .where(eq(importConnections.plaidItemId, plaidItemId))
}

// Plaid sends webhooks as server-to-server POST requests — no user session here.
// In production you should verify the Plaid-Verification JWT header using
// /webhook_verification_key/get before trusting the payload.

interface PlaidWebhookBody {
  webhook_type?: string
  webhook_code?: string
  item_id?: string
  environment?: string
  error?: { error_code?: string; error_type?: string; error_message?: string } | null
}

export async function POST(req: NextRequest) {
  let body: PlaidWebhookBody
  try {
    body = (await req.json()) as PlaidWebhookBody
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const { webhook_type, webhook_code, item_id } = body

  console.log('[plaid/webhook]', { webhook_type, webhook_code, item_id, env: body.environment })

  if (item_id) {
    const connection = await db.query.importConnections.findFirst({
      where: eq(importConnections.plaidItemId, item_id),
    })

    if (webhook_type === 'ITEM') {
      if (webhook_code === 'NEW_ACCOUNTS_AVAILABLE') {
        // Plaid detected new bank accounts for this Item — flag all connections so
        // the user is prompted to open update mode with account_selection_enabled.
        console.log(
          `[plaid/webhook] NEW_ACCOUNTS_AVAILABLE for item ${item_id}` +
            (connection ? `, user ${connection.userId}` : ' (no local connection found)'),
        )
        await db
          .update(importConnections)
          .set({ newAccountsAvailable: true })
          .where(eq(importConnections.plaidItemId, item_id))
      }

      if (webhook_code === 'PENDING_DISCONNECT') {
        // Institution will disconnect in ~7 days (US/CA) — prompt user to update now
        console.log(`[plaid/webhook] PENDING_DISCONNECT for item ${item_id} — marking relink required`)
        await markRelinkRequired(item_id)
      }

      if (webhook_code === 'PENDING_EXPIRATION') {
        // OAuth consent expiring soon (EU/UK) — prompt user to reauthorize
        console.log(`[plaid/webhook] PENDING_EXPIRATION for item ${item_id} — marking relink required`)
        await markRelinkRequired(item_id)
      }

      if (webhook_code === 'LOGIN_REPAIRED') {
        // Another app (or this one) repaired the Item — dismiss any relink prompt
        console.log(`[plaid/webhook] LOGIN_REPAIRED for item ${item_id} — clearing relink flag`)
        await db
          .update(importConnections)
          .set({ requiresRelink: false })
          .where(eq(importConnections.plaidItemId, item_id))
      }

      if (webhook_code === 'USER_PERMISSION_REVOKED') {
        console.log(`[plaid/webhook] USER_PERMISSION_REVOKED for item ${item_id} — marking relink required`)
        await markRelinkRequired(item_id)
      }

      if (webhook_code === 'ERROR' && body.error) {
        console.error(`[plaid/webhook] ITEM ERROR for item ${item_id}:`, body.error)
        if (body.error.error_code === 'ITEM_LOGIN_REQUIRED') {
          console.log(`[plaid/webhook] ITEM_LOGIN_REQUIRED for item ${item_id} — marking relink required`)
          await markRelinkRequired(item_id)
        }
      }
    }

    if (webhook_type === 'TRANSACTIONS') {
      if (webhook_code === 'SYNC_UPDATES_AVAILABLE') {
        console.log(`[plaid/webhook] SYNC_UPDATES_AVAILABLE for item ${item_id} — syncing all connections`)
        // Find every connection for this Item and sync each one
        const connections = await db.query.importConnections.findMany({
          where: eq(importConnections.plaidItemId, item_id),
        })
        for (const conn of connections) {
          if (!conn.accessTokenEncrypted) continue
          const result = await syncTransactions(conn)
          console.log(`[plaid/webhook] synced account ${conn.accountId}:`, result)
        }
      }

      if (webhook_code === 'DEFAULT_UPDATE') {
        console.log(`[plaid/webhook] DEFAULT_UPDATE (legacy) for item ${item_id}`)
      }
    }

    if (webhook_type === 'HOLDINGS') {
      if (webhook_code === 'DEFAULT_UPDATE') {
        // Investment holdings updated — user should trigger a sync
        console.log(
          `[plaid/webhook] HOLDINGS/DEFAULT_UPDATE for item ${item_id}` +
            (connection ? `, user ${connection.userId}` : ' (no local connection found)'),
        )
      }
    }

    if (webhook_type === 'INVESTMENTS_TRANSACTIONS') {
      if (webhook_code === 'DEFAULT_UPDATE') {
        console.log(
          `[plaid/webhook] INVESTMENTS_TRANSACTIONS/DEFAULT_UPDATE for item ${item_id}` +
            (connection ? `, user ${connection.userId}` : ' (no local connection found)'),
        )
      }
    }

    if (webhook_type === 'LIABILITIES') {
      if (webhook_code === 'DEFAULT_UPDATE') {
        // Liability data refreshed — user should trigger a sync
        console.log(
          `[plaid/webhook] LIABILITIES/DEFAULT_UPDATE for item ${item_id}` +
            (connection ? `, user ${connection.userId}` : ' (no local connection found)'),
        )
      }
    }
  }

  // Always acknowledge with 200 so Plaid doesn't retry delivery
  return NextResponse.json({ received: true })
}
