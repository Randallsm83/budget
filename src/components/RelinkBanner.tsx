'use client'

import { useState } from 'react'
import Link from 'next/link'

interface RelinkAccount {
  id: string
  name: string
}

export function RelinkBanner({ accounts }: { accounts: RelinkAccount[] }) {
  const [dismissed, setDismissed] = useState(false)

  if (dismissed || accounts.length === 0) return null

  const plural = accounts.length > 1

  return (
    <div className="flex-shrink-0 bg-[#e39400]/10 border-b border-[#e39400]/30 px-4 py-2.5 flex items-start gap-3">
      <span className="text-[#e39400] flex-shrink-0 mt-0.5 text-sm">⚠</span>
      <div className="flex-1 min-w-0 text-sm">
        <span className="font-medium text-[#e39400]">
          {plural
            ? `${accounts.length} bank connections need attention`
            : 'Bank connection needs attention'}
        </span>
        <span className="text-[#8a8fad]">
          {' — '}transaction syncing has paused.{' '}
          {plural ? (
            <>
              Re-link{' '}
              {accounts.map((a, i) => (
                <span key={a.id}>
                  <Link href={`/accounts/${a.id}`} className="text-[#e39400] hover:underline">
                    {a.name}
                  </Link>
                  {i < accounts.length - 1 ? ', ' : ''}
                </span>
              ))}
              {' '}to restore syncing.
            </>
          ) : (
            <>
              Go to{' '}
              <Link href={`/accounts/${accounts[0].id}`} className="text-[#e39400] hover:underline">
                {accounts[0].name}
              </Link>{' '}
              and click <strong className="text-[#ecf0f1] font-medium">Re-link Bank</strong> — it only takes a moment.
            </>
          )}
        </span>
      </div>
      <button
        onClick={() => setDismissed(true)}
        aria-label="Dismiss"
        className="text-[#5a5b78] hover:text-[#8a8fad] flex-shrink-0 text-sm transition-colors leading-none pt-0.5"
      >
        ✕
      </button>
    </div>
  )
}
