'use client'

import { signOut } from 'next-auth/react'

export function SignOutButton() {
  return (
    <button
      onClick={() => signOut({ callbackUrl: '/login' })}
      className="w-full text-left text-sm text-[#8a8fad] hover:text-[#ce6f8f] px-3 py-2 rounded-lg
                 hover:bg-[#2a2b45] transition-colors"
    >
      Sign out
    </button>
  )
}
