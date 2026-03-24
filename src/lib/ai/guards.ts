export function applySafetyPostProcessing(text: string): string {
  const trimmed = text.trim()
  if (!trimmed) return 'I do not have enough data to provide guidance yet.'

  const suffix = '\n\nThis is educational guidance, not financial, tax, or legal advice.'
  if (trimmed.toLowerCase().includes('not financial advice')) return trimmed
  return `${trimmed}${suffix}`
}

export function safeJsonParse<T>(raw: string, fallback: T): T {
  // Try direct parse first
  try { return JSON.parse(raw) as T } catch { /* fall through */ }

  // Extract JSON array or object from surrounding prose / appended disclaimers
  const arrayMatch = raw.match(/\[[\s\S]*\]/)
  if (arrayMatch) {
    try { return JSON.parse(arrayMatch[0]) as T } catch { /* fall through */ }
  }
  const objectMatch = raw.match(/\{[\s\S]*\}/)
  if (objectMatch) {
    try { return JSON.parse(objectMatch[0]) as T } catch { /* fall through */ }
  }

  return fallback
}
