import { redirect } from 'next/navigation'
import { currentMonth } from '@/lib/budget'

export default function BudgetIndexPage() {
  redirect(`/budget/${currentMonth()}`)
}
