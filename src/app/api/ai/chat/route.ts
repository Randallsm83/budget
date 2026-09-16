import { createHash } from 'node:crypto'
import { and, asc, eq } from 'drizzle-orm'
import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@/auth'
import { db } from '@/db'
import { aiAuditEvents, aiConversations, aiMessages } from '@/db/schema'
import { buildMonthlyContext } from '@/lib/ai/context'
import { generateChat, type ChatTurn } from '@/lib/ai/provider'
import { systemPrompt } from '@/lib/ai/prompts'
import { appLog } from '@/lib/logger'

// Cap how many prior turns we feed back to the model. Anthropic prompt
// caching keeps the per-turn cost low, but unbounded history still grows
// the request linearly. A working set of ~20 user+assistant turns is
// plenty for a budgeting chat and well under any context window.
const MAX_HISTORY_TURNS = 20
const PROMPT_VERSION = 'v2-chat-cached'

export async function POST(req: NextRequest) {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const userId = session.user.id

  const body = await req.json().catch(() => null) as { message?: string; month?: string; conversationId?: string } | null
  const message = body?.message?.trim()
  const month = body?.month?.trim()
  const incomingConversationId = body?.conversationId
  if (!message) return NextResponse.json({ error: 'message is required' }, { status: 400 })
  if (!month || !/^\d{4}-\d{2}$/.test(month)) return NextResponse.json({ error: 'month must be YYYY-MM' }, { status: 400 })

  const started = Date.now()
  const model = process.env.ANTHROPIC_MODEL ?? process.env.OPENAI_MODEL ?? 'unknown'

  try {
    // Load (or create) the conversation. If a conversationId was supplied,
    // verify it belongs to this user and pin month to the first user
    // turn's metadata so the model never sees mixed-month history.
    let conversationId = incomingConversationId
    let history: ChatTurn[] = []

    if (conversationId) {
      const owned = await db
        .select({ id: aiConversations.id })
        .from(aiConversations)
        .where(and(eq(aiConversations.id, conversationId), eq(aiConversations.userId, userId)))
        .limit(1)
      if (owned.length === 0) {
        return NextResponse.json({ error: 'conversation not found' }, { status: 404 })
      }

      const prior = await db
        .select({
          role: aiMessages.role,
          content: aiMessages.content,
          metadata: aiMessages.metadata,
        })
        .from(aiMessages)
        .where(eq(aiMessages.conversationId, conversationId))
        .orderBy(asc(aiMessages.createdAt))

      // Pin month: the first user turn in this conversation defines the
      // budget month. Subsequent requests against the same conversation
      // must match — switching months mid-chat would invalidate every
      // dollar amount in the prior turns.
      const firstUser = prior.find((m) => m.role === 'user')
      const pinnedMonth = (firstUser?.metadata as { month?: string } | null | undefined)?.month
      if (pinnedMonth && pinnedMonth !== month) {
        return NextResponse.json(
          { error: `conversation is pinned to month ${pinnedMonth}; start a new conversation to discuss ${month}` },
          { status: 409 },
        )
      }

      // Keep only user/assistant pairs the provider understands and bound
      // the working set. Take the most recent N turns.
      const usable = prior
        .filter((m): m is { role: 'user' | 'assistant'; content: string; metadata: unknown } =>
          m.role === 'user' || m.role === 'assistant',
        )
        .map((m) => ({ role: m.role, content: m.content }))
      history = usable.slice(-MAX_HISTORY_TURNS)
    }

    const context = await buildMonthlyContext(userId, month)
    const contextJson = JSON.stringify(context)
    const contextHash = createHash('sha1').update(contextJson).digest('hex').slice(0, 12)

    if (!conversationId) {
      const inserted = await db.insert(aiConversations).values({
        userId,
        title: `Budget Coach ${month}`,
      }).returning({ id: aiConversations.id })
      conversationId = inserted[0].id
    }

    await db.insert(aiMessages).values({
      conversationId,
      userId,
      role: 'user',
      content: message,
      metadata: { month, contextHash, contextGeneratedAt: context.generatedAt },
    })

    const responseText = await generateChat(systemPrompt(), contextJson, history, message)

    await db.insert(aiMessages).values({
      conversationId,
      userId,
      role: 'assistant',
      content: responseText,
      metadata: { month, contextHash, contextGeneratedAt: context.generatedAt },
    })

    await db.insert(aiAuditEvents).values({
      userId,
      route: '/api/ai/chat',
      model,
      promptVersion: PROMPT_VERSION,
      latencyMs: Date.now() - started,
      safetyFlags: {
        historyTurns: history.length,
        contextHash,
      },
    })

    return NextResponse.json({ conversationId, message: responseText })
  } catch (e) {
    const errMessage = e instanceof Error ? e.message : 'AI chat failed'
    appLog('error', '/api/ai/chat', errMessage, { userId, metadata: { month, conversationId: incomingConversationId } })
    // Audit failures too so dashboards over aiAuditEvents see real error rates.
    try {
      await db.insert(aiAuditEvents).values({
        userId,
        route: '/api/ai/chat',
        model,
        promptVersion: PROMPT_VERSION,
        latencyMs: Date.now() - started,
        safetyFlags: { error: errMessage.slice(0, 500) },
      })
    } catch {
      // never let audit failure mask the original error
    }
    return NextResponse.json({ error: errMessage }, { status: 500 })
  }
}
