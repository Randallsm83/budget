import { describe, it, expect } from 'vitest'
import {
  formatMoney,
  parseMoney,
  prevMonth,
  nextMonth,
  firstDayOfNextMonth,
  formatMonthDisplay,
  computeCategoryBalance,
  computeReadyToAssign,
  getBankColor,
} from '../budget'

describe('formatMoney', () => {
  it('formats positive milliunits as dollars', () => {
    expect(formatMoney(1000)).toBe('$1.00')
    expect(formatMoney(123456)).toBe('$123.46')
    expect(formatMoney(1000000)).toBe('$1,000.00')
    expect(formatMoney(0)).toBe('$0.00')
  })

  it('formats negative milliunits with leading minus', () => {
    expect(formatMoney(-1000)).toBe('-$1.00')
    expect(formatMoney(-50500)).toBe('-$50.50')
  })

  it('rounds to 2 decimal places', () => {
    expect(formatMoney(1001)).toBe('$1.00')
    expect(formatMoney(1005)).toBe('$1.01') // rounds up at 0.5
  })
})

describe('parseMoney', () => {
  it('parses plain dollar amounts', () => {
    expect(parseMoney('1.00')).toBe(1000)
    expect(parseMoney('12.34')).toBe(12340)
    expect(parseMoney('100')).toBe(100000)
  })

  it('strips dollar signs and commas', () => {
    expect(parseMoney('$1,234.56')).toBe(1234560)
    expect(parseMoney('$0.50')).toBe(500)
  })

  it('handles negative values', () => {
    expect(parseMoney('-5.00')).toBe(-5000)
    expect(parseMoney('-$12.99')).toBe(-12990)
  })

  it('returns 0 for empty or invalid input', () => {
    expect(parseMoney('')).toBe(0)
    expect(parseMoney('-')).toBe(0)
    expect(parseMoney('abc')).toBe(0)
  })
})

describe('prevMonth / nextMonth', () => {
  it('goes to previous month', () => {
    expect(prevMonth('2026-03')).toBe('2026-02')
    expect(prevMonth('2026-01')).toBe('2025-12')
  })

  it('goes to next month', () => {
    expect(nextMonth('2026-03')).toBe('2026-04')
    expect(nextMonth('2026-12')).toBe('2027-01')
  })

  it('pads single-digit months', () => {
    expect(prevMonth('2026-02')).toBe('2026-01')
    expect(nextMonth('2026-09')).toBe('2026-10')
  })
})

describe('firstDayOfNextMonth', () => {
  it('returns first day of next month', () => {
    expect(firstDayOfNextMonth('2026-03')).toBe('2026-04-01')
    expect(firstDayOfNextMonth('2026-12')).toBe('2027-01-01')
  })
})

describe('computeCategoryBalance', () => {
  it('adds prior balance, budgeted, and activity', () => {
    expect(computeCategoryBalance({
      categoryId: 'cat1',
      priorBalance: 50000,
      budgeted: 100000,
      activity: -75000,
    }).balance).toBe(75000) // $50 + $100 - $75 = $75
  })

  it('handles overspent category (negative balance)', () => {
    expect(computeCategoryBalance({
      categoryId: 'cat1',
      priorBalance: 0,
      budgeted: 50000,
      activity: -75000,
    }).balance).toBe(-25000) // overspent by $25
  })

  it('handles zero budgeted (activity only)', () => {
    expect(computeCategoryBalance({
      categoryId: 'cat1',
      priorBalance: 0,
      budgeted: 0,
      activity: -20000,
    }).balance).toBe(-20000)
  })
})

describe('getBankColor', () => {
  it('matches Chase', () => expect(getBankColor('Chase Sapphire')).toBe('#1164B4'))
  it('matches Citi', () => expect(getBankColor('Citi Double Cash')).toBe('#004A97'))
  it('matches Capital One', () => expect(getBankColor('Capital One Quicksilver')).toBe('#C42A17'))
  it('matches Wells Fargo', () => expect(getBankColor('Wells Fargo Visa')).toBe('#D71E28'))
  it('returns default for unknown bank', () => expect(getBankColor('My Random Card')).toBe('#42b3c2'))
  it('is case-insensitive', () => expect(getBankColor('chase freedom')).toBe('#1164B4'))
})

describe('computeReadyToAssign', () => {
  it('adds inflows and subtracts budgeted from prior RTA', () => {
    expect(computeReadyToAssign(0, 300000, 100000)).toBe(200000)  // $300 in, $100 budgeted → $200 RTA
  })

  it('carries forward prior RTA', () => {
    expect(computeReadyToAssign(50000, 200000, 100000)).toBe(150000)
  })

  it('goes negative when overbudgeted', () => {
    expect(computeReadyToAssign(0, 100000, 200000)).toBe(-100000)
  })
})
