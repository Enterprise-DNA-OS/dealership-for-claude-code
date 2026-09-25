---
description: The rule book run against the records - CIN on every unit offered, PPSR before delivery, WoF inside the month, inspector authorisations, AML customer due diligence on big cash, odometer readings, trader registration, repair order records. Each rule cites its source.
---

1. Run `node scripts/dealer.mjs compliance --json` (add a rule key for one rule).
2. Present rule by rule: ok or the named breaches. For each breach, the one command or phone call that clears it.
3. The sharpest rules are also gates in the CLI with no force flags; say so when a breach can only have come in through import - it means the old system allowed what this one refuses.
4. Sources live in docs/compliance.md; nothing in it is legal advice, and the operator owns keeping the rules current.
