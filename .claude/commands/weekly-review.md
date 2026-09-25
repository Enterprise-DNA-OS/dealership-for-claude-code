---
description: The Monday review, written from four commands - what needs a decision, the deals board, how the money sits, and what the lot is costing.
---

1. Run four commands, `--json` each: `node scripts/dealer.mjs attention`, `deals`, `debtors`, `aged`. Add `service-due` if the call list runs this week.
2. Write the review in four short sections, prose plus small tables, nothing invented:
   - **Today's decisions.** The attention list, worst first, one action each. A PPSR hole or a CIN-less unit on the yard is the first line of the whole review.
   - **The deals.** Deposits and their age, quotes, last week's deliveries with gross by salesperson, lost deals and their reasons.
   - **The money.** Unbilled total and oldest days, debtors by age, which invoices to build or chase.
   - **The lot.** Aged units with their interest bills and the reprice-or-auction call for each.
3. End with at most five actions for the week, each doable with a single command or phone call.
4. If the operator wants it on paper, `npm run view` renders the week and money pages in the dealership's brand.
