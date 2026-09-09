// A fixed, unroutable base. Using a sentinel rather than window.location.origin
// keeps this callable during SSR/prerender, and the comparison below only needs
// "did this input stay relative", not the real origin.
const SENTINEL = 'http://safe-callback.invalid'

/**
 * Normalizes a caller-supplied post-login redirect target down to a same-origin path.
 *
 * Why this is not paranoia: `router.push` hands anything it classifies as external
 * straight to `location.assign`, and Next classifies purely by origin comparison
 * with no scheme allow-list —
 * `next/dist/client/components/app-router-utils.js`: `url.origin !== window.location.origin`.
 * A `javascript:` URL parses with origin `"null"`, so it counts as external and is
 * executed in this origin; an absolute or protocol-relative URL is a post-auth open
 * redirect. Both fire only after credentials and TOTP have already been accepted,
 * so MFA does not mitigate either.
 *
 * The validation is delegated to the WHATWG URL parser rather than performed with a
 * pattern, because a pattern inspects the raw string while the parser acts on a
 * normalized one, and the two disagree. The parser strips ASCII tab, LF and CR from
 * anywhere in the input and trims leading C0 controls and spaces, so `/\t/evil.example`
 * reads as a rooted path but resolves to `https://evil.example`. Any hand-written
 * check has to re-implement that normalization exactly or it is bypassable; running
 * the same parser Next runs cannot disagree with it.
 *
 * The returned value is the parser's own output, so what was validated is exactly
 * what gets navigated to.
 */
export function safeCallbackUrl(raw: string | null | undefined, fallback = '/budget'): string {
  if (!raw) return fallback
  let url: URL
  try {
    url = new URL(raw, SENTINEL)
  } catch {
    return fallback
  }
  // Anything absolute, protocol-relative, or scheme-bearing resolves to some other
  // origin (`javascript:` yields the string "null") and is rejected here.
  if (url.origin !== SENTINEL) return fallback

  const path = url.pathname + url.search + url.hash
  // Round-trip the result. The parser happily produces a pathname that itself starts
  // with '//' (`.//evil.example` and `/..//evil.example` both normalize to
  // `//evil.example`), which passes the origin check above as a path but re-parses as
  // protocol-relative at the point of use. Validating the parsed object and then
  // returning a *different* string is the same mistake one level down, so confirm the
  // exact string being returned still resolves to the sentinel.
  if (new URL(path, SENTINEL).origin !== SENTINEL) return fallback
  return path
}
