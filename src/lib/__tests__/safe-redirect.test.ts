import { describe, it, expect } from 'vitest'
import { safeCallbackUrl } from '../safe-redirect'

const ORIGIN = 'https://budgeteer-rouge.vercel.app'

// Values the middleware legitimately produces (always req.nextUrl.pathname).
const LEGITIMATE = ['/', '/budget', '/budget/2026-03', '/accounts?filter=x', '/settings#mfa']

// Values only an attacker supplies. Each is classified "external" by Next's own rule
// (origin comparison), which routes it into location.assign().
const HOSTILE = [
  'javascript:alert(document.domain)',
  'JaVaScRiPt:alert(1)',
  ' javascript:alert(1)',
  'https://evil.example/x',
  'http://evil.example/x',
  '//evil.example/x',
  '/\\evil.example/x',
  '\\\\evil.example/x',
  'data:text/html,<script>alert(1)</script>',
  // Parser strips ASCII tab/LF/CR anywhere in the input, so these read as rooted
  // paths but resolve to an authority. A pattern applied to the raw string sees a
  // different string than the parser does, and passes them.
  '/\t/evil.example',
  '/\n/evil.example',
  '/\r/evil.example',
  // Dot-segment removal makes .pathname itself begin with '//', which is
  // protocol-relative when the returned string is parsed again at the point of use.
  '/.//evil.example/x',
  '/.\\/evil.example/x',
  './/evil.example',
  './\\evil.example',
  '/..//evil.example',
  '/a/../..//evil.example',
]

describe('safeCallbackUrl', () => {
  it('passes through paths the middleware actually produces', () => {
    for (const raw of LEGITIMATE) expect(safeCallbackUrl(raw)).toBe(raw)
  })

  it('falls back when the parameter is absent or empty', () => {
    expect(safeCallbackUrl(null)).toBe('/budget')
    expect(safeCallbackUrl(undefined)).toBe('/budget')
    expect(safeCallbackUrl('')).toBe('/budget')
    expect(safeCallbackUrl(null, '/elsewhere')).toBe('/elsewhere')
  })

  it('rejects every off-origin and scheme-bearing value', () => {
    for (const raw of HOSTILE) expect(safeCallbackUrl(raw)).toBe('/budget')
  })

  // Models the real entry point. A literal '%09' string is NOT hostile to this
  // function - it stays percent-encoded and resolves same-origin - which is why it is
  // absent from HOSTILE above. The attack is that useSearchParams decodes it to a real
  // tab first, and the tab is what the URL parser then strips. Pin both halves so the
  // chain cannot be broken by "fixing" only one.
  it('rejects a tab smuggled into the query string as %09', () => {
    const decoded = new URLSearchParams('callbackUrl=/%09/evil.example').get('callbackUrl')
    expect(decoded).toBe('/\t/evil.example')
    expect(safeCallbackUrl(decoded)).toBe('/budget')
  })

  // The actual invariant, asserted by re-parsing the RETURNED string rather than by
  // restating the implementation. Both bypasses this function has had were cases where
  // the value inspected and the value returned parsed differently, so the check has to
  // land on the output.
  it('never returns a value that resolves off-origin under the WHATWG URL parser', () => {
    for (const raw of [...LEGITIMATE, ...HOSTILE]) {
      const resolved = new URL(safeCallbackUrl(raw), ORIGIN)
      expect(resolved.origin).toBe(ORIGIN)
      expect(resolved.protocol).toBe('https:')
    }
  })

  // A hand-picked corpus is only as good as the author's imagination, and this
  // function has already been bypassed by two characters nobody listed. Sweep every
  // byte through the positions an attacker can use to smuggle an authority.
  it('resists every single-byte injection into an authority position', () => {
    const offenders: string[] = []
    for (let c = 0; c <= 0xff; c++) {
      const x = String.fromCharCode(c)
      for (const raw of [
        `${x}//evil.example`,
        `/${x}/evil.example`,
        `/${x}\\evil.example`,
        `${x}https://evil.example`,
        `/.${x}/evil.example`,
      ]) {
        if (new URL(safeCallbackUrl(raw), ORIGIN).origin !== ORIGIN) offenders.push(JSON.stringify(raw))
      }
    }
    expect(offenders).toEqual([])
  })
})
