# UX Heuristics — Budget App Audit Reference

Heuristics adapted for this specific app. Apply these lenses at every screen during the audit.

---

## 1. Visibility of System Status

The app should always show the user what's happening.

Check:
- When a server action is in flight (budget save, add transaction), is there a visible pending state? Or does the UI appear frozen?
- When a sync runs (Plaid), is progress communicated or does it just silently complete?
- Does the current month always show prominently? A user should never wonder "what month am I looking at?"
- After any write action, is there a confirmation signal (row appears, amount updates, toast)?

Known risk: Server Actions use `useTransition` — if `isPending` isn't wired to visible UI, actions appear to do nothing for 200–500ms.

---

## 2. Match Between System and the Real World

Language and concepts should match how users think about money, not how the code models it.

Check:
- **"Ready to Assign"** — does this make sense to someone who hasn't used YNAB? Consider: "Available to Budget", "Unallocated Money", "Money to Give a Job"
- **"Activity"** column — does this mean spending? Income? Both? Label alone is ambiguous.
- **"Balance"** column — is this the remaining envelope balance or the account balance? (It's the envelope balance, which is non-obvious.)
- **"Inflow / Ready to Assign"** as a transaction category — confusing to new users who expect a payee-based categorization model
- **Account types** — "other", "investment", "vehicle" — are these clear without tooltips?
- **"Tracking" accounts** — this is YNAB jargon. Is it explained?
- **CC Payment categories** — appear automatically with no explanation. Very confusing.

---

## 3. User Control and Freedom

Users make mistakes. Escape hatches matter.

Check:
- Can a budget amount be set back to $0 easily? (Yes, inline edit — but is the path obvious?)
- Is deleting a transaction reversible? Is there an undo or at minimum a confirmation?
- Can categories and groups be deleted safely — with a warning about existing transactions?
- Can the user cancel the Add Transaction modal without saving? (Click outside / Escape)
- Can the Plaid connection be disconnected cleanly? Is the impact (what data is removed) explained?
- When MFA is disabled, is the user warned they're reducing account security?

---

## 4. Consistency and Standards

Similar things should look and behave the same. App should follow web conventions.

Check:
- Are all modals opened/closed the same way (click outside, X button, Escape key)?
- Are all action buttons in the same position in modals (Save bottom-right, Cancel bottom-left)?
- Do all delete actions have the same confirmation pattern?
- Does the date input format match the user's locale expectation?
- Are destructive actions (delete) always red / visually distinct from neutral actions?
- Are inline edit inputs styled consistently across budget cells, category names, account names?

---

## 5. Error Prevention

The best error message is the one that never needs to appear.

Check:
- Does the "Cover" button (zero out a category) warn if it will put RTA negative?
- Is there any protection against accidentally deleting a category with transactions?
- Does the app prevent submitting a transaction with an invalid amount (e.g. letters, negative)?
- When connecting Plaid, is it clear before starting that the user's bank credentials are going to Plaid, not to this app?
- Is the starting balance field on account creation protected against typos (e.g. entering $10,000 instead of $1,000)?

Known code detail: `CoverButton` does compute `rtaAfter` and sets `warn = rtaAfter < 0` — check if this warning is actually visible and prominent enough.

---

## 6. Recognition Over Recall

Users shouldn't have to remember things between screens.

Check:
- On the budget page, can the user tell what each column (Budgeted, Activity, Balance) means without prior knowledge?
- In the Add Transaction modal's category dropdown, are categories organized in a way that makes them easy to find (by group, alphabetically)?
- Are the keyboard shortcuts for inline editing documented anywhere (Enter = save, Escape = cancel)?
- Does the app show the account name clearly when viewing a transaction register, so the user always knows where they are?
- Is the current month shown in a way that doesn't require recalling where you navigated from?

---

## 7. Flexibility and Efficiency

Power users should be able to move fast. Beginners should be unharmed.

Check:
- Can a power user tab through the budget table and set amounts with keyboard alone?
- Is there a keyboard shortcut to add a new transaction?
- Can categories be bulk-moved between groups?
- Can transactions be bulk-deleted or bulk-categorized?
- Is the drag-to-reorder functionality fast and reliable, or sluggish?
- Is there a way to quickly jump to the current month if you've navigated far back?

---

## 8. Aesthetic and Minimalist Design

Financial tools carry anxiety. Every unnecessary element adds cognitive load.

Check:
- Does the budget page feel overwhelming or scannable?
- Are there visual hierarchy cues that draw the eye to what matters most (overspent categories, negative RTA)?
- Is the dark color scheme readable — are contrast ratios sufficient? (Check: purple-on-dark-bg for secondary text)
- Is the CC Payments section visually separated enough from the rest of the budget to not cause confusion?
- Are banners (RelinkBanner, NewAccountsBanner) proportionate — noticeable without hijacking the whole screen?
- Does the sidebar feel cluttered or organized with many accounts?

---

## 9. Help Users Recognize, Diagnose, and Recover from Errors

Error messages should be plain-language, specific, and tell the user what to do.

Check:
- Zod validation errors on forms — are they shown inline next to the field, or as a generic toast?
- When Plaid sync fails, what does the user see? Is the error actionable?
- When a network request fails (Server Action), does the UI revert or get stuck?
- For invalid month URLs (`/budget/abc`), is the error page helpful?
- Are auth errors on login specific enough to help without being a security risk?

---

## 10. Help and Documentation

This app implements complex financial concepts. Missing guidance is a pain point.

Check:
- Is there any onboarding flow or "how this works" explanation for new users?
- Is "envelope budgeting" or "YNAB-style" explained anywhere in the app?
- Are tooltips or help icons used for non-obvious concepts (RTA, CC auto-funding)?
- Are empty states instructional (explaining what to do) or just blank?
- Is there a "what is this?" explanation for the CC Payments section?

---

## Known Risk Areas from Code Analysis

These are specific areas to pay extra attention to, based on reading the codebase:

**Inline budget editing** (`EditableBudgeted` in `BudgetTable.tsx`)
- The budgeted cell is a `<button>` that becomes an `<input>` on click — not obviously interactive
- Enter/Escape keyboard shortcuts are undocumented
- `disabled={isPending}` shows opacity-50 while saving — subtle, possibly missed

**Category dropdown in Add Transaction** (`AddTransactionModal.tsx`)
- Uses a native `<select>` with `<optgroup>` — no search/filter for 30+ categories
- "Inflow / Ready to Assign" is the first option (empty value) — meaning is not obvious
- isOutflow auto-flips when an income category is selected — unexpected behavior

**CC Payment section** (`BudgetTable.tsx` → `CCPaymentSection`)
- Appears automatically with no explanation
- Budgeted amount is read-only but doesn't visually communicate this clearly
- The auto-funding mechanic (CC spending auto-funds the payment category) is invisible to the user

**Drag-and-drop** (`@dnd-kit`)
- Uses `TouchSensor` but DnD on mobile budget tables is notoriously tricky
- The grip icon is small (10×16px) — hard to target on touch

**RTA display** (`RtaDisplay.tsx`)
- Likely shows negative RTA in red — verify the visual is alarming enough
- The "Cover" suggestion list (when categories are overspent) — is it discoverable?

**No toast/notification system observed**
- Confirm: after saving a budget amount, adding a transaction, etc. — is there any feedback?
- Server actions close modals on success (`onClose()`) but no global notification was found — this may mean silent successes which feel like failures

**Middleware / auth redirects** (`src/proxy.ts`)
- Unauthenticated users hit `/budget/:path*` → redirect to `/login` — is the redirect seamless, or does it flash?
