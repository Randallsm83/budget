'use client'

import { useState } from 'react'
import Link from 'next/link'
import { clearNewAccountsAvailable } from '@/lib/actions'

interface NewAccountsItem {
  id: string   // representative account ID on this Item
  name: string
}

export function NewAccountsBanner({ items }: { items: NewAccountsItem[] }) {
  const [dismissed, setDismissed] = useState<Set<string>>(new Set())

  const visible = items.filter((i) => !dismissed.has(i.id))
  if (visible.length === 0) return null

  async function handleDismiss(accountId: string) {
    setDismissed((prev) => new Set(prev).add(accountId))
    try { await clearNewAccountsAvailable(accountId) } catch { /* non-critical */ }
  }

  return (
    <div className="flex-shrink-0 bg-[#42b3c2]/10 border-b border-[#42b3c2]/30 px-4 py-2.5 flex flex-col gap-1.5">
      {visible.map((item) => (
        <div key={item.id} className="flex items-start gap-3">
          <span className="text-[#42b3c2] flex-shrink-0 mt-0.5 text-sm">＋</span>
          <div className="flex-1 min-w-0 text-sm">
            <span className="font-medium text-[#42b3c2]">New accounts available</span>
            <span className="text-[#8a8fad]">
              {' — '}your bank has accounts not yet connected to Coffer. Go to{' '}
              <Link href={`/accounts/${item.id}`} className="text-[#42b3c2] hover:underline">
                {item.name}
              </Link>{' '}
              and click <strong className="text-[#ecf0f1] font-medium">＋ Add Accounts</strong> to connect them.
            </span>
          </div>
          <button
            onClick={() => handleDismiss(item.id)}
            aria-label="Dismiss"
            className="text-[#5a5b78] hover:text-[#8a8fad] flex-shrink-0 text-sm transition-colors leading-none pt-0.5"
          >
            ✕
          </button>
        </div>
      ))}
    </div>
  )
}
