---
description: Today's workshop board - what is booked and open, plus anything unresolved from earlier days (a booked job whose day passed with no story, an open job going stale).
---

1. Run `node scripts/dealer.mjs workshop --json`.
2. Present today's jobs in time order, then the unresolved ones with days. A BOOKED PAST job gets one question: did the customer come? Then `ro start`, `ro done`, or rebook.
3. Job flow: `ro book VEHICLE --tech= --type= --at=`, `ro start REF`, `ro add REF ITEM`, `ro done REF --notes=` (WoF jobs also need `--result=pass|fail`).
