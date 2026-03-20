/**
 * Tests for the CC payment budget calculation logic.
 *
 * This mirrors the core transaction-processing loop in the budget page
 * (src/app/(app)/budget/[month]/page.tsx) as pure functions so we can
 * verify the logic without a DB or Next.js runtime.
 */
import { describe, it, expect } from 'vitest'

// ─── Types mirroring the budget page ────────────────────────────────────────

interface Txn {
  id: string
  accountId: string
  categoryId: string | null
  amount: number       // milliunits; negative = outflow
  date: string         // 'YYYY-MM-DD'
  isTransfer: boolean
}

interface CalcResult {
  activityMap: Record<string, Record<string, number>>   // [month][catId]
  ccAutoFundMap: Record<string, Record<string, number>> // [month][catId]
  inflowMap: Record<string, number>                     // [month]
}

// ─── Pure re-implementation of the budget page txn loop ─────────────────────

function processTxns(
  txns: Txn[],
  ccAccountIds: Set<string>,
  ccCatIds: Set<string>,
  ccAccountToCatId: Map<string, string>,
  legacyTransferCatIds: Set<string> = new Set(),
): CalcResult {
  const activityMap: Record<string, Record<string, number>> = {}
  const ccAutoFundMap: Record<string, Record<string, number>> = {}
  const inflowMap: Record<string, number> = {}

  for (const txn of txns) {
    if (txn.isTransfer) continue

    const month = txn.date.substring(0, 7)

    if (txn.categoryId) {
      if (ccCatIds.has(txn.categoryId)) {
        // Only count the outgoing payment side (not the inflow receipt on the CC account)
        if (!ccAccountIds.has(txn.accountId)) {
          activityMap[month] ??= {}
          activityMap[month][txn.categoryId] = (activityMap[month][txn.categoryId] ?? 0) + txn.amount
        }
      } else if (!legacyTransferCatIds.has(txn.categoryId)) {
        activityMap[month] ??= {}
        activityMap[month][txn.categoryId] = (activityMap[month][txn.categoryId] ?? 0) + txn.amount
      }
    } else if (txn.amount > 0 && !ccAccountIds.has(txn.accountId)) {
      // Exclude CC account inflows (payment receipts)
      inflowMap[month] = (inflowMap[month] ?? 0) + txn.amount
    }

    // CC auto-funding: categorized CC spending reserves money in the payment bucket
    if (ccAccountIds.has(txn.accountId) && txn.categoryId && !ccCatIds.has(txn.categoryId)) {
      const payBucketId = ccAccountToCatId.get(txn.accountId)
      if (payBucketId) {
        ccAutoFundMap[month] ??= {}
        ccAutoFundMap[month][payBucketId] = (ccAutoFundMap[month][payBucketId] ?? 0) + (-txn.amount)
      }
    }
  }

  return { activityMap, ccAutoFundMap, inflowMap }
}

// ─── Fixtures ────────────────────────────────────────────────────────────────

const CHECKING_ID = 'acct-checking'
const CC_ID       = 'acct-cc'
const GROCERIES   = 'cat-groceries'
const CC_PAY_CAT  = 'cat-cc-payment'

const ccAccountIds    = new Set([CC_ID])
const ccCatIds        = new Set([CC_PAY_CAT])
const ccAccountToCatId = new Map([[CC_ID, CC_PAY_CAT]])

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('CC auto-funding', () => {
  it('reserves money when spending on a CC', () => {
    const txns: Txn[] = [
      { id: '1', accountId: CC_ID, categoryId: GROCERIES, amount: -50000, date: '2026-03-10', isTransfer: false },
    ]
    const { ccAutoFundMap } = processTxns(txns, ccAccountIds, ccCatIds, ccAccountToCatId)
    // $50 outflow on CC → $50 reserved in CC Payment bucket
    expect(ccAutoFundMap['2026-03'][CC_PAY_CAT]).toBe(50000)
  })

  it('reduces reservation on CC refund', () => {
    const txns: Txn[] = [
      { id: '1', accountId: CC_ID, categoryId: GROCERIES, amount: -50000, date: '2026-03-10', isTransfer: false },
      { id: '2', accountId: CC_ID, categoryId: GROCERIES, amount: 20000,  date: '2026-03-15', isTransfer: false },
    ]
    const { ccAutoFundMap } = processTxns(txns, ccAccountIds, ccCatIds, ccAccountToCatId)
    // $50 purchase − $20 refund = $30 net reserved
    expect(ccAutoFundMap['2026-03'][CC_PAY_CAT]).toBe(30000)
  })
})

describe('CC payment (checking → CC)', () => {
  it('records payment activity from the checking outflow only', () => {
    const txns: Txn[] = [
      // Checking pays $200 to CC — categorized to CC Payment bucket
      { id: '1', accountId: CHECKING_ID, categoryId: CC_PAY_CAT, amount: -200000, date: '2026-03-20', isTransfer: false },
      // CC account receives $200 (the inflow receipt) — should NOT count as payment
      { id: '2', accountId: CC_ID,       categoryId: CC_PAY_CAT, amount:  200000, date: '2026-03-20', isTransfer: false },
    ]
    const { activityMap } = processTxns(txns, ccAccountIds, ccCatIds, ccAccountToCatId)
    // Net payment activity should be -$200, not 0
    expect(activityMap['2026-03'][CC_PAY_CAT]).toBe(-200000)
  })

  it('CC payment receipt does NOT inflate RTA', () => {
    const txns: Txn[] = [
      // CC inflow with no category (uncategorized receipt)
      { id: '1', accountId: CC_ID, categoryId: null, amount: 200000, date: '2026-03-20', isTransfer: false },
    ]
    const { inflowMap } = processTxns(txns, ccAccountIds, ccCatIds, ccAccountToCatId)
    // Should not appear in inflowMap
    expect(inflowMap['2026-03']).toBeUndefined()
  })
})

describe('transfer transactions', () => {
  it('isTransfer transactions are completely excluded', () => {
    const txns: Txn[] = [
      { id: '1', accountId: CHECKING_ID, categoryId: null, amount: -500000, date: '2026-03-15', isTransfer: true },
      { id: '2', accountId: CHECKING_ID, categoryId: null, amount:  500000, date: '2026-03-15', isTransfer: true },
    ]
    const { activityMap, inflowMap } = processTxns(txns, ccAccountIds, ccCatIds, ccAccountToCatId)
    expect(Object.keys(activityMap)).toHaveLength(0)
    expect(Object.keys(inflowMap)).toHaveLength(0)
  })
})

describe('uncategorized inflows', () => {
  it('positive inflow on checking adds to RTA', () => {
    const txns: Txn[] = [
      { id: '1', accountId: CHECKING_ID, categoryId: null, amount: 300000, date: '2026-03-01', isTransfer: false },
    ]
    const { inflowMap } = processTxns(txns, ccAccountIds, ccCatIds, ccAccountToCatId)
    expect(inflowMap['2026-03']).toBe(300000)
  })
})

describe('full CC payment cycle', () => {
  it('spend on CC, pay the bill — Still Owed approaches zero', () => {
    const txns: Txn[] = [
      // $100 groceries on CC
      { id: '1', accountId: CC_ID, categoryId: GROCERIES, amount: -100000, date: '2026-03-05', isTransfer: false },
      // Pay $100 from checking to CC
      { id: '2', accountId: CHECKING_ID, categoryId: CC_PAY_CAT, amount: -100000, date: '2026-03-20', isTransfer: false },
      // CC receives the payment (should be ignored)
      { id: '3', accountId: CC_ID,       categoryId: CC_PAY_CAT, amount:  100000, date: '2026-03-20', isTransfer: false },
    ]
    const { ccAutoFundMap, activityMap } = processTxns(txns, ccAccountIds, ccCatIds, ccAccountToCatId)

    const reserved = ccAutoFundMap['2026-03'][CC_PAY_CAT] // +$100 from CC spending
    const paid     = activityMap['2026-03'][CC_PAY_CAT]   // -$100 from checking payment

    // Still owed = reserved + paid = $100 + (-$100) = $0
    expect(reserved + paid).toBe(0)
  })
})
