<h1 align="center">Dealership for Claude Code</h1>

<p align="center">
  <strong>The open-source dealer management system that is just a database and Claude Code.</strong>
</p>

<p align="center">
  Created by <a href="https://www.enterprisedna.co"><strong>Enterprise DNA</strong></a>. Free and open source. Works with Claude Code, Codex, OpenCode or Cursor.
</p>

<table align="center">
  <tr>
    <td align="center"><strong>Do it yourself</strong><br/>Clone it, run it, own it. Free, MIT.<br/><a href="#quick-start">Quick start</a></td>
    <td align="center"><strong>We customise it</strong><br/>Your fields, your rules, your CDK Global data brought across.<br/><a href="https://calendly.com/sam-mckay/discovery-call?utm_source=github&utm_medium=readme&utm_campaign=cdk">Book a call</a></td>
    <td align="center"><strong>We run it for you</strong><br/>Installed, connected and operated inside Omni. Setup fee, then a retainer.<br/><a href="https://enterprisedna.co/omni/instead-of/cdk?utm_source=github&utm_medium=readme&utm_campaign=cdk">How it works</a></td>
  </tr>
</table>

<p align="center">
  <a href="#what-is-this">What is this</a> &bull;
  <a href="#why-no-front-end">Why no front end</a> &bull;
  <a href="#quick-start">Quick start</a> &bull;
  <a href="#the-commands">Commands</a> &bull;
  <a href="#instead-of-cdk">Instead of CDK Global</a> &bull;
  <a href="#want-it-installed-and-run-for-you">Installed for you</a> &bull;
  <a href="#license">License</a>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/Node-20+-339933?style=flat-square" alt="Node 20+" />
  <img src="https://img.shields.io/badge/PostgreSQL-any-336791?style=flat-square" alt="PostgreSQL" />
  <img src="https://img.shields.io/badge/PGlite-embedded-3ecf8e?style=flat-square" alt="PGlite" />
  <img src="https://img.shields.io/badge/License-MIT-yellow?style=flat-square" alt="MIT License" />
</p>

---

## What is this

Dealership for Claude Code does the job you pay CDK Global for, as a Postgres database and a set of agent commands. There is no web front end. You open the folder in [Claude Code](https://claude.com/claude-code) (or Codex, OpenCode, Cursor: see `AGENTS.md`) and ask for what you want in plain language. It runs the right query, and it can answer questions the CDK Global dashboard cannot.

The bill this replaces is not small. CDK's own materials put the average dealership's monthly spend near USD $30,000 once the usual ten to fifteen bolt-on modules are counted ([Software Advice's CDK Drive profile](https://www.softwareadvice.com/crm/cdk-drive-profile/)), and third-party tools pay CDK $175 to $700 a month per rooftop just to reach the dealer's own data ([DealerRefresh](https://forum.dealerrefresh.com/threads/cdk-third-party-access-pricing-guide.5345/)). In Australia and New Zealand the same play runs through Pentana eraPower and Titan DMS on unpublished per-rooftop quotes. And in June 2024, when CDK was hit by ransomware, roughly 15,000 dealerships could not sell a car or close a repair order for the better part of two weeks, because the operating record lived in someone else's cloud.

Want the same thing with a web front end, or built on a different stack? That is a customisation, and it is exactly what Enterprise DNA does: [book a call](https://calendly.com/sam-mckay/discovery-call?utm_source=github&utm_medium=readme&utm_campaign=cdk).

This one covers the operating record of a used-vehicle dealership with a workshop: the customers, the stock on the lot with its compliance paper (CIN, PPSR, WoF), the deals from quote to delivery, the repair orders, the parts shelf and the invoices. The New Zealand rules are built in as gates with their sources cited: a unit takes no deposit without a Consumer Information Notice, nothing delivers without a PPSR search, a WoF inspection only happens under a currently authorised inspector, and $10,000 of cash needs customer due diligence on record first. The general ledger and payroll stay with your accountant, deliberately; one export hands them everything.

## Why no front end

- The front end was only ever there because the database was hard to talk to. That is no longer true.
- Your data sits in plain Postgres tables you own. Any tool can read them. No export, no lock-in.
- No seats, no tiers, no add-ons. Read [docs/why-no-front-end.md](docs/why-no-front-end.md) for the honest trade-offs too.

## Quick start

Sixty seconds, no database install (an embedded Postgres runs inside Node):

```bash
git clone https://github.com/Enterprise-DNA-OS/dealership-for-claude-code.git
cd dealership-for-claude-code
npm install
npm run demo
```

Then open the folder in Claude Code and type `/attention`. The demo dealership has a delivered ute with no PPSR check, three units on the yard without a CIN, and a technician holding WoF bookings on an expired authorisation; the answer shows you exactly how this system thinks.

### Use it with your own Postgres or Supabase

Copy `.env.example` to `.env`, set `DATABASE_URL`, then `npm run migrate`. Same commands, shared data, no per-seat fee.

## The commands

| Command | What it does |
|---|---|
| `/attention` | Everything that wants a decision, worst first. A PPSR hole outranks everything |
| `/lot` | The yard on one screen: days in, recon, floorplan interest, the paper on every unit |
| `/aged` | Units past the aged line with the interest bill each has quietly run up |
| `/vehicle` | One unit's whole card: paper, deals, workshop history, notes |
| `/stock-in` | A trade or auction buy into stock, odometer first, then the paper walk |
| `/deals` | The board: deposits (and which are going stale), quotes, deliveries with gross |
| `/deal` | Quote to delivery through the gates: CIN at deposit; PPSR, WoF and cash CDD at delivery |
| `/sales` | Delivered units and true front-end gross by salesperson, last 28 days |
| `/workshop` | Today's board plus anything unresolved from earlier days |
| `/service-due` | Every car we sold or serviced that has gone quiet: the retention call sheet |
| `/customer` `/customers` | One customer's whole history; the list with last-seen dates |
| `/team` | Staff with inspector authorisations, WoF loads, deals and deliveries |
| `/debtors` `/unbilled` | Who owes money; finished work nobody invoiced |
| `/parts` | The shelf: out, low, receive stock in |
| `/compliance` | The rule book run against the records, sources cited |
| `/weekly-review` | The Monday review written from four commands |
| `/log` | A call, a promise, a pricing decision, onto the record |
| `/draft-offer` `/draft-service-reminders` | Drafts to `drafts/`; a person sends them |
| `/import` | Bring the dealership across from CDK, dry-run first |
| `/customise` | Change a field, a threshold, a rule, a document, in plain language |
| `/new-view` | A new read-only dashboard page, described in plain language |

## Instead of CDK Global

Export your customer and inventory lists from CDK (or Pentana, Titan, or any DMS that prints to CSV), then:

```bash
node scripts/dealer.mjs import cdk --customers=customers.csv --vehicles=vehicles.csv --dry-run
node scripts/dealer.mjs import cdk --customers=customers.csv --vehicles=vehicles.csv
```

The importer matches common column-name variants, is idempotent (re-running updates instead of duplicating), and names every row it skips. Every imported unit deliberately arrives with no CIN and no PPSR on record: the paper gets verified on the way in, not assumed from the old system. [docs/replace-cdk.md](docs/replace-cdk.md) covers exactly what carries over and what starts fresh, and why.

### Ten questions your DMS dashboard cannot answer

Each of these is one plain-language ask away in Claude Code, because the record is a database you own:

1. What has every aged unit cost me in floorplan interest, unit by unit, so far?
2. What is the true front-end gross per salesperson once recon is counted against each unit?
3. Which acquisition source (trade-in, auction, import) actually makes money after recon?
4. Which buyers from the last two years have never once been back to our workshop?
5. Which delivered units are missing a PPSR search or a fresh WoF on the record, right now?
6. Which deals died last quarter, at whose hands, for what stated reason?
7. Which deposits are more than a fortnight old and still have not delivered, and why?
8. Which finished workshop jobs were never invoiced, and what do they total?
9. Whose inspector authorisation or trader registration lapses inside 30 days?
10. Which parts have not moved in 90 days, and what is tied up in them?

## Your first hour: ten things to ask for

1. "Walk me through everything on the attention list and what clears each one."
2. "Which units are missing paper, and record the CIN on the Commodore."
3. "What has the Hilux cost us in floorplan interest, and what should it be priced at to move?"
4. "Show me true gross by salesperson, recon counted."
5. "Ring list: everyone whose car we have not seen in six months."
6. "Draft the service reminders for that list."
7. "Change the aged line to 60 days." (a one-line settings change)
8. "Book the Ranger in for a WoF with Dev on Thursday at 10."
9. "Import our customer list from the old system, dry run first."
10. "Add a page that shows this month's deliveries by acquisition source."

## Architecture

```
dealership-for-claude-code/
  CLAUDE.md                 how the operator wants this run (routing table + house rules)
  AGENTS.md                 the same, for Codex / OpenCode / Cursor / Gemini CLI
  .claude/commands/         the slash commands
  scripts/                  the CLI the commands drive
  scripts/lib/db.mjs        one adapter: DATABASE_URL (pg) or embedded PGlite
  supabase/migrations/      plain SQL schema
  supabase/seed.sql         demo data
  docs/                     the thesis and the migration guide
```

## Built with Claude Code

This repository was built with Claude Code as the primary development tool, from the schema to the commands, and it is meant to be extended the same way. Ask for a new command and it writes one.

## Contributing

Issues and pull requests are welcome. Keep the shape: plain SQL, a small CLI, a slash command per recurring job, no front end.

## Want it installed and run for you?

Enterprise DNA installs Dealership for Claude Code for your business, migrates your CDK Global data, connects it to the rest of your tools, and runs it for you as part of **Omni**, our managed Command Center. One setup fee, then a monthly retainer.

- Book a call: https://calendly.com/sam-mckay/discovery-call?utm_source=github&utm_medium=readme&utm_campaign=cdk
- Read more: https://enterprisedna.co/omni/instead-of/cdk?utm_source=github&utm_medium=readme&utm_campaign=cdk

## License

MIT. Copyright (c) 2026 Enterprise DNA.
