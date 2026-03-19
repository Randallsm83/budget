import { neon } from '@neondatabase/serverless'
import { drizzle } from 'drizzle-orm/neon-http'
import type { NeonHttpDatabase } from 'drizzle-orm/neon-http'
import * as schema from './schema'

type Db = NeonHttpDatabase<typeof schema>

// Lazy singleton — the Neon connection is created on first use, not at import
// time. This prevents build failures when DATABASE_URL is not set during the
// static analysis phase of `next build`.
let _db: Db | undefined

function getDb(): Db {
  if (!_db) {
    if (!process.env.DATABASE_URL) {
      throw new Error('DATABASE_URL environment variable is not set.')
    }
    _db = drizzle(neon(process.env.DATABASE_URL, { fetchOptions: { cache: 'no-store' } }), { schema })
  }
  return _db
}

// Proxy so callers can write `db.select(...)` without importing `getDb`
export const db: Db = new Proxy({} as Db, {
  get(_, prop) {
    return (getDb() as unknown as Record<string | symbol, unknown>)[prop]
  },
})
