---
description: Draft the service reminder messages for every car on the service-due list. Drafts to drafts/, never sends.
---

1. Run `node scripts/dealer.mjs service-due --json`.
2. One short message per owner to `drafts/service-reminders-YYYY-MM-DD.md`: their car, how long it has been, one line to book. No discount invented, no urgency theatre.
3. Include the call sheet (name, phone, car, days) at the top for whoever prefers to ring. A person sends the messages; this system never does.
