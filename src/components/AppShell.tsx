'use client'

import { useState } from 'react'
import { usePathname } from 'next/navigation'

export function AppShell({
  sidebarContent,
  children,
}: {
  sidebarContent: React.ReactNode
  children: React.ReactNode
}) {
  const [mobileOpen, setMobileOpen] = useState(false)
  // Restore collapsed state from localStorage on first render
  const [collapsed, setCollapsed] = useState(() => {
    try { return localStorage.getItem('sidebar-collapsed') === 'true' } catch { return false }
  })
  const pathname = usePathname()

  // Close mobile drawer on navigation — derived state pattern (no effect needed)
  const [prevPathname, setPrevPathname] = useState(pathname)
  if (prevPathname !== pathname) {
    setPrevPathname(pathname)
    setMobileOpen(false)
  }

  function toggleCollapsed() {
    const next = !collapsed
    setCollapsed(next)
    try { localStorage.setItem('sidebar-collapsed', String(next)) } catch {}
  }

  return (
    <div className="flex h-screen bg-[#1a1b2e] text-[#ecf0f1] overflow-hidden">
      {/* Mobile backdrop */}
      {mobileOpen && (
        <div
          className="fixed inset-0 z-20 bg-black/60 lg:hidden"
          onClick={() => setMobileOpen(false)}
          aria-hidden="true"
        />
      )}

      {/* Sidebar — mobile: fixed overlay; desktop: in-flow, collapsible */}
      <nav
        className={`
          fixed inset-y-0 left-0 z-30 w-64 flex flex-col flex-shrink-0
          bg-[#1f2039] border-r border-[#3a3b58]
          transition-all duration-200 ease-in-out
          ${mobileOpen ? 'translate-x-0' : '-translate-x-full'}
          lg:relative lg:translate-x-0
          ${collapsed ? 'lg:w-0 lg:overflow-hidden lg:border-r-0' : 'lg:w-72'}
        `}
      >
        {sidebarContent}
      </nav>

      {/* Desktop sidebar toggle strip — always visible, sits between sidebar and content */}
      <button
        onClick={toggleCollapsed}
        title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
        aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
        className="
          hidden lg:flex items-center justify-center flex-shrink-0
          w-[14px] bg-[#1f2039] border-r border-[#3a3b58]
          text-[#3a3b58] hover:text-[#b3a1e6] hover:bg-[#252640]
          transition-colors group
        "
      >
        {/* Chevron — points right when collapsed, left when expanded */}
        <svg
          width="6" height="10" viewBox="0 0 6 10" fill="none"
          stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"
          className="opacity-0 group-hover:opacity-100 transition-opacity"
        >
          {collapsed
            ? <polyline points="1,1 5,5 1,9" />
            : <polyline points="5,1 1,5 5,9" />}
        </svg>
      </button>

      {/* Content area */}
      <div className="flex flex-col flex-1 overflow-hidden min-w-0">
        {/* Mobile top bar */}
        <div className="lg:hidden flex items-center gap-3 px-4 py-3 bg-[#1f2039] border-b border-[#3a3b58] flex-shrink-0">
          <button
            onClick={() => setMobileOpen(true)}
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
