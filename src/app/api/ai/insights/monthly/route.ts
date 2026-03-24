import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@/auth'
import { db } from '@/db'
import { aiAuditEvents, aiRecommendations } from '@/db/schema'
import { buildMonthlyContext } from '@/lib/ai/context'
import { generateText } from '@/lib/ai/provider'
import { insightsPrompt, systemPrompt } from '@/lib/ai/prompts'
import { safeJsonParse } from '@/lib/ai/guards'
import { InsightSchema } from '@/lib/ai/types'

export async function POST(req: NextRequest) {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const userId = session.user.id

  const body = await req.json().catch(() => null) as { month?: string } | null
  const month = body?.month?.trim()
  if (!month || !/^\d{4}-\d{2}$/.test(month)) return NextResponse.json({ error: 'month must be YYYY-MM' }, { status: 400 })

  const started = Date.now()
  const context = await buildMonthlyContext(userId, month)
  const raw = await generateText(systemPrompt(), insightsPrompt(JSON.stringify(context)))
  const parsed = safeJsonParse<unknown[]>(raw, [])

  const insights = parsed
    .map((p) => InsightSchema.safeParse(p))
    .filter((r): r is { success: true; data: { title: string; summary: string; action: string; confidence: number } } => r.success)
    .map((r) => r.data)
    .slice(0, 3)

  if (insights.length > 0) {
    await db.insert(aiRecommendations).values(insights.map((i) => ({
      userId,
      month,
      type: 'insight',
      payload: i,
    })))
  }

  await db.insert(aiAuditEvents).values({
    userId,
    route: '/api/ai/insights/monthly',
    model: process.env.OPENAI_MODEL ?? 'gpt-4o-mini',
    promptVersion: 'v1',
    latencyMs: Date.now() - started,
    safetyFlags: {},
  })

  return NextResponse.json({ insights })
}
