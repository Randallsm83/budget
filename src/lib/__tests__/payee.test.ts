import { describe, it, expect } from 'vitest'
import { displayPayee } from '../payee'

describe('displayPayee', () => {
  it('title-cases an all-caps payee', () => {
    expect(displayPayee('BKOFAMERICA ATM WITHDRWL')).toBe('Bkofamerica Atm Withdrwl')
  })

  it('title-cases words that start after digits or punctuation', () => {
    expect(displayPayee('CHECKCARD 0316 76 - DBA COMMONWEALTH')).toBe('Checkcard 0316 76 - Dba Commonwealth')
    expect(displayPayee('WHOLEFDS MKT #10025')).toBe('Wholefds Mkt #10025')
  })

  it('leaves mixed-case payees unchanged', () => {
    expect(displayPayee('Whole Foods')).toBe('Whole Foods')
    expect(displayPayee('iTunes')).toBe('iTunes')
    expect(displayPayee('lowercase coffee')).toBe('lowercase coffee')
  })

  it('returns an empty string for empty or null payees', () => {
    expect(displayPayee('')).toBe('')
    expect(displayPayee(null)).toBe('')
  })

  it('leaves payees with no letters unchanged', () => {
    expect(displayPayee('12345')).toBe('12345')
    expect(displayPayee('#0042 - 99')).toBe('#0042 - 99')
  })

  it('does not capitalise the letter after an apostrophe', () => {
    expect(displayPayee("MCDONALD'S")).toBe("Mcdonald's")
    expect(displayPayee("TRADER JOE'S #552")).toBe("Trader Joe's #552")
    expect(displayPayee('MCDONALD’S')).toBe('Mcdonald’s')
  })
})
