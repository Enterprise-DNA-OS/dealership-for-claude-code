# Moving off CDK Global

The promise: export from CDK (or Pentana eraPower, Titan DMS, or any DMS that prints reports to CSV), run one command, and the operating record comes with you in a morning. Here is exactly what carries, what starts fresh, and why.

## What to export

CDK's list screens and reports export to CSV. You need two files:

1. **Customers.** The customer list export: customer number, name (or first and last), email, cell phone, address, city.
2. **Vehicles.** The inventory export: stock number, VIN, year, make, model, odometer, colour, cost, list price, date in stock.

Column names vary between DMS versions and report layouts; the importer matches the common variants case-insensitively (`Customer Number`, `Cust No`, `Odometer`, `Mileage`, `List Price`, `Price` all work). Dates in DD/MM/YYYY are read as New Zealand dates.

## Run it

```bash
node scripts/dealer.mjs import cdk --customers=customers.csv --vehicles=vehicles.csv --dry-run
node scripts/dealer.mjs import cdk --customers=customers.csv --vehicles=vehicles.csv
```

Dry run first, always. The importer is idempotent: it matches on the old system's number (kept in `external_ref`) and then on name or VIN, so running it twice updates instead of duplicating, and a weekly re-run during a transition period is safe.

## What maps

| CDK | Here |
|---|---|
| Customer (number, name, contact details) | `customers`, number kept in `external_ref` |
| Inventory unit (stock number, VIN, year, make, model, odometer, cost, price) | `vehicles`, ref minted (`VH-...`), stock number kept in `external_ref` |

## What deliberately does not carry over

- **Compliance paper.** Every imported unit arrives with **no CIN and no PPSR on record**, on purpose. The old system saying a search was done is not a search; the notice on the old windscreen is not this notice. Walk the paper unit by unit (`vehicle cin`, `vehicle ppsr --clear`, `vehicle wof --issued=`) and the first `compliance` run after import is your opening audit, on the record.
- **Deal history.** Old deals export as reports, not clean relational files. Keep the CDK export as the archive it is, and open live deals here (`deal open`). For a deal mid-flight, one `deal open` plus a file note covers it.
- **Repair order history.** Same reasoning: the record someone signed stays in the system it was signed in. For cars mid-repair, book the job here and summarise the story so far in a file note (`/log`). Service histories rebuild fast, and the `service-due` engine only needs the visits from here on.
- **Open invoices.** Bring balances across in your accounting system, or re-issue from here. Money history stays in the old system's export.
- **The general ledger.** It was never coming. Your accountant keeps the ledger; `export` hands them every transaction this system has.

## The import is the first audit

Every skip is named and every skip is a question about the old data: a unit with no make or model, a customer row with no name. Do not silence them; answer them. Then run the honesty sweep:

```bash
node scripts/dealer.mjs compliance --json   # the paper gaps, named unit by unit
node scripts/dealer.mjs lot --json          # odometers all present? days-in-stock believable?
node scripts/dealer.mjs settings            # floorplan rate, aged line, registration expiry: make them yours
```

A clean yard on day one is the point of moving.
