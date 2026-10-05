import { and, asc, desc, eq } from 'drizzle-orm'
import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@/auth'
import { db } from '@/db'
import { aiAuditEvents, aiConversations, aiMessages } from '@/db/schema'
import { buildMonthlyContext, chatContextPayload } from '@/lib/ai/context'
import { generateChat, toChatHistory, type ChatTurn } from '@/lib/ai/provider'
import { systemPrompt } from '@/lib/ai/prompts'
import { isValidMonth } from '@/lib/budget'
import { appLog } from '@/lib/logger'

// Cap how many prior messages we feed back to the model. Anthropic prompt
// caching keeps the per-turn cost low, but unbounded history still grows
// the request linearly. The last 20 messages (10 user+assistant pairs) are
// plenty for a budgeting chat and well under any context window.
const MAX_HISTORY_TURNS = 20
// Longest accepted user message. The insights "Explain more" handoff is a
// title plus a one-paragraph summary, far below this.
const MAX_MESSAGE_CHARS = 2000
const PROMPT_VERSION = 'v2-chat-cached'

export async function POST(req: NextRequest) {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const userId = session.user.id

  const body = await req.json().catch(() => null) as { message?: unknown; month?: unknown; conversationId?: unknown } | null
  const message = typeof body?.message === 'string' ? body.message.trim() : ''
  const month = typeof body?.month === 'string' ? body.month.trim() : ''
  const incomingConversationId = typeof body?.conversationId === 'string' ? body.conversationId : undefined
  if (!message) return NextResponse.json({ error: 'message is required' }, { status: 400 })
  if (message.length > MAX_MESSAGE_CHARS) {
    return NextResponse.json({ error: `message must be at most ${MAX_MESSAGE_CHARS} characters` }, { status: 400 })
  }
  if (!isValidMonth(month)) return NextResponse.json({ error: 'month must be YYYY-MM' }, { status: 400 })

  const started = Date.now()
  const model = process.env.ANTHROPIC_MODEL ?? process.env.OPENAI_MODEL ?? 'unknown'

  try {
    // If a conversationId was supplied, verify it belongs to this user, pin
    // month to the first user turn's metadata so the model never sees
    // mixed-month history, and load a bounded window of recent messages.
    let history: ChatTurn[] = []

    if (incomingConversationId) {
      const owned = await db
        .select({ id: aiConversations.id })
        .from(aiConversations)
        .where(and(eq(aiConversations.id, incomingConversationId), eq(aiConversations.userId, userId)))
        .limit(1)
      if (owned.length === 0) {
        return NextResponse.json({ error: 'conversation not found' }, { status: 404 })
      }

      // Pin month: the first user turn in this conversation defines the
      // budget month. Subsequent requests against the same conversation
      // must match — switching months mid-chat would invalidate every
      // dollar amount in the prior turns. Fetched on its own because the
      // history window below may no longer reach the first turn.
      const [firstUser] = await db
        .select({ metadata: aiMessages.metadata })
        .from(aiMessages)
        .where(and(
          eq(aiMessages.conversationId, incomingConversationId),
          eq(aiMessages.userId, userId),
          eq(aiMessages.role, 'user'),
        ))
        .orderBy(asc(aiMessages.createdAt))
        .limit(1)
      const pinnedMonth = (firstUser?.metadata as { month?: string } | null | undefined)?.month
      if (pinnedMonth && pinnedMonth !== month) {
        return NextResponse.json(
          { error: `conversation is pinned to month ${pinnedMonth}; start a new conversation to discuss ${month}` },
          { status: 409 },
        )
      }

      const recent = await db
        .select({ role: aiMessages.role, content: aiMessages.content })
        .from(aiMessages)
        .where(and(eq(aiMessages.conversationId, incomingConversationId), eq(aiMessages.userId, userId)))
        .orderBy(desc(aiMessages.createdAt))
        .limit(MAX_HISTORY_TURNS)
      history = toChatHistory(recent)
    }

    const context = await buildMonthlyContext(userId, month)
    const { json: contextJson, hash: contextHash } = chatContextPayload(context)

    const responseText = await generateChat(systemPrompt(), contextJson, history, message, 'budget-chat')

    // Persist only once the model has answered, writing the user and
    // assistant turns in one statement: a failed call leaves no unanswered
    // user turn (and no new conversation) behind.
    let conversationId = incomingConversationId
    if (!conversationId) {
      const [inserted] = await db.insert(aiConversations).values({
        userId,
        title: `Budget Coach ${month}`,
      }).returning({ id: aiConversations.id })
      conversationId = inserted.id
    }

    const metadata = { month, contextHash, contextGeneratedAt: context.generatedAt }
    // Explicit timestamps: a multi-row insert would give both rows the same
    // now(), leaving the pair's order ambiguous when history is replayed. The
    // assistant row is forced strictly later, even if the clock stepped back.
    await db.insert(aiMessages).values([
      { conversationId, userId, role: 'user', content: message, metadata, createdAt: new Date(started) },
      { conversationId, userId, role: 'assistant', content: responseText, metadata, createdAt: new Date(Math.max(Date.now(), started + 1)) },
    ])

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
    return NextResponse.json({ error: 'AI chat failed' }, { status: 500 })
  }
}
