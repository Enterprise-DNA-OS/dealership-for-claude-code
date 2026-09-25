# Dealership for Claude Code: operating instructions

This file is the brain. Claude Code reads it at the start of every session. It says who this is for, how work gets done, and the one right way to do each recurring job.

## Who this is for

- **Business:** [YOUR DEALERSHIP]
- **Operator:** [YOUR NAME], [your role]
- **Who signs off pricing changes on stock:** [name]
- **Who runs the service-due call sheet, and how often:** [name, cadence]
- **What matters most:** [the one or two outcomes you care about]

Fill this in once. A worker with context knows. A worker without it guesses.

## How to work

1. **Take a brief, not a script.** The operator describes the outcome. You run the right command and present the answer.
2. **Read before you write.** Before drafting anything about a record, read its full history first.
3. **Plain language.** Short sentences. No filler. Numbers in tables.
4. **Silent success, loud problems.** No play-by-play. Say what broke and what you did about it.
5. **Stop at the line.** Anything that sends, deletes, or faces a customer waits for a yes in this session.

## Routing table: one right way for each recurring job

| When the operator asks for... | Use this |
|---|---|
| What needs my attention, what's wrong, morning check | `/attention` |
| The yard, the lot, what's in stock, days in stock | `/lot` |
| What has sat too long, the interest bill, reprice or auction | `/aged` |
| Everything about a unit or a customer's car | `/vehicle` |
| A trade-in or auction buy arriving | `/stock-in` |
| The deals board, deposits, what's going cold | `/deals` |
| Quote a car, take a deposit, deliver it, lose it | `/deal` |
| Who sold what, true gross by salesperson | `/sales` |
| Today in the workshop, the board | `/workshop` |
| Who's due a service, the retention call sheet | `/service-due` |
| Everything about a customer | `/customer` |
| The customer list | `/customers` |
| The staff, whose inspector authorisation is due | `/team` |
| Who owes money | `/debtors` |
| Finished work nobody billed | `/unbilled` |
| Parts: what's low, out, receiving stock | `/parts` |
| Are we compliant, check the rules | `/compliance` |
| The Monday review | `/weekly-review` |
| Note a call, a promise, a pricing decision | `/log` |
| Draft the offer and sale paperwork message | `/draft-offer` |
| Draft the service reminder messages | `/draft-service-reminders` |
| Bring the data across from CDK | `/import` |
| Change a field, a threshold, a rule, a document | `/customise` |
| A new dashboard page | `/new-view` |

If an ask fits nothing here, run the CLI directly (`npm run dealer -- help`) and then propose a new command for it.

## Hard rules

- Never send email or messages from here. Draft to `drafts/`, a person sends.
- Never delete records without an explicit yes in this session. Prefer marking closed or archived.
- Never invent a record. If a name is ambiguous, list the candidates and ask.
- The database is the source of truth. If the answer is not in it, say so.

## Where things live

- `scripts/` the CLI. `scripts/lib/db.mjs` picks `DATABASE_URL` (Postgres, Supabase) or the embedded database in `.data/`.
- `supabase/migrations/` the schema, plain SQL. `npm run migrate` applies it.
- `.claude/commands/` the slash commands. Add one every time the same ask comes twice.
- `docs/` the thesis and the guide for moving off CDK Global.

Built by Enterprise DNA. Installed and run for you as part of Omni: https://enterprisedna.co/omni/instead-of/cdk
