---
description: The lot on one screen - every unit in stock with days in, recon spent, floorplan interest accruing, the compliance paper (CIN, PPSR, WoF) and its state. The daily walk of the yard without leaving the desk.
---

1. Run `node scripts/dealer.mjs lot --json`.
2. Present it longest-sitting first. Call out loudly: anything AGED, anything missing paper (NO CIN, NO ODOMETER, PPSR?), and the floorplan interest total.
3. If the operator asks about one unit, run `node scripts/dealer.mjs vehicle REF --json` for the whole card.
