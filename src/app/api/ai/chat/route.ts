import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@/auth'
import { db } from '@/db'
import { aiAuditEvents, aiConversations, aiMessages } from '@/db/schema'
import { buildMonthlyContext } from '@/lib/ai/context'
import { generateText } from '@/lib/ai/provider'
import { chatPrompt, systemPrompt } from '@/lib/ai/prompts'
import { ChatMessageSchema } from '@/lib/ai/types'
import { appLog } from '@/lib/logger'

export async function POST(req: NextRequest) {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const userId = session.user.id

  const body = await req.json().catch(() => null) as { message?: string; month?: string; conversationId?: string } | null
  const message = body?.message?.trim()
  const month = body?.month?.trim()
  if (!message) return NextResponse.json({ error: 'message is required' }, { status: 400 })
  if (!month || !/^\d{4}-\d{2}$/.test(month)) return NextResponse.json({ error: 'month must be YYYY-MM' }, { status: 400 })

  try {
    const started = Date.now()
    const context = await buildMonthlyContext(userId, month)

    const conversationId = body?.conversationId ?? (await db.insert(aiConversations).values({
      userId,
      title: `Budget Coach ${month}`,
    }).returning({ id: aiConversations.id }))[0].id

    await db.insert(aiMessages).values({
      conversationId,
      userId,
      role: 'user',
      content: message,
      metadata: { month },
    })

    const responseText = await generateText(
      systemPrompt(),
      chatPrompt(message, JSON.stringify(context)),
    )

    const validated = ChatMessageSchema.safeParse({ role: 'assistant', content: responseText })
    const finalText = validated.success ? validated.data.content : responseText

    await db.insert(aiMessages).values({
      conversationId,
      userId,
      role: 'assistant',
      content: finalText,
      metadata: { month },
    })

    await db.insert(aiAuditEvents).values({
      userId,
      route: '/api/ai/chat',
      model: process.env.ANTHROPIC_MODEL ?? process.env.OPENAI_MODEL ?? 'unknown',
      promptVersion: 'v1',
      latencyMs: Date.now() - started,
      safetyFlags: {},
    })

    return NextResponse.json({ conversationId, message: finalText })
  } catch (e) {
    appLog('error', '/api/ai/chat', e instanceof Error ? e.message : 'AI chat failed', { userId, metadata: { month } })
    return NextResponse.json({ error: e instanceof Error ? e.message : 'AI chat failed' }, { status: 500 })
  }
}
