---
description: The units that have sat past the aged line, with what each has cost in floorplan interest so far. The pricing meeting starts here.
---

1. Run `node scripts/dealer.mjs aged --json`.
2. For each unit: days in, cost plus recon (what it owes us), asking, and the interest bill so far. Say what the asking price needs to clear.
3. End with the two moves per unit: reprice, or book it to auction. `deal price` changes a live deal; `note add VH-xx` records the pricing decision.
