'use client'

import { useState, useEffect, useCallback } from 'react'

const KEY = 'budget_admin_mode'

/** Returns [isAdmin, toggle]. Reads/writes localStorage; SSR-safe (defaults to false). */
export function useAdminMode(): [boolean, () => void] {
  const [isAdmin, setIsAdmin] = useState(false)

  useEffect(() => {
    setIsAdmin(localStorage.getItem(KEY) === 'true')
  }, [])

  const toggle = useCallback(() => {
    setIsAdmin((prev) => {
      const next = !prev
      localStorage.setItem(KEY, String(next))
      return next
    })
  }, [])

  return [isAdmin, toggle]
}
