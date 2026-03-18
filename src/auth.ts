import NextAuth from 'next-auth'
import Credentials from 'next-auth/providers/credentials'
import { eq } from 'drizzle-orm'
import bcrypt from 'bcryptjs'
import * as OTPAuth from 'otpauth'
import { db } from '@/db'
import { users } from '@/db/schema'

export const { handlers, auth, signIn, signOut } = NextAuth({
  providers: [
    Credentials({
      credentials: {
        email: { label: 'Email', type: 'email' },
        password: { label: 'Password', type: 'password' },
        totpCode: { label: 'Code', type: 'text' },
      },
      async authorize(credentials) {
        if (!credentials?.email || !credentials?.password) return null

        const user = await db.query.users.findFirst({
          where: eq(users.email, credentials.email as string),
        })
        if (!user) return null

        const valid = await bcrypt.compare(
          credentials.password as string,
          user.passwordHash,
        )
        if (!valid) return null

        // If MFA is enabled, require a valid TOTP code
        if (user.mfaEnabled && user.mfaSecret) {
          const code = (credentials.totpCode as string | undefined)?.trim()
          if (!code) return null
          const totp = new OTPAuth.TOTP({ secret: OTPAuth.Secret.fromBase32(user.mfaSecret) })
          const delta = totp.validate({ token: code, window: 1 })
          if (delta === null) return null
        }

        return { id: user.id, email: user.email, name: user.name }
      },
    }),
  ],

  // JWT sessions — no session table needed, no auth provider account table conflict
  session: { strategy: 'jwt' },

  pages: {
    signIn: '/login',
  },

  callbacks: {
    jwt({ token, user }) {
      if (user) token.id = user.id
      return token
    },
    session({ session, token }) {
      session.user.id = token.id as string
      return session
    },
  },
})
