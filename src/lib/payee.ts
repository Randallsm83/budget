/**
 * Normalize a payee name for use as a lookup key in payee_rules.
 *
 * - Non-letter characters become spaces so "Amazon.com" → "amazon com"
 *   rather than "amazoncom" (old behaviour dropped the dot entirely).
 * - Store reference codes like "#1234" and Square prefixes like "SQ *"
 *   are stripped so variants of the same merchant match the same rule.
 * - Standalone number tokens (store IDs, zip codes) are removed.
 *
 * Examples:
 *   "Starbucks #1234"          → "starbucks"
 *   "Amazon.com"               → "amazon com"
 *   "WHOLEFDS MKT #10025"      → "wholefds mkt"
 *   "SQ *BLUE BOTTLE COFFEE"   → "blue bottle coffee"
 */
export function normalizePayee(name: string): string {
  return name
    .toLowerCase()
    // Strip Square/Stripe-style prefixes: "SQ *", "SP *", "TST* "
    .replace(/^(sq|sp|tst|pp|ggl)\s*[*]\s*/i, '')
    // Strip store/transaction reference codes: #1234, *ABC123
    .replace(/[#*][\w]+/g, ' ')
    // Replace remaining non-letter characters with a space
    .replace(/[^a-z\s]/g, ' ')
    // Remove standalone number tokens (store numbers, zip codes)
    .replace(/\b\d+\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * Display-only title-casing for ALL-CAPS bank payee strings. Mixed-case
 * payees are returned unchanged; the stored value is never modified.
 *
 * Examples:
 *   "BKOFAMERICA ATM WITHDRWL" → "Bkofamerica Atm Withdrwl"
 *   "MCDONALD'S"               → "Mcdonald's"
 *   "Whole Foods"              → "Whole Foods"
 */
export function displayPayee(payee: string | null): string {
  if (!payee) return ''
  if (payee === payee.toUpperCase() && /[A-Z]/.test(payee)) {
    // The lookbehind keeps the letter after an apostrophe lower case ("Mcdonald's").
    return payee.toLowerCase().replace(/(?<!['’])\b\w/g, (c) => c.toUpperCase())
  }
  return payee
}
