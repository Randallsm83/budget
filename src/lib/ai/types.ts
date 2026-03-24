import { z } from 'zod'

export const AiRoleSchema = z.enum(['user', 'assistant', 'system'])

export const ChatMessageSchema = z.object({
  role: AiRoleSchema,
  content: z.string().min(1),
})

export const InsightSchema = z.object({
  title: z.string().min(1),
  summary: z.string().min(1),
  action: z.string().min(1),
  confidence: z.number().min(0).max(1),
})

export const DebtPlanSchema = z.object({
  method: z.enum(['snowball', 'avalanche']),
  monthlyPayment: z.number().int().nonnegative(), // milliunits
  projectedMonths: z.number().int().positive(),
  totalInterestEstimate: z.number().int().nonnegative(), // milliunits
  assumptions: z.array(z.string()),
  steps: z.array(z.string()),
})

export type ChatMessage = z.infer<typeof ChatMessageSchema>
export type Insight = z.infer<typeof InsightSchema>
export type DebtPlan = z.infer<typeof DebtPlanSchema>
