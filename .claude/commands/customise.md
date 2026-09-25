---
description: Make this system yours in plain language. Add a field, change the aged line or the AML threshold, add a job type, put the account manager on the statement. Writes the migration, applies it, updates the commands that touch it.
---

The operator will describe a change in their own words, for example "add a buyer's fee to every auction unit", "our aged line is 60 days", "add a valet job type", "put our AFS licence number on the offer document".

1. Read `CLAUDE.md`, the current schema in `supabase/migrations/`, and any command or document that touches the thing being changed. Say back in one line what you are about to change and where.
2. Settings that already exist (floorplan rate, aged days, service-due days, AML threshold, registration expiry) change with `settings set`, no migration needed.
3. Otherwise write the next numbered migration in `supabase/migrations/` (never edit an applied one). Default new columns sensibly so existing rows stay valid.
4. Run `npm run migrate`. Update every place the change shows up: the CLI output, the affected slash commands, `views.json`, `documents.json`, the import mapping, and the README command table.
5. Run `npm test`. Add an assertion for the new behaviour if the change is visible in a command's output.
6. Update `brand.json` if the change is branding (business name, logo, colours) and rerun `npm run docs` or `npm run view` to show it.

Report in three lines: what changed, the migration file, the commands that now show it. Never delete a column or a table without an explicit yes in this session.
