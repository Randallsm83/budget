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

// Chat needs more headroom than the one-shot routes (800): prose answers
// cite multiple categories and were truncating at 800.
const CHAT_MAX_TOKENS = 1500

export type ChatTurn = { role: 'user' | 'assistant'; content: string }

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

/**
 * Multi-turn chat completion with conversation history.
 *
 * On Anthropic, the system prompt and the (large, stable per-month) context
 * JSON are sent as cache-eligible blocks (`cache_control.ephemeral`), so
 * follow-up turns within ~5 minutes only re-bill the small history + user
 * message instead of the full context. On OpenAI, the same data is passed
 * as plain message blocks (no caching primitive available).
 *
 * `history` MUST be ordered oldest-first and end just before the new user
 * message. The new user message is appended internally.
 *
 * `workflow`: Caveman workflow slug for the calling job (lowercase [a-z0-9_-]).
 */
export async function generateChat(
  system: string,
  contextJson: string,
  history: ChatTurn[],
  userMessage: string,
  workflow: string,
): Promise<string> {
  const anthropicApiKey = process.env.ANTHROPIC_API_KEY
  if (anthropicApiKey) {
    const model = process.env.ANTHROPIC_MODEL ?? 'claude-3-5-sonnet-20241022'

    // System prompt as a single cache-eligible block.
    const systemBlocks = [
      { type: 'text', text: system, cache_control: { type: 'ephemeral' as const } },
    ]

    // First user turn carries the context JSON in its own cache-eligible
    // block, then the history, then the new user message as a plain block.
    const firstUserContent = [
      { type: 'text', text: `Context JSON:\n${contextJson}`, cache_control: { type: 'ephemeral' as const } },
    ]

    type AnthropicMessage = { role: 'user' | 'assistant'; content: unknown }
    const messages: AnthropicMessage[] = [
      { role: 'user', content: firstUserContent },
    ]
    // If there is no prior history the model needs an assistant ack before
    // we can continue with another user turn (alternation rule). We use a
    // short acknowledgement so the cache key remains stable across turns.
    if (history.length === 0) {
      messages.push({ role: 'assistant', content: 'Understood. What would you like guidance on?' })
    } else {
      for (const turn of history) {
        messages.push({ role: turn.role, content: turn.content })
      }
    }
    messages.push({ role: 'user', content: userMessage })

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
        max_tokens: CHAT_MAX_TOKENS,
        temperature: 0.2,
        system: systemBlocks,
        messages,
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

  // OpenAI fallback: no prompt caching primitive; send the system, then
  // the context as a synthetic system message, then history, then the new
  // user message.
  const apiKey = requireEnv('OPENAI_API_KEY')
  const model = process.env.OPENAI_MODEL ?? 'gpt-4o-mini'

  const messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }> = [
    { role: 'system', content: system },
    { role: 'system', content: `Context JSON:\n${contextJson}` },
  ]
  for (const turn of history) {
    messages.push({ role: turn.role, content: turn.content })
  }
  messages.push({ role: 'user', content: userMessage })

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
      max_tokens: CHAT_MAX_TOKENS,
      messages,
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
