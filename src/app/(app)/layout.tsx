import { auth } from '@/auth'
import { redirect } from 'next/navigation'
import { eq, asc, and } from 'drizzle-orm'
import { db } from '@/db'
import { accounts } from '@/db/schema'
import { NavLink } from '@/components/NavLink'
import { SignOutButton } from '@/components/SignOutButton'
import { formatMoney } from '@/lib/budget'

const TYPE_ICONS: Record<string, string> = {
  checking: '🏦',
  savings: '💵',
  credit_card: '💳',
  cash: '💸',
  other: '📁',
}

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const session = await auth()
  if (!session) redirect('/login')

  const userAccounts = await db
    .select({ id: accounts.id, name: accounts.name, type: accounts.type, balance: accounts.balance })
    .from(accounts)
    .where(and(eq(accounts.userId, session.user.id), eq(accounts.closed, false)))
    .orderBy(asc(accounts.createdAt))

  const netWorth = userAccounts.reduce((sum, a) => sum + a.balance, 0)

  return (
    <div className="flex h-screen bg-[#1a1b2e] text-[#ecf0f1] overflow-hidden">
      {/* Sidebar */}
      <nav className="w-56 flex-shrink-0 bg-[#1f2039] flex flex-col border-r border-[#3a3b58]">
        {/* Branding */}
        <div className="px-4 py-4 border-b border-[#3a3b58]">
          <div className="flex items-center gap-2">
            <img src="/logo.svg" alt="" aria-hidden="true" className="w-7 h-7 flex-shrink-0" />
            <h1 className="text-lg font-bold text-[#b3a1e6] tracking-tight">Budget</h1>
          </div>
          <p className="text-xs text-[#8a8fad] mt-0.5 truncate">{session.user?.name}</p>
        </div>

        {/* Nav links */}
        <div className="flex-1 overflow-y-auto p-2 space-y-0.5">
          <NavLink href="/budget">
            <span>📊</span>
            Budget
          </NavLink>

          {/* Accounts section */}
          <div className="pt-3 pb-1 px-3">
            <p className="text-[10px] font-bold text-[#8a8fad] uppercase tracking-widest">Accounts</p>
          </div>

          <NavLink href="/accounts" exact>
            <span>＋</span>
            <span className="text-xs">All Accounts</span>
          </NavLink>

          {userAccounts.map((account) => (
            <NavLink key={account.id} href={`/accounts/${account.id}`}>
              <span className="text-base leading-none flex-shrink-0">
                {TYPE_ICONS[account.type] ?? '📁'}
              </span>
              <span className="flex-1 truncate text-xs">{account.name}</span>
              <span
                className={`text-xs tabular-nums flex-shrink-0 ${
                  account.balance < 0 ? 'text-[#ce6f8f]' : 'text-[#5ccc96]'
                }`}
              >
                {formatMoney(account.balance)}
              </span>
            </NavLink>
          ))}

          {userAccounts.length > 0 && (
            <div className="px-3 py-1.5 flex justify-between items-center">
              <span className="text-[10px] text-[#8a8fad] uppercase tracking-wide">Net Worth</span>
              <span
                className={`text-xs font-semibold tabular-nums ${
                  netWorth < 0 ? 'text-[#ce6f8f]' : 'text-[#5ccc96]'
                }`}
              >
                {formatMoney(netWorth)}
              </span>
            </div>
          )}
        </div>

        {/* Sign out */}
        <div className="p-2 border-t border-[#3a3b58] space-y-0.5">
          <NavLink href="/settings/security">
            <span>🔒</span>
            <span className="text-xs">Security</span>
          </NavLink>
          <SignOutButton />
        </div>
      </nav>

      {/* Main content */}
      <main className="flex-1 overflow-hidden flex flex-col">{children}</main>
    </div>
  )
}
