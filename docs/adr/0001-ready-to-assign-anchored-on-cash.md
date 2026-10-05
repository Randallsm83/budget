---
status: accepted
---

# Ready to Assign is anchored on liquid cash, not a running total

Plaid-linked accounts only carry the transaction history Plaid provides (about 30 days at first, more later) and get no Starting Balance transaction, so an account's transactions do not add up to its Balance. A running-total Ready to Assign (inflows + income − Assigned, carried forward month to month) would silently miss every dollar that predates the import window. We therefore compute Ready to Assign as Liquid cash at the end of the month, minus Available in expense categories, minus Available in card payment categories. The card term is clamped between 0 and the amount owed on the card at the end of the month. For past months, both Liquid cash and the amount owed are reconstructed as today's Balance minus every transaction on that account dated after the month, so every term describes the same point in time; the card payment row shows that same month-end amount owed.

## Considered Options

- **Running total** (the standard envelope-budgeting definition): rejected because of the Plaid import window described above.
- **Cash-anchored without the clamp**: rejected because purchases from before the import window are missing while later card payments are counted, which drives a card payment category's Available negative and inflates Ready to Assign.
- **Cash-anchored using the card's Balance instead of the card payment category's Available**: rejected because it subtracts the debt rather than the money set aside for it.
