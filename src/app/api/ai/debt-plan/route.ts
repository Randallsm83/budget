import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@/auth'
import { db } from '@/db'
import { aiAuditEvents, aiRecommendations } from '@/db/schema'
import { buildMonthlyContext } from '@/lib/ai/context'
import { generateText } from '@/lib/ai/provider'
import { debtPlanPrompt, systemPrompt } from '@/lib/ai/prompts'
import { safeJsonParse } from '@/lib/ai/guards'
import { DebtPlanSchema } from '@/lib/ai/types'

export async function POST(req: NextRequest) {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const userId = session.user.id

  const body = await req.json().catch(() => null) as { month?: string; method?: 'snowball' | 'avalanche'; monthlyPayment?: number } | null
  const month = body?.month?.trim()
  const method = body?.method ?? 'avalanche'
  const monthlyPayment = Number(body?.monthlyPayment ?? 0)
  if (!month || !/^\d{4}-\d{2}$/.test(month)) return NextResponse.json({ error: 'month must be YYYY-MM' }, { status: 400 })
  if (!Number.isFinite(monthlyPayment) || monthlyPayment < 0) return NextResponse.json({ error: 'monthlyPayment must be >= 0 milliunits' }, { status: 400 })

  const started = Date.now()
  const context = await buildMonthlyContext(userId, month)
  const raw = await generateText(
    systemPrompt(),
    debtPlanPrompt(JSON.stringify(context), method, monthlyPayment),
  )
  const candidate = safeJsonParse(raw, {
    method,
    monthlyPayment,
    projectedMonths: 1,
    totalInterestEstimate: 0,
    assumptions: ['Insufficient data; fallback estimate used.'],
    steps: ['Provide debt APR and minimum payment details for better projections.'],
  })
  const parsed = DebtPlanSchema.safeParse(candidate)
  if (!parsed.success) return NextResponse.json({ error: 'Could not generate structured debt plan' }, { status: 422 })

  await db.insert(aiRecommendations).values({
    userId,
    month,
    type: 'debt',
    payload: parsed.data,
  })
  await db.insert(aiAuditEvents).values({
    userId,
    route: '/api/ai/debt-plan',
    model: process.env.OPENAI_MODEL ?? 'gpt-4o-mini',
    promptVersion: 'v1',
    latencyMs: Date.now() - started,
    safetyFlags: {},
  })

  return NextResponse.json({ plan: parsed.data })
}
