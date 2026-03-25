import { auth } from '@/auth'
import { db } from '@/db'
import { categoryGroups, categories } from '@/db/schema'
import { asc, and, eq } from 'drizzle-orm'
import Link from 'next/link'
import { CategoryManager, type ManagedGroup } from '@/components/CategoryManager'

export default async function CategoriesSettingsPage() {
  const session = await auth()
  const userId = session!.user.id

  const groups = await db.query.categoryGroups.findMany({
    where: and(
      eq(categoryGroups.userId, userId),
      eq(categoryGroups.isSystem, false),
      eq(categoryGroups.isTransfer, false),
    ),
    with: {
      categories: {
        orderBy: [asc(categories.sortOrder)],
        columns: { id: true, name: true, sortOrder: true },
      },
    },
    orderBy: [asc(categoryGroups.sortOrder)],
  })

  const initialGroups: ManagedGroup[] = groups.map((g) => ({
    id: g.id,
    name: g.name,
    isIncome: g.isIncome,
    categories: g.categories,
  }))

  return (
    <div className="flex-1 overflow-auto">
      <div className="max-w-2xl mx-auto px-6 py-8">
        <div className="flex items-center gap-3 mb-6">
          <Link
            href="/budget"
            className="text-xs text-[#8a8fad] hover:text-[#ecf0f1] transition-colors flex items-center gap-1"
          >
            ← Budget
          </Link>
          <span className="text-[#3a3b58]">/</span>
          <Link
            href="/settings/security"
            className="text-xs text-[#8a8fad] hover:text-[#ecf0f1] transition-colors"
          >
            Settings
          </Link>
        </div>

        <h1 className="text-xl font-bold text-[#ecf0f1] mb-1">Groups &amp; Categories</h1>
        <p className="text-sm text-[#8a8fad] mb-8">
          Organize your budget. Drag to reorder. Double-click any name to rename.
        </p>

        <CategoryManager initialGroups={initialGroups} />
      </div>
    </div>
  )
}
