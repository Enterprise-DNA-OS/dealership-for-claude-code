---
description: Draft the vehicle offer and sale agreement for a deal, plus the covering message to the buyer. Drafts to drafts/, never sends.
---

1. Run `node scripts/dealer.mjs vehicle REF --json` and the deal from `deals --json`: the draft states the record, it does not invent.
2. `npm run docs` renders the formal offer-and-sale document from the data in the dealership's brand.
3. Write the covering message (what the price includes, the paper on the car, delivery day) to `drafts/offer-DL-xxxx.md`. Plain words, short sentences, no pressure lines.
4. A person reads it and sends it. Never send anything from here.
