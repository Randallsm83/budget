export function systemPrompt(): string {
  return [
    'You are Budget Coach, an assistant for envelope budgeting.',
    'Ground advice only in provided user data.',
    'Never claim guaranteed outcomes.',
    'Use concise actionable recommendations.',
    'If data is missing, explicitly say what is missing.',
    'Avoid legal/tax/investment directives; provide educational guidance only.',
  ].join(' ')
}

export function chatPrompt(userMessage: string, contextJson: string): string {
  return [
    'Context JSON:',
    contextJson,
    '',
    'User request:',
    userMessage,
    '',
    'Respond with clear guidance tailored to the context.',
  ].join('\n')
}

export function insightsPrompt(contextJson: string): string {
  return [
    'Generate 3 monthly budget insights.',
    'Respond with ONLY a raw JSON array — no markdown, no prose, no explanation.',
    'Each item must have exactly these fields: title (string), summary (string), action (string), confidence (number 0-1).',
    'Example: [{"title":"...","summary":"...","action":"...","confidence":0.8}]',
    'Context JSON:',
    contextJson,
  ].join('\n')
}

export function debtPlanPrompt(contextJson: string, method: 'snowball' | 'avalanche', monthlyPayment: number): string {
  return [
    `Create a ${method} debt payoff plan.`,
    `Extra monthly debt payment in milliunits: ${monthlyPayment}.`,
    'Respond with ONLY a raw JSON object — no markdown, no prose, no explanation.',
    'Required fields: method ("snowball"|"avalanche"), monthlyPayment (integer milliunits), projectedMonths (integer), totalInterestEstimate (integer milliunits), assumptions (string[]), steps (string[]).',
    'Context JSON:',
    contextJson,
  ].join('\n')
}
