import { describe, it, expect } from 'vitest'
import { chatContextPayload, splitExpenseCategories } from '../ai/context'
import { toChatHistory } from '../ai/provider'

describe('toChatHistory', () => {
  it('replays newest-first rows oldest-first', () => {
    const rows = [
      { role: 'assistant', content: 'a2' },
      { role: 'user', content: 'q2' },
      { role: 'assistant', content: 'a1' },
      { role: 'user', content: 'q1' },
    ]
    expect(toChatHistory(rows)).toEqual([
      { role: 'user', content: 'q1' },
      { role: 'assistant', content: 'a1' },
      { role: 'user', content: 'q2' },
      { role: 'assistant', content: 'a2' },
    ])
  })

  it('drops an unanswered user turn, an answer cut from its question, and other roles', () => {
    const rows = [
      { role: 'user', content: 'q3 never answered' },
      { role: 'assistant', content: 'a2' },
      { role: 'user', content: 'q2' },
      { role: 'user', content: 'q1 orphaned by a failed call' },
      { role: 'system', content: 'note' },
      { role: 'assistant', content: 'a0, its question is past the LIMIT' },
    ]
    expect(toChatHistory(rows)).toEqual([
      { role: 'user', content: 'q2' },
      { role: 'assistant', content: 'a2' },
    ])
  })

  it('always yields alternating user/assistant pairs, whatever the stored roles', () => {
    for (let n = 0; n <= 7; n++) {
      for (let mask = 0; mask < 1 << n; mask++) {
        const rows = Array.from({ length: n }, (_, i) => ({ role: (mask >> i) & 1 ? 'user' : 'assistant', content: `${i}` }))
        const history = toChatHistory(rows)
        expect(history.length % 2).toBe(0)
        history.forEach((turn, i) => expect(turn.role).toBe(i % 2 === 0 ? 'user' : 'assistant'))
      }
    }
  })
})

describe('splitExpenseCategories', () => {
  const category = (name: string, groupName: string, budgeted: number, spent: number, projected = spent) => ({
    name,
    groupName,
    budgetedDollars: budgeted,
    spentDollars: spent,
    remainingDollars: budgeted - spent,
    projectedMonthEndDollars: projected,
  })

  it('keeps same-named categories from different groups in their own tiers', () => {
    const overspent = category('Groceries', 'Food', 100, 150)
    const onTrack = category('Groceries', 'Household', 100, 20)
    expect(splitExpenseCategories([overspent, onTrack])).toEqual({
      atRisk: [overspent],
      onTrack: [{ name: 'Groceries', groupName: 'Household', budgetedDollars: 100, spentDollars: 20, remainingDollars: 80 }],
    })
  })

  it('flags a category projected over budget even while money remains', () => {
    const pacingOver = category('Dining', 'Food', 200, 120, 260)
    expect(splitExpenseCategories([pacingOver])).toEqual({ atRisk: [pacingOver], onTrack: [] })
  })
})

describe('chatContextPayload', () => {
  const context = { month: '2026-10', totals: { outflowsDollars: 412.5 }, transactionCount: 31 }

  it('is byte-identical across turns when only generatedAt differs', () => {
    const turn1 = chatContextPayload({ ...context, generatedAt: '2026-10-05T10:00:00.000Z' })
    const turn2 = chatContextPayload({ ...context, generatedAt: '2026-10-05T10:04:59.999Z' })
    expect(turn2).toEqual(turn1)
    expect(turn1.json).not.toContain('generatedAt')
  })

  it('changes the hash when the data changes', () => {
    const before = chatContextPayload({ ...context, generatedAt: '2026-10-05T10:00:00.000Z' })
    const after = chatContextPayload({ ...context, transactionCount: 32, generatedAt: '2026-10-05T10:00:00.000Z' })
    expect(after.hash).not.toBe(before.hash)
  })
})
