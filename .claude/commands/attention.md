---
description: Everything that wants a decision this morning, worst first. A delivered vehicle with no PPSR check outranks everything, then units offered without a CIN, WoF work under a lapsed inspector, unresolved repair orders, unbilled work, stale deposits, aged stock and overdue money.
---

1. Run `node scripts/dealer.mjs attention --json`.
2. Present it worst first, grouped by reason, in the dealership's words. Lead with anything rank 1 or 2 (a PPSR hole on a delivered unit, a unit offered without a CIN): those are today's first conversations, say so plainly.
3. For each group, say the one action that clears it: run the PPSR search and record it, `vehicle cin VH-xx`, reassign the WoF bookings, `ro done RO-xx --notes=`, `invoice build RO-xx`, ring the deposit holder, reprice the aged unit.
4. If the list is empty, say so in one line and stop.
