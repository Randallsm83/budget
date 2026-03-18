import { NextRequest, NextResponse } from 'next/server'
import { eq } from 'drizzle-orm'
import bcrypt from 'bcryptjs'
import { db } from '@/db'
import { users } from '@/db/schema'

export async function POST(req: NextRequest) {
  try {
    const { email, password } = await req.json()
    if (!email || !password) {
      return NextResponse.json({ error: 'Invalid credentials' }, { status: 400 })
    }

    const user = await db.query.users.findFirst({
      where: eq(users.email, email),
    })
    if (!user) {
      // Constant-time: still compare against a dummy hash to prevent timing attacks
      await bcrypt.compare(password, '$2b$10$dummy.hash.to.prevent.timing.attacks.padding')
      return NextResponse.json({ error: 'Invalid credentials' }, { status: 401 })
    }

    const valid = await bcrypt.compare(password, user.passwordHash)
    if (!valid) {
      return NextResponse.json({ error: 'Invalid credentials' }, { status: 401 })
    }

    return NextResponse.json({ mfaRequired: user.mfaEnabled })
  } catch {
    return NextResponse.json({ error: 'Server error' }, { status: 500 })
  }
}
