#!/usr/bin/env node
// End-to-end smoke test on a throwaway embedded database.
// Runs migrate, seed, then every CLI command that matters, and asserts on the JSON.
// Passes on Windows and Linux. No network, no Postgres install.

import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dataDir = mkdtempSync(path.join(tmpdir(), 'dealer-smoke-'));
const env = { ...process.env, DATA_DIR: dataDir };
delete env.DATABASE_URL; // the smoke test always runs embedded

let step = 0;
function run(label, args, { json = true, expectFail = false } = {}) {
  step++;
  const argv = [path.join(root, 'scripts', args[0]), ...args.slice(1), ...(json ? ['--json'] : [])];
  const res = spawnSync(process.execPath, argv, { cwd: root, env, encoding: 'utf8' });
  const ok = expectFail ? res.status !== 0 : res.status === 0;
  if (!ok) {
    console.error(`\nFAIL step ${step} (${label}): exit ${res.status}\n--- stdout\n${res.stdout}\n--- stderr\n${res.stderr}`);
    process.exit(1);
  }
  console.log(`  ok  ${String(step).padStart(2)}  ${label}`);
  if (!json || expectFail) return { stdout: res.stdout, stderr: res.stderr };
  try {
    return JSON.parse(res.stdout);
  } catch {
    console.error(`\nFAIL step ${step} (${label}): output is not JSON\n${res.stdout}\n${res.stderr}`);
    process.exit(1);
  }
}

function assert(cond, msg) {
  if (!cond) {
    console.error(`\nFAIL assertion: ${msg}`);
    process.exit(1);
  }
}

const n = (v) => Number(v ?? 0);

console.log(`smoke: data dir ${dataDir}`);
try {
  run('migrate', ['migrate.mjs'], { json: false });
  run('migrate again (idempotent)', ['migrate.mjs'], { json: false });
  run('seed', ['seed.mjs'], { json: false });
  run('seed again (idempotent)', ['seed.mjs'], { json: false });

  // ---- the dealership -------------------------------------------------------

  const stats = run('stats', ['dealer.mjs', 'stats']);
  assert(n(stats.active_customers) === 7, `seven active customers (${stats.active_customers})`);
  assert(n(stats.units_in_stock) === 6, `six units in stock (${stats.units_in_stock})`);
  assert(n(stats.stock_at_cost_cents) === 9500000, `$95,000 of stock at cost (${stats.stock_at_cost_cents})`);
  assert(n(stats.aged_units) === 2, `the Hilux and the Commodore are aged (${stats.aged_units})`);
  assert(n(stats.floorplan_interest_cents) === 121900, `$1,219 of floorplan interest accruing (${stats.floorplan_interest_cents})`);
  assert(n(stats.deals_open) === 2 && n(stats.deposits_held) === 1, `two open deals, one holding a deposit`);
  assert(n(stats.unbilled_cents) === 38900, `$389 unbilled (${stats.unbilled_cents})`);
  assert(n(stats.outstanding_cents) === 67800, `$678 outstanding (${stats.outstanding_cents})`);
  assert(n(stats.service_due) === 2, `two cars gone quiet (${stats.service_due})`);
  assert(n(stats.cin_missing) === 3, `three units with no CIN (${stats.cin_missing})`);

  const lot = run('lot', ['dealer.mjs', 'lot']);
  assert(lot.length === 6, `six units on the lot (${lot.length})`);
  assert(lot[0].ref === 'VH-102' && n(lot[0].days_in_stock) === 145, 'the Hilux has sat longest');
  assert(lot[0].state.startsWith('AGED'), 'the Hilux is aged');
  assert(lot.find((v) => v.ref === 'VH-104').state === 'NO CIN', 'the missing CIN outranks the Commodore being aged');
  assert(lot.find((v) => v.ref === 'VH-105').state === 'NO ODOMETER', 'the Corolla has no odometer');
  assert(n(lot.find((v) => v.ref === 'VH-102').recon_cents) === 60300, 'the Hilux recon is on the unit');

  const aged = run('aged', ['dealer.mjs', 'aged']);
  assert(aged.length === 2, `two aged units (${aged.length})`);

  const team = run('team', ['dealer.mjs', 'team']);
  assert(team.length === 6, `six active staff (${team.length})`);
  const kovac = team.find((s) => s.name === 'Steve Kovac');
  assert(kovac.inspector === 'EXPIRED' && n(kovac.wof_bookings) === 2, 'Kovac: expired authorisation, two WoF bookings');
  assert(team.find((s) => s.name === 'Dev Patel').inspector === 'current', 'Patel is current');

  const customers = run('customers', ['dealer.mjs', 'customers']);
  assert(customers.length === 7, `seven active customers (${customers.length})`);
  const frost = customers.find((c) => c.name === 'Callum Frost');
  assert(n(frost.owing_cents) === 45900, 'Frost owes the brake job');

  const allCustomers = run('customers --all includes the former', ['dealer.mjs', 'customers', '--all']);
  assert(allCustomers.length === 8, `all customers (${allCustomers.length})`);

  const hale = run('customer card by partial name', ['dealer.mjs', 'customer', 'hale']);
  assert(hale.customer.name === 'Ruth Hale', 'resolved by partial name');
  assert(hale.vehicles.some((v) => v.ref === 'VH-106'), 'the Navara follows its buyer');

  const noCustomer = run('an unknown customer exits 1', ['dealer.mjs', 'customer', 'nobody at all'], { json: false, expectFail: true });
  assert(/No customer matches/.test(noCustomer.stderr), 'and says so plainly');

  const byPlate = run('vehicle card by plate', ['dealer.mjs', 'vehicle', 'KWT903']);
  assert(byPlate.vehicle.ref === 'VH-102', 'the plate resolves');
  assert(n(byPlate.vehicle.floorplan_interest_cents) === 86047, `the Hilux interest bill is visible (${byPlate.vehicle.floorplan_interest_cents})`);

  const ambiguous = run('an ambiguous vehicle name exits 1', ['dealer.mjs', 'vehicle', 'mazda'], { json: false, expectFail: true });
  assert(/matches \d+ vehicle/.test(ambiguous.stderr), 'and lists the candidates');

  const deals = run('deals', ['dealer.mjs', 'deals']);
  assert(deals.some((d) => d.ref === 'DL-5003' && d.state === 'DEPOSIT STALE'), "Reyes's deposit is going cold");
  assert(deals.some((d) => d.ref === 'DL-5002' && n(d.gross_cents) === 450000), 'the Navara made $4,500 front-end');

  const sales = run('sales', ['dealer.mjs', 'sales']);
  const ngata = sales.find((s) => s.salesperson === 'Aroha Ngata');
  assert(n(ngata.delivered_28d) === 1 && n(ngata.gross_28d_cents) === 450000, 'Ngata delivered the Navara');

  const serviceDue = run('service-due', ['dealer.mjs', 'service-due']);
  assert(serviceDue.length === 2, `two cars gone quiet (${serviceDue.length})`);
  assert(serviceDue[0].owner === 'Tina Woods' && n(serviceDue[0].days_since) === 260, 'the CR-V has been away longest');
  assert(serviceDue.some((r) => r.ref === 'VH-101' && r.owner === 'Hemi Opara'), 'the Outlander we sold never came back');

  // ---- attention and compliance ---------------------------------------------

  const attention = run('attention', ['dealer.mjs', 'attention']);
  assert(attention.length === 18, `the attention list is loud (${attention.length})`);
  assert(attention[0].reason === 'ppsr_missing' && attention[0].label === 'VH-106', 'the Navara PPSR hole outranks everything');
  for (const reason of ['ppsr_missing', 'cin_missing', 'inspector_expired', 'registration', 'ro_unresolved',
    'unbilled', 'deposit_stale', 'aged_stock', 'debtor', 'parts_low', 'odometer_missing', 'service_due']) {
    assert(attention.some((a) => a.reason === reason), `attention carries ${reason}`);
  }
  assert(attention.filter((a) => a.reason === 'cin_missing').length === 3, 'three units missing a CIN');

  const compliance = run('compliance', ['dealer.mjs', 'compliance']);
  assert(compliance.length === 9, `nine rules in the book (${compliance.length})`);
  const failed = compliance.filter((r) => r.breaches.length).map((r) => r.key).sort();
  assert(failed.join(',') === 'aml,cin,inspector,odometer,ppsr,records,wof',
    `the seeded breaches are exactly the story (${failed.join(',')})`);
  assert(compliance.reduce((s, r) => s + r.breaches.length, 0) === 11, 'eleven breaches all told');
  const oneRule = run('one compliance rule', ['dealer.mjs', 'compliance', 'aml']);
  assert(oneRule.length === 1 && oneRule[0].breaches.length === 1 && /cash/.test(oneRule[0].breaches[0].detail), 'the Navara cash settlement had no CDD');

  // ---- the deal gates ---------------------------------------------------------

  const gateLive = run('a second deal on a reserved unit is refused', ['dealer.mjs', 'deal', 'open', 'VH-103', 'Tanner', '--sales=Bell'], { json: false, expectFail: true });
  assert(/already carries/.test(gateLive.stderr), 'one unit, one live deal');

  const gateSales = run('a technician holding a deal is refused', ['dealer.mjs', 'deal', 'open', 'VH-104', 'Tanner', '--sales=Patel'], { json: false, expectFail: true });
  assert(/not a salesperson/.test(gateSales.stderr), 'deals sit under sales');

  const commodoreDeal = run('open a deal on the Commodore', ['dealer.mjs', 'deal', 'open', 'VH-104', 'Tanner', '--sales=Bell']);
  assert(/^DL-\d+$/.test(commodoreDeal.ref), `the ref is minted (${commodoreDeal.ref})`);

  const gateCin = run('a deposit with no CIN is refused', ['dealer.mjs', 'deal', 'deposit', commodoreDeal.ref, '--amount=500'], { json: false, expectFail: true });
  assert(/Consumer Information/.test(gateCin.stderr) && /No force flag/.test(gateCin.stderr), 'and cites the regulations');

  run('record the Commodore CIN', ['dealer.mjs', 'vehicle', 'cin', 'VH-104']);
  run('now the deposit goes on', ['dealer.mjs', 'deal', 'deposit', commodoreDeal.ref, '--amount=500']);

  // ---- the corolla, end to end: odometer, CIN, PPSR, WoF, cash CDD ------------

  const gateOdo = run('a CIN without an odometer is refused', ['dealer.mjs', 'vehicle', 'cin', 'VH-105'], { json: false, expectFail: true });
  assert(/odometer/.test(gateOdo.stderr), 'the CIN states the reading');

  run('read the dash', ['dealer.mjs', 'vehicle', 'odometer', 'VH-105', '--km=18200']);
  run('now the CIN records', ['dealer.mjs', 'vehicle', 'cin', 'VH-105']);

  run('a walk-in buyer', ['dealer.mjs', 'customer', 'add', 'Nate', 'Kirby', '--phone=021 555 0399']);
  const corollaDeal = run('quote the Corolla', ['dealer.mjs', 'deal', 'open', 'VH-105', 'Kirby', '--sales=Ngata', '--price=25500']);
  run('deposit on the Corolla', ['dealer.mjs', 'deal', 'deposit', corollaDeal.ref, '--amount=1000']);

  const gatePpsr = run('delivery with no PPSR check is refused', ['dealer.mjs', 'deal', 'deliver', corollaDeal.ref], { json: false, expectFail: true });
  assert(/PPSR/.test(gatePpsr.stderr) && /No force flag/.test(gatePpsr.stderr), 'the security follows the car');

  run('the search finds an interest', ['dealer.mjs', 'vehicle', 'ppsr', 'VH-105', '--security']);
  const gateSecurity = run('delivery with a registered interest is refused', ['dealer.mjs', 'deal', 'deliver', corollaDeal.ref], { json: false, expectFail: true });
  assert(/security interest/.test(gateSecurity.stderr), 'discharge it first');

  run('discharged and re-searched clear', ['dealer.mjs', 'vehicle', 'ppsr', 'VH-105', '--clear']);
  const gateWof = run('delivery with no WoF is refused', ['dealer.mjs', 'deal', 'deliver', corollaDeal.ref], { json: false, expectFail: true });
  assert(/WoF/.test(gateWof.stderr), 'inside the month or as-is');

  // ---- the workshop gates -----------------------------------------------------

  const gateInspector = run('a WoF under a lapsed inspector is refused', ['dealer.mjs', 'ro', 'book', 'VH-105', '--tech=Kovac', '--type=wof'], { json: false, expectFail: true });
  assert(/inspector authorisation/.test(gateInspector.stderr) && /No force flag/.test(gateInspector.stderr), 'and cites the Rule');

  const gateTech = run('a salesperson on the hoist is refused', ['dealer.mjs', 'ro', 'book', 'VH-105', '--tech=Bell', '--type=wof'], { json: false, expectFail: true });
  assert(/not a technician/.test(gateTech.stderr), 'workshop jobs sit under a technician');

  const wofRo = run('book the WoF under Patel', ['dealer.mjs', 'ro', 'book', 'VH-105', '--tech=Patel', '--type=wof', '--at=14:00', '--reason=Pre-delivery WoF']);
  assert(/^RO-\d+$/.test(wofRo.ref), `the ref is minted (${wofRo.ref})`);
  run('the inspection fee goes on', ['dealer.mjs', 'ro', 'add', wofRo.ref, 'LAB-WOF']);

  const gateResult = run('a WoF without a result is refused', ['dealer.mjs', 'ro', 'done', wofRo.ref, '--notes=Checked over, all good.'], { json: false, expectFail: true });
  assert(/--result/.test(gateResult.stderr), 'pass or fail, on the record');

  run('WoF passed', ['dealer.mjs', 'ro', 'done', wofRo.ref, '--notes=Full inspection. Brakes, steering, structure, lighting all within limits.', '--result=pass']);
  const corollaCard = run('the pass wrote the vehicle WoF date', ['dealer.mjs', 'vehicle', 'VH-105']);
  assert(corollaCard.vehicle.wof_issued_on, 'the WoF issue date is on the unit');

  const gateCdd = run('a $25,500 cash settlement without CDD is refused', ['dealer.mjs', 'deal', 'deliver', corollaDeal.ref, '--method=cash'], { json: false, expectFail: true });
  assert(/due diligence/.test(gateCdd.stderr) && /AML/.test(gateCdd.stderr), 'high-value dealer rules apply');

  const corollaDone = run('deliver the Corolla with CDD on record', ['dealer.mjs', 'deal', 'deliver', corollaDeal.ref, '--method=cash', '--cdd']);
  assert(corollaDone.status === 'delivered' && n(corollaDone.gross_cents) === 393500, `$3,935 front-end after the WoF cost (${corollaDone.gross_cents})`);

  // ---- the as-is path ---------------------------------------------------------

  const commodoreDone = run('deliver the Commodore as-is (WoF is 80 days old)', ['dealer.mjs', 'deal', 'deliver', commodoreDeal.ref, '--as-is', '--method=finance']);
  assert(commodoreDone.status === 'delivered' && n(commodoreDone.gross_cents) === 449000, `$4,490 front-end (${commodoreDone.gross_cents})`);
  const commodoreCard = run('the as-is acknowledgment is on the unit', ['dealer.mjs', 'vehicle', 'VH-104']);
  assert(commodoreCard.vehicle.as_is_ack_on, 'written acknowledgment recorded');

  // ---- the workshop, end to end -----------------------------------------------

  const batteryRo = run('book the Ranger in', ['dealer.mjs', 'ro', 'book', 'VH-202', '--tech=Patel', '--type=repair', '--reason=No crank, suspect battery']);
  const gateShelf = run('fitting a part the shelf does not hold is refused', ['dealer.mjs', 'ro', 'add', batteryRo.ref, 'BAT-12V'], { json: false, expectFail: true });
  assert(/on the shelf/.test(gateShelf.stderr), 'stock is counted, not imagined');

  const received = run('receive batteries', ['dealer.mjs', 'parts', 'receive', 'BAT-12V', '--qty=4']);
  assert(n(received.stock_qty) === 4, 'four on the shelf');
  run('fit one', ['dealer.mjs', 'ro', 'add', batteryRo.ref, 'BAT-12V']);
  run('and the labour', ['dealer.mjs', 'ro', 'add', batteryRo.ref, 'LAB-STD', '--qty=0.5']);

  const gateNotes = run('completing without notes is refused', ['dealer.mjs', 'ro', 'done', batteryRo.ref], { json: false, expectFail: true });
  assert(/work notes/.test(gateNotes.stderr) && /No force flag/.test(gateNotes.stderr), 'the record is not optional');

  const batteryDone = run('complete it with notes', ['dealer.mjs', 'ro', 'done', batteryRo.ref, '--notes=Battery load tested and failed. New battery fitted, charging system 14.1 V.', '--odometer=104650']);
  assert(n(batteryDone.value_cents) === 38900, `$389 on the sheet (${batteryDone.value_cents})`);

  const gateOpenInvoice = run('invoicing the stale open recon is refused', ['dealer.mjs', 'invoice', 'build', 'RO-7007'], { json: false, expectFail: true });
  assert(/still open/.test(gateOpenInvoice.stderr), 'the invoice bills the record, not the plan');

  run('finish the stale pre-delivery check', ['dealer.mjs', 'ro', 'done', 'RO-7007', '--notes=Checked over for the Reyes delivery. Two rear tyres marginal, quoted separately.']);
  const gateRecon = run('invoicing internal recon is refused', ['dealer.mjs', 'invoice', 'build', 'RO-7007'], { json: false, expectFail: true });
  assert(/recon/.test(gateRecon.stderr), 'recon lands on the unit, not a customer');

  const inv = run('invoice the battery job', ['dealer.mjs', 'invoice', 'build', batteryRo.ref]);
  assert(/^INV-\d+$/.test(inv.ref) && n(inv.total_cents) === 38900, `invoice minted (${inv.ref})`);
  const invAgain = run('invoicing it twice is refused', ['dealer.mjs', 'invoice', 'build', batteryRo.ref], { json: false, expectFail: true });
  assert(/already invoiced/.test(invAgain.stderr), 'one job, one invoice');
  run('mark it paid', ['dealer.mjs', 'invoice', 'paid', inv.ref]);

  // ---- the stale WoF booking under Kovac ----------------------------------------

  const gateAssign = run('reassigning a WoF to a lapsed inspector is refused', ['dealer.mjs', 'ro', 'assign', 'RO-7009', '--tech=Kovac'], { json: false, expectFail: true });
  assert(/inspector authorisation/.test(gateAssign.stderr), 'the gate holds on reassignment too');
  run('reassign the past WoF to Patel', ['dealer.mjs', 'ro', 'assign', 'RO-7005', '--tech=Patel']);
  const failedWof = run('complete it as a fail', ['dealer.mjs', 'ro', 'done', 'RO-7005', '--notes=Rear brake imbalance over limit, right rear seatbelt fraying. Failed, repair quote given.', '--result=fail']);
  assert(failedWof.wof_result === 'fail', 'the fail is on the record');

  // ---- debtors, unbilled, money ------------------------------------------------

  const debtors = run('debtors', ['dealer.mjs', 'debtors']);
  assert(debtors.length === 2, `two owing (${debtors.length})`);
  assert(debtors[0].customer === 'Callum Frost' && n(debtors[0].oldest_days) === 56, 'Frost is oldest at 56 days');

  const unbilled = run('unbilled is now just the seeded battery job', ['dealer.mjs', 'unbilled']);
  assert(unbilled.length === 1 && unbilled[0].ref === 'RO-7008', 'RO-7008 is still waiting for its invoice');

  const invoices = run('invoices --unpaid', ['dealer.mjs', 'invoices', '--unpaid']);
  assert(invoices.length === 2, `two unpaid (${invoices.length})`);

  // ---- stock in, settings ------------------------------------------------------

  const gateStockOdo = run('stock-in without an odometer is refused', ['dealer.mjs', 'stock', 'in', '--make=Honda', '--model=Jazz'], { json: false, expectFail: true });
  assert(/odometer/.test(gateStockOdo.stderr) && /No force flag/.test(gateStockOdo.stderr), 'the reading comes in the door with the car');

  const jazz = run('stock in a trade', ['dealer.mjs', 'stock', 'in', '--make=Honda', '--model=Jazz', '--year=2018', '--odometer=64100', '--cost=9800', '--asking=13990', '--source=trade_in']);
  assert(/^VH-\d+$/.test(jazz.ref), `the ref is minted (${jazz.ref})`);

  const settings = run('settings', ['dealer.mjs', 'settings']);
  assert(settings.length === 5, `five settings (${settings.length})`);
  run('tighten the aged line', ['dealer.mjs', 'settings', 'set', 'aged_days', '60']);
  const agedTight = run('the Mazda 3 is now aged too', ['dealer.mjs', 'aged']);
  assert(agedTight.length === 2 && agedTight.some((a) => a.ref === 'VH-107'), `the Hilux and now the Mazda (${agedTight.map((a) => a.ref).join(',')})`);
  run('put it back', ['dealer.mjs', 'settings', 'set', 'aged_days', '90']);
  const gateSetting = run('an unknown setting is refused', ['dealer.mjs', 'settings', 'set', 'nonsense', '1'], { json: false, expectFail: true });
  assert(/No setting/.test(gateSetting.stderr), 'settings are a fixed vocabulary');

  // ---- notes -------------------------------------------------------------------

  run('a file note', ['dealer.mjs', 'note', 'add', 'VH-203', 'Callum called: will clear the brake invoice on the 20th. Second promise on file.', '--staff=Reid']);
  const notes = run('notes read back', ['dealer.mjs', 'notes', 'VH-203']);
  assert(notes.some((x) => /Second promise/.test(x.note)), 'the note landed');

  // ---- import: CDK CSVs --------------------------------------------------------

  const customersCsv = path.join(dataDir, 'customers.csv');
  const vehiclesCsv = path.join(dataDir, 'vehicles.csv');
  writeFileSync(customersCsv, [
    'Customer Number,First Name,Last Name,Email,Cell Phone,Address,City',
    'CDK-C1,Dana,Wren,dana.wren@example.nz,021 555 0921,4 Cuba Street,Petone',
    'CDK-C2,Mike,Tanner,mike.tanner@example.nz,021 555 0306,77 Hutt Road,Alicetown',
  ].join('\n'));
  writeFileSync(vehiclesCsv, [
    'Stock Number,VIN,Year,Make,Model,Odometer,Color,List Price',
    'CDK-S1,DEMO00000000901,2019,Kia,Sportage,71200,Grey,21990',
    'CDK-S2,DEMO00000000902,2020,,,,,',
  ].join('\n'));

  const dry = run('import dry run writes nothing', ['dealer.mjs', 'import', 'cdk', `--customers=${customersCsv}`, `--vehicles=${vehiclesCsv}`, '--dry-run']);
  assert(n(dry.customers) === 1 && n(dry.customers_updated) === 1, 'one new customer, Tanner matched');
  assert(dry.skips.length === 1 && /make\/model/.test(dry.skips[0]), 'the empty vehicle row is a named skip');

  const imported = run('import for real', ['dealer.mjs', 'import', 'cdk', `--customers=${customersCsv}`, `--vehicles=${vehiclesCsv}`]);
  assert(n(imported.customers) === 1 && n(imported.vehicles) === 1, 'Dana and the Sportage are in');

  const reimport = run('re-importing updates rather than duplicating', ['dealer.mjs', 'import', 'cdk', `--customers=${customersCsv}`, `--vehicles=${vehiclesCsv}`]);
  assert(n(reimport.customers) === 0 && n(reimport.customers_updated) === 2 && n(reimport.vehicles) === 0 && n(reimport.vehicles_updated) === 1, 'the second run creates nothing new');

  const sportage = run('the import is the first audit: no CIN assumed', ['dealer.mjs', 'compliance', 'cin']);
  assert(sportage[0].breaches.some((b) => /Sportage/.test(b.detail)), 'the imported unit is loudly un-CINed');

  const missingFile = run('a missing import file fails loudly', ['dealer.mjs', 'import', 'cdk', `--customers=${path.join(dataDir, 'not-there.csv')}`], { json: false, expectFail: true });
  assert(/No customers file/.test(missingFile.stderr), 'rather than importing nothing quietly');

  // ---- export ------------------------------------------------------------------

  const outFile = path.join(dataDir, 'dump.json');
  const dump = run('export', ['dealer.mjs', 'export', `--out=${outFile}`]);
  assert(existsSync(outFile), 'the export file is on disk');
  const parsed = JSON.parse(readFileSync(outFile, 'utf8'));
  assert(parsed.deals.length === n(dump.counts.deals), 'the counts match the file');
  assert(parsed.vehicles.length >= 13, 'the vehicles come out too');

  // ---- the branded HTML --------------------------------------------------------

  const views = run('npm run view', ['view.mjs'], { json: false });
  assert(/views[\\/]week\.html/.test(views.stdout) && /views[\\/]money\.html/.test(views.stdout), 'both views rendered');
  const weekHtml = readFileSync(path.join(root, 'views', 'week.html'), 'utf8');
  assert(weekHtml.includes('Needs a decision'), 'the week view has its sections');

  const docsOut = run('npm run docs', ['docs.mjs'], { json: false });
  assert(/consumer-information-notice/.test(docsOut.stdout), 'CINs rendered');
  assert(/offer-and-sale/.test(docsOut.stdout), 'offer and sale agreements rendered');
  assert(/service-history/.test(docsOut.stdout), 'service histories rendered');
  assert(/customer-statement/.test(docsOut.stdout), 'customer statements rendered');

  // ---- the human readable side -------------------------------------------------

  run('stats (text)', ['dealer.mjs', 'stats'], { json: false });
  run('lot (text)', ['dealer.mjs', 'lot'], { json: false });
  run('vehicle (text)', ['dealer.mjs', 'vehicle', 'VH-102'], { json: false });
  run('customers (text)', ['dealer.mjs', 'customers'], { json: false });
  run('customer (text)', ['dealer.mjs', 'customer', 'Woods'], { json: false });
  run('team (text)', ['dealer.mjs', 'team'], { json: false });
  run('deals (text)', ['dealer.mjs', 'deals'], { json: false });
  run('sales (text)', ['dealer.mjs', 'sales'], { json: false });
  run('workshop (text)', ['dealer.mjs', 'workshop'], { json: false });
  run('ros (text)', ['dealer.mjs', 'ros'], { json: false });
  run('service-due (text)', ['dealer.mjs', 'service-due'], { json: false });
  run('invoices (text)', ['dealer.mjs', 'invoices'], { json: false });
  run('debtors (text)', ['dealer.mjs', 'debtors'], { json: false });
  run('unbilled (text)', ['dealer.mjs', 'unbilled'], { json: false });
  run('parts (text)', ['dealer.mjs', 'parts'], { json: false });
  run('settings (text)', ['dealer.mjs', 'settings'], { json: false });
  run('attention (text)', ['dealer.mjs', 'attention'], { json: false });
  run('compliance (text)', ['dealer.mjs', 'compliance'], { json: false });
  run('help', ['dealer.mjs', 'help'], { json: false });
  run('an unknown command exits 1', ['dealer.mjs', 'nonsense'], { json: false, expectFail: true });

  console.log(`\n${step} checks, PASS`);
} finally {
  if (existsSync(dataDir)) {
    try {
      rmSync(dataDir, { recursive: true, force: true });
    } catch {
      // Windows can hold the handle briefly; a leftover temp dir is harmless.
    }
  }
}
