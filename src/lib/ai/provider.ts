import { applySafetyPostProcessing } from '@/lib/ai/guards'

const OPENAI_API_URL = 'https://api.openai.com/v1/chat/completions'
const ANTHROPIC_API_URL = 'https://api.anthropic.com/v1/messages'

// Default token budgets. Keep one-shot routes (insights/debt-plan) tight
// because they return structured JSON; chat needs more headroom for prose
// answers that cite multiple categories.
const DEFAULT_MAX_TOKENS_ONE_SHOT = 800
const DEFAULT_MAX_TOKENS_CHAT = 1500

export type ChatTurn = { role: 'user' | 'assistant'; content: string }

export type GenerateOptions = {
  maxTokens?: number
  temperature?: number
}

function requireEnv(name: string): string {
  const value = process.env[name]
  if (!value) throw new Error(`${name} is not configured`)
  return value
}

export async function generateText(
  system: string,
  user: string,
  opts: GenerateOptions = {},
): Promise<string> {
  const maxTokens = opts.maxTokens ?? DEFAULT_MAX_TOKENS_ONE_SHOT
  const temperature = opts.temperature ?? 0.2

  const anthropicApiKey = process.env.ANTHROPIC_API_KEY
  if (anthropicApiKey) {
    const model = process.env.ANTHROPIC_MODEL ?? 'claude-3-5-sonnet-20241022'
    const res = await fetch(ANTHROPIC_API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': anthropicApiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model,
        max_tokens: maxTokens,
        temperature,
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
    },
    body: JSON.stringify({
      model,
      temperature,
      max_tokens: maxTokens,
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
 */
export async function generateChat(
  system: string,
  contextJson: string,
  history: ChatTurn[],
  userMessage: string,
  opts: GenerateOptions = {},
): Promise<string> {
  const maxTokens = opts.maxTokens ?? DEFAULT_MAX_TOKENS_CHAT
  const temperature = opts.temperature ?? 0.2

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
      },
      body: JSON.stringify({
        model,
        max_tokens: maxTokens,
        temperature,
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
    },
    body: JSON.stringify({
      model,
      temperature,
      max_tokens: maxTokens,
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
