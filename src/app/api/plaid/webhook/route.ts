import { NextRequest, NextResponse } from 'next/server'
import { eq } from 'drizzle-orm'
import { db } from '@/db'
import { importConnections } from '@/db/schema'

// Plaid sends webhooks as server-to-server POST requests — no user session here.
// In production you should verify the Plaid-Verification JWT header using
// /webhook_verification_key/get before trusting the payload.

interface PlaidWebhookBody {
  webhook_type?: string
  webhook_code?: string
  item_id?: string
  environment?: string
  error?: unknown
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
        // Plaid detected new bank accounts for this Item.
        // Prompt the user to re-open Plaid Link in update mode to share them.
        console.log(
          `[plaid/webhook] NEW_ACCOUNTS_AVAILABLE for item ${item_id}` +
            (connection ? `, user ${connection.userId}` : ' (no local connection found)'),
        )
      }

      if (webhook_code === 'PENDING_DISCONNECT' || webhook_code === 'USER_PERMISSION_REVOKED') {
        console.log(`[plaid/webhook] ${webhook_code} for item ${item_id} — user may need to relink`)
      }

      if (webhook_code === 'ERROR' && body.error) {
        console.error(`[plaid/webhook] ITEM ERROR for item ${item_id}:`, body.error)
      }
    }

    if (webhook_type === 'TRANSACTIONS') {
      if (webhook_code === 'SYNC_UPDATES_AVAILABLE') {
        // New transactions are available. Users can trigger a manual sync,
        // or you could enqueue a background job here if your infra supports it.
        console.log(`[plaid/webhook] SYNC_UPDATES_AVAILABLE for item ${item_id}`)
      }

      if (webhook_code === 'DEFAULT_UPDATE') {
        console.log(`[plaid/webhook] DEFAULT_UPDATE (legacy) for item ${item_id}`)
      }
    }
  }

  // Always acknowledge with 200 so Plaid doesn't retry delivery
  return NextResponse.json({ received: true })
}
