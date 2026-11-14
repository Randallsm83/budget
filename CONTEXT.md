# Budget

Personal envelope budgeting: every dollar on hand is given a job in a category, month by month.

## Language

**Budget month**:
The state of every category's Assigned, Activity and Available, plus Ready to Assign, for one calendar month.
_Avoid_: budget (on its own)

**Assigned**:
The money given to a category for one month.
_Avoid_: budgeted

**Activity**:
The net total of a category's transactions in one month; spending is negative, refunds are positive.
_Avoid_: spent

**Available**:
The money a category holds at the end of a month: what earlier months carried forward, plus Assigned, plus Activity.
_Avoid_: balance, remaining

**Ready to Assign**:
Money that has arrived but that no category holds yet.
_Avoid_: RTA (in prose), unassigned

**Card payment category**:
The category that holds money set aside to pay one credit card's bill; spending on that card moves money into it.
_Avoid_: CC Payment bucket, reserved
_Current implementation_: the card payment row shows the card's current Balance and is not subtracted from Ready to Assign, until [ADR-0001](docs/adr/0001-ready-to-assign-anchored-on-cash.md) lands ([#99](https://github.com/Randallsm83/budget/issues/99)).

**Funded**:
The card spending that moves into a card payment category in one month; refunds on the card reduce it.
_Avoid_: auto-fund, assigned (for card payment categories)

**On-budget account**:
A checking, savings, cash or credit card account whose transactions count toward the budget.
_Avoid_: budget account

**Liquid cash**:
The combined Balance of on-budget checking, savings and cash accounts at the end of a month.
_Avoid_: cash on hand
_Current implementation_: today's Balance is used for every month, until [ADR-0001](docs/adr/0001-ready-to-assign-anchored-on-cash.md) lands ([#99](https://github.com/Randallsm83/budget/issues/99)).

**Pace**:
The share of a month that has elapsed; a finished month is at full pace.

**Projection**:
A category's expected month-end Activity, extrapolated from Activity so far at the current Pace.
_Avoid_: forecast (reserved for the Coach panel)

**Overspent**:
A category whose Available is below zero, or is projected to fall below zero by the end of the month.
_Avoid_: over budget

**Balance**:
What an account holds or owes. Used only for accounts, never for categories.
_Avoid_: available (for accounts)
