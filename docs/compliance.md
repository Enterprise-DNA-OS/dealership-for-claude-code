# The rule book /compliance checks

Nine rules, each with its source, what a breach looks like in the data, and where the CLI already refuses at the gate. `node scripts/dealer.mjs compliance` runs them all; add a rule key to run one.

Nothing here is legal advice. It is the rule book the operator has pointed the system at, with sources, and the operator changes it to match their business. When the law moves, update the rule and the check together.

## 1. `cin` - a Consumer Information Notice on every used vehicle offered

A used motor vehicle is not offered for sale without a completed Consumer Information Notice displayed on it. **Source: Consumer Information Standards (Used Motor Vehicles) Regulations 2008**, made under the **Fair Trading Act 1986** (offering without the notice is an offence).

Breach in the data: an in-stock used unit with no `cin_completed_on`. **Gate: `deal deposit` and `deal deliver` refuse a unit with no CIN; `vehicle cin` refuses a unit with no odometer reading, because the notice states it. No force flag.**

## 2. `ppsr` - the security follows the car

Before a vehicle is delivered, the Personal Property Securities Register is searched and anything registered is discharged. If it is not, the finance company's security interest survives the sale and follows the car onto the buyer's driveway. **Source: Personal Property Securities Act 1999.**

Breach in the data: a sold unit with no `ppsr_checked_on`, or one delivered with `security_interest` still true. **Gate: `deal deliver` refuses without a recorded search, and refuses outright while an interest stands. No force flag.**

## 3. `wof` - a warrant inside the month, or as-is in writing

A used vehicle is delivered with a WoF issued within one month before delivery, unless it is sold "as is, where is" with the buyer's written acknowledgment. **Source: Land Transport Rule: Vehicle Standards Compliance 2002.**

Breach in the data: a delivered deal whose vehicle's `wof_issued_on` is missing or more than 30 days before `delivered_on`, with no `as_is_ack_on`. **Gate: `deal deliver` refuses; `--as-is` records the lawful written acknowledgment instead. That flag is a documented legal path, not a bypass.**

## 4. `inspector` - WoF inspections under current authorisation only

A WoF is issued only by a vehicle inspector whose authorisation is current. A lapsed inspector issuing warrants puts the inspecting organisation's authority on the line. **Source: Land Transport Rule: Vehicle Standards Compliance 2002; NZTA vehicle inspector authorisation.**

Breach in the data: a WoF repair order booked or open under a technician whose `inspector_expires_on` is past or missing. **Gate: `ro book`, `ro assign` and `ro done` all check the authorisation on the day. No force flag.**

## 5. `aml` - customer due diligence on big cash

Motor vehicle dealers are high-value dealers: cash of NZD $10,000 or more requires customer due diligence before the transaction. **Source: Anti-Money Laundering and Countering Financing of Terrorism Act 2009.** The threshold lives in `settings` (`cash_cdd_threshold_cents`).

Breach in the data: a delivered cash deal at or over the threshold with no `cdd_completed_on` (only possible via import). **Gate: `deal deliver` refuses cash at or over the threshold without `--cdd`. No force flag.**

## 6. `odometer` - the reading is on the record

Every stock unit carries an odometer reading. The CIN states it, and misstating an odometer is the classic dealer prosecution under the **Fair Trading Act 1986**.

Breach in the data: an in-stock unit with `odometer_km` null. **Gate: `stock in` refuses a unit without a reading; `vehicle cin` refuses to complete a notice without one. No force flag.**

## 7. `registration` - the trader registration is current

No person carries on the business of motor vehicle trading unless registered. **Source: Motor Vehicle Sales Act 2003 s 10.** The expiry lives in `settings` (`mvt_registration_expires_on`); the attention list warns from 30 days out.

Breach in the data: the registration date missing or past. The fix is a renewal with the Registrar of Motor Vehicle Traders, then `settings set mvt_registration_expires_on`.

## 8. `records` - every job finished with notes, the day it happened

Every repair order completes with work notes. When a customer disputes a repair, the record that the work was done with reasonable care and skill is the dealership's defence. **Source: Consumer Guarantees Act 1993** (guarantee of reasonable care and skill on services).

Breach in the data: a booked job whose day passed with no story, an open job gone stale, or a completed job with empty notes (import only). **Gate: `ro done` refuses without `--notes=`. No force flag.**

## 9. `retention` - records are never deleted

Sales and workshop records are kept. Motor vehicle traders keep records of their dealings; disputes arrive years later. **Source: Motor Vehicle Sales Act 2003 (records of transactions); Consumer Guarantees Act 1993.**

Held by design: this CLI has no delete path. Vehicles sell, deals are lost with a reason on the record, customers and staff become former, and invoices stay. The check exists so an auditor can see the rule stated, not because it can fail here.
