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
    'Generate 3 monthly budget insights as JSON array.',
    'Each item: {title, summary, action, confidence}.',
    'Context JSON:',
    contextJson,
  ].join('\n')
}

export function debtPlanPrompt(contextJson: string, method: 'snowball' | 'avalanche', monthlyPayment: number): string {
  return [
    `Create a ${method} debt payoff plan.`,
    `Extra monthly debt payment in milliunits: ${monthlyPayment}.`,
    'Return JSON object:',
    '{method, monthlyPayment, projectedMonths, totalInterestEstimate, assumptions, steps}.',
    'Context JSON:',
    contextJson,
  ].join('\n')
}
