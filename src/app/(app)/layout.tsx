import { auth } from '@/auth'
import { redirect } from 'next/navigation'
import Link from 'next/link'
import { SignOutButton } from '@/components/SignOutButton'

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const session = await auth()
  if (!session) redirect('/login')

  return (
    <div className="flex h-screen bg-[#1a1b2e] text-[#ecf0f1] overflow-hidden">
      {/* Sidebar */}
      <nav className="w-52 flex-shrink-0 bg-[#1f2039] flex flex-col border-r border-[#3a3b58]">
        {/* Branding */}
        <div className="px-4 py-5 border-b border-[#3a3b58]">
          <h1 className="text-lg font-bold text-[#b3a1e6] tracking-tight">💰 Budget</h1>
          <p className="text-xs text-[#8a8fad] mt-0.5 truncate">{session.user?.name}</p>
        </div>

        {/* Nav links */}
        <div className="flex-1 p-2 space-y-0.5">
          <Link
            href="/budget"
            className="flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm text-[#8a8fad]
                       hover:bg-[#2a2b45] hover:text-[#ecf0f1] transition-colors"
          >
            <span>📊</span>
            Budget
          </Link>
          <Link
            href="/accounts"
            className="flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm text-[#8a8fad]
                       hover:bg-[#2a2b45] hover:text-[#ecf0f1] transition-colors"
          >
            <span>🏦</span>
            Accounts
          </Link>
        </div>

        {/* Sign out */}
        <div className="p-2 border-t border-[#3a3b58]">
          <SignOutButton />
        </div>
      </nav>

      {/* Main content */}
      <main className="flex-1 overflow-hidden flex flex-col">{children}</main>
    </div>
  )
}
