import { applySafetyPostProcessing } from '@/lib/ai/guards'

// Optional Caveman gateway (LLM spend metering). Unset → providers directly.
const caveGateway = process.env.CAVE_GATEWAY_URL?.replace(/\/+$/, '')
const OPENAI_API_URL = caveGateway
  ? `${caveGateway}/w/budget/v1/chat/completions`
  : 'https://api.openai.com/v1/chat/completions'
const ANTHROPIC_API_URL = caveGateway
  ? `${caveGateway}/w/budget/v1/messages`
  : 'https://api.anthropic.com/v1/messages'
// Record only: forward bytes unchanged even if the gateway runs a compression mode.
// x-cave-workflow groups gateway spend by the job that made the call.
function caveHeaders(workflow: string): Record<string, string> {
  return caveGateway
    ? { 'x-cave-transforms': 'caveman.pass-through.v1', 'x-cave-workflow': workflow }
    : {}
}

function requireEnv(name: string): string {
  const value = process.env[name]
  if (!value) throw new Error(`${name} is not configured`)
  return value
}

/** `workflow`: Caveman workflow slug for the calling job (lowercase [a-z0-9_-]). */
export async function generateText(system: string, user: string, workflow: string): Promise<string> {
  const anthropicApiKey = process.env.ANTHROPIC_API_KEY
  if (anthropicApiKey) {
    const model = process.env.ANTHROPIC_MODEL ?? 'claude-3-5-sonnet-20241022'
    const res = await fetch(ANTHROPIC_API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': anthropicApiKey,
        'anthropic-version': '2023-06-01',
        ...caveHeaders(workflow),
      },
      body: JSON.stringify({
        model,
        max_tokens: 800,
        temperature: 0.2,
        system,
        messages: [
          { role: 'user', content: user },
        ],
      }),
    })

    if (!res.ok) {
      const body = await res.text()
      throw new Error(`Anthropic provider error: ${res.status} ${body}`)
    }

    const json = await res.json() as {
      content?: Array<{ type?: string; text?: string }>
    }
    const text = (json.content ?? [])
      .filter((c) => c.type === 'text' && typeof c.text === 'string')
      .map((c) => c.text)
      .join('\n')
    return applySafetyPostProcessing(text)
  }

  // Fallback for existing setups using OpenAI env vars
  const apiKey = requireEnv('OPENAI_API_KEY')
  const model = process.env.OPENAI_MODEL ?? 'gpt-4o-mini'

  const res = await fetch(OPENAI_API_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
      ...caveHeaders(workflow),
    },
    body: JSON.stringify({
      model,
      temperature: 0.2,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ],
    }),
  })

  if (!res.ok) {
    const body = await res.text()
    throw new Error(`OpenAI provider error: ${res.status} ${body}`)
  }

  const json = await res.json() as { choices?: Array<{ message?: { content?: string } }> }
  const text = json.choices?.[0]?.message?.content ?? ''
  return applySafetyPostProcessing(text)
}
