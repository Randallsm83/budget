/**
 * Database seed script.
 *
 * Usage:
 *   DATABASE_URL="postgresql://..." npm run db:seed
 *
 * On Windows PowerShell:
 *   $env:DATABASE_URL="postgresql://..."; npm run db:seed
 *
 * Reads SEED_USER_EMAIL, SEED_USER_PASSWORD, SEED_USER_NAME from env.
 * Safe to run multiple times — skips if user already exists.
 */

if (!process.env.DATABASE_URL) {
  console.error('ERROR: DATABASE_URL is not set.')
  console.error('Set it before running: $env:DATABASE_URL="postgresql://..."')
  process.exit(1)
}

import { neon } from '@neondatabase/serverless'
import { drizzle } from 'drizzle-orm/neon-http'
import { eq } from 'drizzle-orm'
import bcrypt from 'bcryptjs'
import { users, categoryGroups, categories } from './schema'

const sql = neon(process.env.DATABASE_URL)
const db = drizzle(sql)

const DEFAULT_GROUPS = [
  {
    name: 'Immediate Obligations',
    cats: ['Rent / Mortgage', 'Electric', 'Water', 'Internet', 'Groceries', 'Transportation', 'Phone'],
  },
  {
    name: 'True Expenses',
    cats: ['Car Insurance', 'Home Insurance', 'Medical', 'Clothing', 'Home Maintenance', 'Emergency Fund'],
  },
  {
    name: 'Debt Payments',
    cats: ['Credit Card Payment'],
  },
  {
    name: 'Quality of Life',
    cats: ['Dining Out', 'Entertainment', 'Subscriptions', 'Personal Care'],
  },
]

async function seed() {
  const email = process.env.SEED_USER_EMAIL ?? 'admin@example.com'
  const password = process.env.SEED_USER_PASSWORD ?? 'changeme'
  const name = process.env.SEED_USER_NAME ?? 'Admin'

  const existing = await db.select().from(users).where(eq(users.email, email)).limit(1)
  if (existing.length > 0) {
    console.log(`User "${email}" already exists — skipping.`)
    return
  }

  const passwordHash = await bcrypt.hash(password, 12)
  const [user] = await db.insert(users).values({ name, email, passwordHash }).returning()
  console.log(`✓ Created user: ${user.email}`)

  for (let gi = 0; gi < DEFAULT_GROUPS.length; gi++) {
    const g = DEFAULT_GROUPS[gi]
    const [group] = await db
      .insert(categoryGroups)
      .values({ userId: user.id, name: g.name, sortOrder: gi })
      .returning()

    for (let ci = 0; ci < g.cats.length; ci++) {
      await db.insert(categories).values({
        userId: user.id,
        groupId: group.id,
        name: g.cats[ci],
        sortOrder: ci,
      })
    }
    console.log(`  ✓ ${g.name} (${g.cats.length} categories)`)
  }

  console.log('\nSeed complete! You can now sign in at http://localhost:3000/login')
}

seed().catch((err) => {
  console.error(err)
  process.exit(1)
})
