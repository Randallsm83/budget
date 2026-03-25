/**
 * App-level logger.
 *
 * Always writes to console (captured by Vercel Functions logs).
 * Persists 'error' and 'warn' entries to app_logs in the DB so they
 * survive past Vercel's short log retention window.
 *
 * DB write is fire-and-forget — a failed DB write never blocks the response.
 * Query logs in Drizzle Studio: npm run db:studio → app_logs table.
 */

import { db } from '@/db'
import { appLogs } from '@/db/schema'

export type LogLevel = 'info' | 'warn' | 'error'

interface LogOptions {
  userId?: string | null
  metadata?: Record<string, unknown>
}

export function appLog(
  level: LogLevel,
  route: string,
  message: string,
  options?: LogOptions,
): void {
  const { userId, metadata } = options ?? {}

  // Synchronous console output (Vercel captures this immediately)
  const entry = JSON.stringify({
    route,
    ...(userId ? { userId } : {}),
    message,
    ...(metadata ?? {}),
    ts: new Date().toISOString(),
  })
  if (level === 'error') console.error('[app/error]', entry)
  else if (level === 'warn')  console.warn('[app/warn]', entry)
  else                         console.log('[app/info]', entry)

  // Persist errors and warnings to DB for later querying (fire-and-forget)
  if (level === 'error' || level === 'warn') {
    db.insert(appLogs)
      .values({
        userId: userId ?? null,
        level,
        route,
        message,
        metadata: metadata ?? {},
      })
      .catch((e) => {
        // Never throw — a logging failure must not break the request
        console.error('[logger] Failed to persist log entry:', String(e))
      })
  }
}
