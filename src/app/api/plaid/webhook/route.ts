import { NextRequest, NextResponse } from 'next/server'
import { eq } from 'drizzle-orm'
import { db } from '@/db'
import { importConnections } from '@/db/schema'
import { syncTransactions } from '@/lib/plaid-sync'
import { plaidLog } from '@/lib/plaid-logger'

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

  plaidLog('info', { route: 'plaid/webhook', plaidItemId: item_id, webhookType: webhook_type, webhookCode: webhook_code, env: body.environment })

  if (item_id) {
    const connection = await db.query.importConnections.findFirst({
      where: eq(importConnections.plaidItemId, item_id),
    })

    if (webhook_type === 'ITEM') {
      if (webhook_code === 'NEW_ACCOUNTS_AVAILABLE') {
        // Plaid detected new bank accounts for this Item — flag all connections so
        // the user is prompted to open update mode with account_selection_enabled.
        await db
          .update(importConnections)
          .set({ newAccountsAvailable: true })
          .where(eq(importConnections.plaidItemId, item_id))
      }

      if (webhook_code === 'PENDING_DISCONNECT') {
        await markRelinkRequired(item_id)
      }

      if (webhook_code === 'PENDING_EXPIRATION') {
        await markRelinkRequired(item_id)
      }

      if (webhook_code === 'LOGIN_REPAIRED') {
        await db
          .update(importConnections)
          .set({ requiresRelink: false })
          .where(eq(importConnections.plaidItemId, item_id))
      }

      if (webhook_code === 'USER_PERMISSION_REVOKED') {
        await markRelinkRequired(item_id)
      }

      if (webhook_code === 'ERROR' && body.error) {
        plaidLog('error', { route: 'plaid/webhook', plaidItemId: item_id, userId: connection?.userId, webhookType: 'ITEM', webhookCode: 'ERROR', errorCode: body.error.error_code, errorType: body.error.error_type, errorMessage: body.error.error_message })
        if (body.error.error_code === 'ITEM_LOGIN_REQUIRED') {
          await markRelinkRequired(item_id)
        }
      }
    }

    if (webhook_type === 'TRANSACTIONS') {
      if (webhook_code === 'SYNC_UPDATES_AVAILABLE') {
        const connections = await db.query.importConnections.findMany({
          where: eq(importConnections.plaidItemId, item_id),
        })
        for (const conn of connections) {
          if (!conn.accessTokenEncrypted) continue
          const result = await syncTransactions(conn)
          if ('error' in result) {
            plaidLog('error', { route: 'plaid/webhook', plaidItemId: item_id, accountId: conn.accountId ?? undefined, userId: conn.userId, webhookCode: 'SYNC_UPDATES_AVAILABLE', errorMessage: result.error })
          }
        }
      }
    }
  }

  // Always acknowledge with 200 so Plaid doesn't retry delivery
  return NextResponse.json({ received: true })
}
