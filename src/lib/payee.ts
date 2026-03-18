/**
 * Normalize a payee name for use as a lookup key in payee_rules.
 * Strips digits, special chars, and extra whitespace so that
 * "Starbucks #1234" and "Starbucks #5678" both normalize to "starbucks".
 */
export function normalizePayee(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z\s]/g, '') // keep only letters + spaces
    .replace(/\s+/g, ' ')
    .trim()
}
