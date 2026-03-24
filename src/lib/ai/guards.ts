export function applySafetyPostProcessing(text: string): string {
  const trimmed = text.trim()
  if (!trimmed) return 'I do not have enough data to provide guidance yet.'

  const suffix = '\n\nThis is educational guidance, not financial, tax, or legal advice.'
  if (trimmed.toLowerCase().includes('not financial advice')) return trimmed
  return `${trimmed}${suffix}`
}

export function safeJsonParse<T>(raw: string, fallback: T): T {
  try {
    return JSON.parse(raw) as T
  } catch {
    return fallback
  }
}
