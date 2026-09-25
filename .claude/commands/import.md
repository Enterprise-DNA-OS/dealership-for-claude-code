---
description: Bring the dealership across from CDK (or any DMS whose exports land in CSV) - customers then vehicles, dry-run first. The import is the first audit.
---

1. Read `docs/replace-cdk.md` for what exports, what maps, and what deliberately starts fresh.
2. Dry run first: `node scripts/dealer.mjs import cdk --customers=customers.csv --vehicles=vehicles.csv --dry-run --json`. Read the skips out loud: a vehicle with no make or model is a question about the old data, not a rounding error.
3. Run it for real, then re-run it: the second pass must create nothing new (it updates instead). That is the idempotency check.
4. Every imported unit arrives with no CIN and no PPSR on record, deliberately. After import, run the honesty sweep: `compliance --json` (the paper gaps are now named), `lot --json` (odometers all present?), then walk the paper unit by unit.
5. Present: created, updated, skipped-and-why, and the three commands the operator should run next.
