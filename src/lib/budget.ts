/**
 * Budget math engine.
 *
 * All amounts are INTEGER MILLIUNITS. $1.00 = 1000. Never use floats for money.
 *
 * Core equations:
 *   activity       = sum of all categorized transaction amounts in the month
 *   category_bal   = prior_month_carryover + budgeted + activity
 *   ready_to_assign = running_rta + inflows_this_month − total_budgeted_this_month
 */

export interface CategoryMonthInput {
  categoryId: string
  priorBalance: number // milliunits — balance at end of previous month
  budgeted: number // milliunits — amount assigned this month
  activity: number // milliunits — sum of transactions this month (negative = spending)
}

export interface CategoryMonthResult extends CategoryMonthInput {
  balance: number // milliunits — priorBalance + budgeted + activity
}

/** Compute the end-of-month balance for one category. */
export function computeCategoryBalance(input: CategoryMonthInput): CategoryMonthResult {
  return {
    ...input,
    balance: input.priorBalance + input.budgeted + input.activity,
  }
}

/**
 * Compute "Ready to Assign" for a single month given a running total.
 *
 * @param priorRta  - ready-to-assign carried from prior month
 * @param inflows   - total positive, uncategorized transactions this month
 * @param budgeted  - total assigned to all categories this month
 */
export function computeReadyToAssign(
  priorRta: number,
  inflows: number,
  budgeted: number,
): number {
  return priorRta + inflows - budgeted
}

// ---------------------------------------------------------------------------
// Display helpers
// ---------------------------------------------------------------------------

/** Format milliunits as "$1,234.56" or "-$1,234.56". */
export function formatMoney(milliunits: number): string {
  const abs = Math.abs(milliunits) / 1000
  const formatted = abs.toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })
  return milliunits < 0 ? `-$${formatted}` : `$${formatted}`
}

/**
 * Parse a user-entered dollar string to milliunits.
 * Handles: "12.34", "-5", "$1,000.50", ""
 */
export function parseMoney(value: string): number {
  const clean = value.replace(/[$,\s]/g, '').trim()
  if (clean === '' || clean === '-') return 0
  const dollars = parseFloat(clean)
  if (isNaN(dollars)) return 0
  return Math.round(dollars * 1000)
}

/** Get the first day of the next month as 'YYYY-MM-DD'. */
export function firstDayOfNextMonth(month: string): string {
  const [y, m] = month.split('-').map(Number)
  const nm = m === 12 ? 1 : m + 1
  const ny = m === 12 ? y + 1 : y
  return `${ny}-${String(nm).padStart(2, '0')}-01`
}

/** Get the previous month as 'YYYY-MM'. */
export function prevMonth(month: string): string {
  const [y, m] = month.split('-').map(Number)
  const pm = m === 1 ? 12 : m - 1
  const py = m === 1 ? y - 1 : y
  return `${py}-${String(pm).padStart(2, '0')}`
}

/** Get the next month as 'YYYY-MM'. */
export function nextMonth(month: string): string {
  const [y, m] = month.split('-').map(Number)
  const nm = m === 12 ? 1 : m + 1
  const ny = m === 12 ? y + 1 : y
  return `${ny}-${String(nm).padStart(2, '0')}`
}

/** Format 'YYYY-MM' as a human-readable string, e.g. "March 2026". */
export function formatMonthDisplay(month: string): string {
  const [y, m] = month.split('-').map(Number)
  return new Date(y, m - 1, 1).toLocaleDateString('en-US', {
    month: 'long',
    year: 'numeric',
  })
}

// ---------------------------------------------------------------------------
// Bank brand colors
// ---------------------------------------------------------------------------

// [pattern, color, 2-letter abbrev]
const BANK_COLORS: [RegExp, string, string][] = [
  [/chase/i,                          '#1164B4', 'CH'], // Chase blue
  [/amex|american\s?express/i,        '#B8860B', 'AX'], // Amex gold (gold card)
  [/citi(bank)?/i,                    '#C41E3A', 'CI'], // Citi red arc
  [/wells\s?fargo/i,                  '#D71E28', 'WF'], // Wells Fargo red
  [/bank\s?of\s?america|bofa/i,       '#E31837', 'BA'], // BofA red
  [/capital\s?one/i,                  '#C42A17', 'C1'], // Capital One red
  [/discover/i,                       '#F76107', 'DS'], // Discover orange
  [/us\s?bank/i,                      '#0069AA', 'US'], // US Bank blue
  [/barclays/i,                       '#00AEEF', 'BX'], // Barclays cyan
  [/synchrony/i,                      '#5B2D86', 'SY'], // Synchrony purple
  [/ally/i,                           '#7A2487', 'AL'], // Ally purple
  [/navy\s?fed|nfcu/i,                '#002868', 'NF'], // Navy Federal navy
  [/pnc/i,                            '#F58025', 'PN'], // PNC orange
  [/td\s?bank|toronto-dominion/i,     '#34B233', 'TD'], // TD green
]

export interface BankBrand { color: string; abbrev: string }

/** Return brand color + 2-letter abbreviation for a card name. */
export function getBankBrand(name: string): BankBrand {
  for (const [pattern, color, abbrev] of BANK_COLORS) {
    if (pattern.test(name)) return { color, abbrev }
  }
  return { color: '#42b3c2', abbrev: '??' }
}

/** Return a hex brand color for a card name, or a default teal. */
export function getBankColor(name: string): string {
  return getBankBrand(name).color
}

/** Return the current month as 'YYYY-MM'. */
export function currentMonth(): string {
  const now = new Date()
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
}
