---
description: Everything about one unit or customer car - the compliance paper, the deals it has carried, its whole workshop history, the file notes. Resolve by ref, plate, VIN or name.
---

1. Run `node scripts/dealer.mjs vehicle REF --json` (ref, plate, VIN or a make/model fragment all resolve).
2. Present the card: what it is, the odometer, the paper (CIN, PPSR, WoF, as-is), the money (cost, recon, asking or sale), then deals and workshop history.
3. If paper is missing, say exactly which command records it: `vehicle odometer`, `vehicle cin`, `vehicle ppsr --clear`, `vehicle wof --issued=`.
