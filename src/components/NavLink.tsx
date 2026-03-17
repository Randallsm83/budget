'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'

interface Props {
  href: string
  children: React.ReactNode
  exact?: boolean
}

export function NavLink({ href, children, exact = false }: Props) {
  const pathname = usePathname()
  const active = exact ? pathname === href : pathname.startsWith(href)

  return (
    <Link
      href={href}
      className={`flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm transition-colors
        ${active
          ? 'bg-[#2a2b45] text-[#ecf0f1] font-medium'
          : 'text-[#8a8fad] hover:bg-[#2a2b45] hover:text-[#ecf0f1]'
        }`}
    >
      {children}
    </Link>
  )
}
