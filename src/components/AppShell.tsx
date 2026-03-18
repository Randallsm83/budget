'use client'

import { useState, useEffect } from 'react'
import { usePathname } from 'next/navigation'

export function AppShell({
  sidebarContent,
  children,
}: {
  sidebarContent: React.ReactNode
  children: React.ReactNode
}) {
  const [open, setOpen] = useState(false)
  const pathname = usePathname()

  // Close drawer on navigation
  useEffect(() => {
    setOpen(false)
  }, [pathname])

  return (
    <div className="flex h-screen bg-[#1a1b2e] text-[#ecf0f1] overflow-hidden">
      {/* Mobile backdrop */}
      {open && (
        <div
          className="fixed inset-0 z-20 bg-black/60 lg:hidden"
          onClick={() => setOpen(false)}
          aria-hidden="true"
        />
      )}

      {/* Sidebar — fixed overlay on mobile, in-flow on desktop */}
      <nav
        className={`
          fixed inset-y-0 left-0 z-30 w-64 flex flex-col flex-shrink-0
          bg-[#1f2039] border-r border-[#3a3b58]
          transition-transform duration-200 ease-in-out
          ${open ? 'translate-x-0' : '-translate-x-full'}
          lg:relative lg:w-56 lg:translate-x-0
        `}
      >
        {sidebarContent}
      </nav>

      {/* Content area */}
      <div className="flex flex-col flex-1 overflow-hidden min-w-0">
        {/* Mobile top bar */}
        <div className="lg:hidden flex items-center gap-3 px-4 py-3 bg-[#1f2039] border-b border-[#3a3b58] flex-shrink-0">
          <button
            onClick={() => setOpen(true)}
            className="p-1 text-[#8a8fad] hover:text-[#ecf0f1] transition-colors"
            aria-label="Open navigation"
          >
            <svg width="18" height="18" viewBox="0 0 18 18" fill="currentColor" aria-hidden="true">
              <rect y="2"  width="18" height="2" rx="1" />
              <rect y="8"  width="18" height="2" rx="1" />
              <rect y="14" width="18" height="2" rx="1" />
            </svg>
          </button>
          <span className="text-sm font-bold text-[#b3a1e6] tracking-tight">Budget</span>
        </div>

        <main className="flex-1 overflow-hidden flex flex-col">{children}</main>
      </div>
    </div>
  )
}
