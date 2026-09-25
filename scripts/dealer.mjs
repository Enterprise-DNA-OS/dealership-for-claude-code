#!/usr/bin/env node
// dealership-for-claude-code: the one CLI. Claude Code slash commands call
// this; so can you.
//
//   node scripts/dealer.mjs <command> [args] [--flags] [--json]
//
// Run with no arguments (or `help`) for the command list.
//
// This system is a New Zealand motor dealership's operating record the way
// CDK Global sells it: the customers, the salespeople and the technicians
// with their WoF inspector authorisations, the stock on the lot with its
// compliance paper (CIN, PPSR, WoF), the deals from quote to delivery, the
// workshop repair orders, the parts shelf, and the invoices. It sends
// nothing and connects to nothing: offer letters and follow-ups draft to
// drafts/, and a person sends them.
//
// The gates, and there are no force flags:
//   * a used vehicle does not take a deposit without a Consumer Information
//     Notice on record (Consumer Information Standards (Used Motor Vehicles)
//     Regulations 2008; Fair Trading Act 1986)
//   * a vehicle is not delivered without a PPSR check on record, and never
//     with an uncleared security interest (Personal Property Securities Act 1999)
//   * a used vehicle is delivered with a WoF issued inside the month, or a
//     written as-is acknowledgment on the record (Land Transport Rule:
//     Vehicle Standards Compliance 2002)
//   * a WoF inspection is booked and completed only under a technician whose
//     inspector authorisation is current on the day
//   * cash at or over the reporting threshold settles only with customer due
//     diligence on record (AML/CFT Act 2009)
//   * every stock unit carries an odometer reading before its CIN exists
//   * a repair order does not complete without work notes
//   * no deleting records: vehicles sell, deals are lost with a reason,
//     customers and staff become former

import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { getDb, REPO_ROOT } from './lib/db.mjs';
import { parseCsv, pick } from './lib/csv.mjs';
import { table, money, isoDate, truncate, heading } from './lib/format.mjs';

// ---------------------------------------------------------------------------
// Argument parsing

const BOOL_FLAGS = new Set(['json', 'help', 'all', 'dry-run', 'week', 'open', 'unbilled', 'aged', 'floorplan', 'cdd', 'as-is', 'clear', 'security']);

function parseArgv(argv) {
  const args = [];
  const flags = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--help' || a === '-h') {
      flags.help = true;
      continue;
    }
    if (a.startsWith('--')) {
      const eq = a.indexOf('=');
      let name;
      let value;
      if (eq > -1) {
        name = a.slice(2, eq);
        value = a.slice(eq + 1);
      } else {
        name = a.slice(2);
        const next = argv[i + 1];
        if (BOOL_FLAGS.has(name) || next === undefined || next.startsWith('--')) value = true;
        else value = argv[++i];
      }
      flags[name] = value;
    } else {
      args.push(a);
    }
  }
  return { args, flags };
}

class CliError extends Error {
  constructor(message, code = 1) {
    super(message);
    this.code = code;
  }
}

const num = (v) => Number(v ?? 0);
const str = (v) => (v === true || v === undefined || v === null ? '' : String(v));

// ---------------------------------------------------------------------------
// Dates and money

function today() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function addDays(iso, n) {
  const d = new Date(`${iso}T00:00:00`);
  d.setDate(d.getDate() + n);
  const pad = (x) => String(x).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function daysBetween(a, b) {
  return Math.round((new Date(`${b}T00:00:00`) - new Date(`${a}T00:00:00`)) / 86400000);
}

function parseDate(v, what = 'date') {
  if (!v || v === true) return null;
  const s = String(v).trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  const lower = s.toLowerCase();
  if (lower === 'today') return today();
  if (lower === 'yesterday') return addDays(today(), -1);
  if (lower === 'tomorrow') return addDays(today(), 1);
  // New Zealand exports write DD/MM/YYYY: the first number is the day unless
  // the second is too big to be a month.
  const slash = s.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})$/);
  if (slash) {
    const a = Number(slash[1]);
    const b = Number(slash[2]);
    const [day, month] = b > 12 ? [b, a] : [a, b];
    const year = slash[3].length === 2 ? `20${slash[3]}` : slash[3];
    return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  }
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) throw new CliError(`"${v}" is not a ${what}. Use YYYY-MM-DD.`);
  return isoDate(d);
}

function parseTime(v, what = 'time') {
  if (!v || v === true) return null;
  const m = String(v).trim().match(/^(\d{1,2}):(\d{2})\s*(am|pm)?$/i);
  if (!m) throw new CliError(`"${v}" is not a ${what}. Use HH:MM, 24 hour.`);
  let h = Number(m[1]);
  const min = Number(m[2]);
  const ap = (m[3] || '').toLowerCase();
  if (ap === 'pm' && h < 12) h += 12;
  if (ap === 'am' && h === 12) h = 0;
  if (h > 23 || min > 59) throw new CliError(`"${v}" is not a ${what}.`);
  return `${String(h).padStart(2, '0')}:${String(min).padStart(2, '0')}`;
}

function parseMoney(v, what = 'amount') {
  if (v === undefined || v === null || v === '' || v === true) return null;
  const n = Number(String(v).replace(/[^0-9.-]/g, ''));
  if (Number.isNaN(n)) throw new CliError(`"${v}" is not a ${what}. Money in dollars: 24500 means $24,500.00.`);
  return Math.round(n * 100);
}

function parseKm(v, what = 'odometer reading') {
  if (v === undefined || v === null || v === '' || v === true) return null;
  const n = Number(String(v).replace(/[^0-9]/g, ''));
  if (Number.isNaN(n) || n < 0) throw new CliError(`"${v}" is not an ${what}. Kilometres, digits only.`);
  return n;
}

function parseQty(v, what = 'quantity') {
  if (v === undefined || v === null || v === '' || v === true) throw new CliError(`A ${what} is required.`);
  const n = Number(v);
  if (Number.isNaN(n) || n <= 0) throw new CliError(`"${v}" is not a ${what}. Use a positive number.`);
  return n;
}

// ---------------------------------------------------------------------------
// Lookups: partial, case-insensitive, loud when ambiguous

async function resolveRow(db, sql, params, label, name) {
  const rows = await db.query(sql, params);
  if (rows.length === 1) return rows[0];
  if (!rows.length) throw new CliError(`No ${label} matches "${name}".`);
  const list = rows.slice(0, 10).map((r) => `  ${r.ref ? r.ref + '  ' : ''}${r.name || ''}${r.plate ? '  ' + r.plate : ''}${r.extra ? '  (' + r.extra + ')' : ''}`).join('\n');
  throw new CliError(`"${name}" matches ${rows.length} ${label} records. Which one?\n${list}`);
}

async function resolveCustomer(db, name) {
  if (!name) throw new CliError('Which customer? Give a name (partial is fine).');
  const n = String(name).trim();
  const exact = await db.query('select * from customers where lower(name) = lower($1)', [n]);
  if (exact.length === 1) return exact[0];
  return resolveRow(db, 'select * from customers where name ilike $1 order by name', [`%${n}%`], 'customer', n);
}

async function resolveStaff(db, name) {
  if (!name) throw new CliError('Which staff member? Give a name (partial is fine).');
  const n = String(name).trim();
  const exact = await db.query('select * from staff where lower(name) = lower($1)', [n]);
  if (exact.length === 1) return exact[0];
  return resolveRow(db, 'select * from staff where name ilike $1 order by name', [`%${n}%`], 'staff', n);
}

async function resolveVehicle(db, key) {
  if (!key) throw new CliError('Which vehicle? Give a ref like VH-102, a plate, a VIN, or make/model (partial is fine).');
  let n = String(key).trim();
  if (/^\d+$/.test(n)) n = `VH-${n}`;
  const exact = await db.query(
    `select * from vehicles where upper(ref) = upper($1) or upper(plate) = upper($1) or upper(vin) = upper($1)`, [n]);
  if (exact.length === 1) return exact[0];
  return resolveRow(db,
    `select v.*, (v.make || ' ' || v.model || ' ' || coalesce(v.year::text, '')) as name
     from vehicles v where (v.make || ' ' || v.model) ilike $1 or v.model ilike $1 order by v.ref`,
    [`%${n}%`], 'vehicle', n);
}

async function resolveItem(db, code) {
  if (!code) throw new CliError('Which item? Give a code like PAD-F or a name (partial is fine).');
  const n = String(code).trim();
  const exact = await db.query('select * from items where upper(code) = upper($1)', [n]);
  if (exact.length === 1) return exact[0];
  return resolveRow(db, 'select *, code as ref from items where name ilike $1 or code ilike $1 order by code', [`%${n}%`], 'item', n);
}

async function resolveByRef(db, tableName, prefix, ref, label) {
  if (!ref) throw new CliError(`Which ${label}? Give its ref, like ${prefix}-101.`);
  let r = String(ref).trim().toUpperCase();
  if (/^\d+$/.test(r)) r = `${prefix}-${r}`;
  const rows = await db.query(`select * from ${tableName} where upper(ref) = $1`, [r]);
  if (rows.length === 1) return rows[0];
  throw new CliError(`No ${label} with ref "${r}".`);
}

async function nextRef(db, tableName, prefix, start) {
  const [row] = await db.query(
    `select coalesce(max(substring(ref from '${prefix}-(\\d+)')::int), $1) + 1 as n from ${tableName} where ref like '${prefix}-%'`,
    [start - 1],
  );
  return `${prefix}-${row.n}`;
}

async function setting(db, key) {
  const [row] = await db.query('select value from settings where key = $1', [key]);
  return row ? row.value : null;
}

// ---------------------------------------------------------------------------
// The gates

function gateSalesperson(staffRow, doing) {
  if (staffRow.status !== 'active') throw new CliError(`${staffRow.name} is marked ${staffRow.status} and cannot ${doing}.`);
  if (!['sales', 'manager'].includes(staffRow.role)) {
    throw new CliError(`${staffRow.name} is a ${staffRow.role}, not a salesperson, and cannot ${doing}. A deal sits under sales or the manager.`);
  }
}

function gateTechnician(staffRow, doing) {
  if (staffRow.status !== 'active') throw new CliError(`${staffRow.name} is marked ${staffRow.status} and cannot ${doing}.`);
  if (staffRow.role !== 'technician') {
    throw new CliError(`${staffRow.name} is a ${staffRow.role}, not a technician, and cannot ${doing}. Workshop jobs sit under a technician.`);
  }
}

// A WoF inspection happens only under a technician whose inspector
// authorisation is current on the day. Land Transport Rule: Vehicle
// Standards Compliance 2002. No force flag.
function gateInspector(staffRow, onDate, doing) {
  gateTechnician(staffRow, doing);
  const exp = staffRow.inspector_expires_on ? isoDate(staffRow.inspector_expires_on) : null;
  if (!staffRow.inspector_number || !exp || exp < onDate) {
    throw new CliError(
      `${staffRow.name}'s inspector authorisation ${!staffRow.inspector_number || !exp ? 'is not on record' : `expired ${exp}`}, so they cannot ${doing} on ${onDate}. ` +
      `A WoF is issued only under a current vehicle inspector authorisation (Land Transport Rule: Vehicle Standards Compliance 2002). Renew it with NZTA, or use another inspector. No force flag.`,
    );
  }
}

// ---------------------------------------------------------------------------
// Output

let asJson = false;

function out(rows, columns) {
  if (asJson) {
    console.log(JSON.stringify(rows, null, 2));
    return;
  }
  if (Array.isArray(rows)) console.log(table(rows, columns));
  else console.log(rows);
}

function plain(obj) {
  const o = {};
  for (const [k, v] of Object.entries(obj)) o[k] = v instanceof Date ? isoDate(v) : v;
  return o;
}

const plainAll = (rows) => rows.map(plain);

// ---------------------------------------------------------------------------
// Commands

const commands = {};

commands.help = async () => {
  console.log(`dealership-for-claude-code: the dealership as a database and a CLI.

  the lot
    lot [--all] [--aged]                       every unit: days in, recon, interest, paper, state
    vehicle REF|PLATE|VIN|NAME                 the whole card: paper, deals, workshop history
    stock in --make= --model= --odometer= [--year= --cost= --asking= --source= --vin= --plate= --floorplan]
    vehicle odometer REF --km=                 vehicle cin REF [--on=]
    vehicle ppsr REF [--clear | --security]    vehicle wof REF --issued=
    aged                                       what has sat past the aged line, with the interest bill

  the deals
    deals [--all]                              the board: quote, deposit, delivered, lost
    deal open VEHICLE CUSTOMER --sales= [--price=] [--trade= --allowance=]
    deal price REF --price=                    deal deposit REF --amount= [--on=] [--method=]
    deal deliver REF [--on=] [--method=] [--cdd] [--as-is]
    deal lost REF --reason=                    sales   (delivered and gross by salesperson, 28 days)

  the workshop
    workshop                                   today's board and anything unresolved
    ros [--week] [--open] [--unbilled] [--all]
    ro book VEHICLE --tech= [--on=] [--at=] [--type=service] [--reason=] [--customer=]
    ro start REF           ro assign REF --tech=
    ro add REF ITEM [--qty=1] [--price=] [--note=]
    ro done REF --notes= [--odometer=] [--result=pass|fail]
    service-due                                every car we sold or serviced that has gone quiet

  the money
    invoice build RO-REF [--due=]              invoice paid REF [--on=]
    invoices [--unpaid] [--all]                debtors        unbilled

  the shelf
    parts [--all]                              parts receive ITEM --qty=

  the people
    customers [--all]      customer NAME       customer add NAME [--phone= --email= --suburb=]
    team [--all]           note add VEHICLE|--customer=NAME TEXT [--staff=]    notes VEHICLE

  the rules
    compliance [RULE]                          the rule book, run against the records
    attention                                  everything that wants a decision, worst first
    settings [set KEY VALUE]                   the numbers the rules read

  moving in and out
    import cdk --customers=FILE [--vehicles=FILE] [--dry-run]
    export [--out=FILE]                        stats

Any read command takes --json. Money in NZD. There are no force flags.`);
};

// ---- stats ---------------------------------------------------------------

commands.stats = async (db) => {
  const [s] = await db.query(`
    select
      (select count(*) from customers where status = 'active') as active_customers,
      (select count(*) from staff where status = 'active') as active_staff,
      (select count(*) from vehicles where kind = 'stock' and status = 'in_stock') as units_in_stock,
      (select coalesce(sum(cost_cents), 0) from vehicles where kind = 'stock' and status = 'in_stock')::bigint as stock_at_cost_cents,
      (select count(*) from v_vehicles where kind = 'stock' and status = 'in_stock' and days_in_stock >= (select aged_days from v_settings)) as aged_units,
      (select coalesce(sum(floorplan_interest_cents), 0) from v_vehicles where status = 'in_stock')::bigint as floorplan_interest_cents,
      (select count(*) from deals where status in ('quote', 'deposit')) as deals_open,
      (select count(*) from deals where status = 'deposit') as deposits_held,
      (select count(*) from deals where status = 'delivered' and delivered_on >= current_date - 28) as delivered_28d,
      (select count(*) from repair_orders where status in ('booked', 'open') and on_date = current_date) as workshop_today,
      (select count(*) from repair_orders where status = 'open') as ros_open,
      (select coalesce(sum(value_cents), 0) from v_ros where state = 'unbilled')::bigint as unbilled_cents,
      (select coalesce(sum(total_cents), 0) from v_invoices where status = 'issued')::bigint as outstanding_cents,
      (select count(*) from v_service_due) as service_due,
      (select count(*) from v_vehicles where kind = 'stock' and status = 'in_stock' and cin_completed_on is null) as cin_missing
  `);
  const r = plain(s);
  if (asJson) return console.log(JSON.stringify(r, null, 2));
  console.log(heading('Harbour City at a glance'));
  console.log(`  customers ${r.active_customers} active  ·  staff ${r.active_staff}  ·  units in stock ${r.units_in_stock} (${money(r.stock_at_cost_cents)} at cost, ${r.aged_units} aged)`);
  console.log(`  deals open ${r.deals_open} (${r.deposits_held} holding deposits)  ·  delivered last 28 days ${r.delivered_28d}`);
  console.log(`  workshop today ${r.workshop_today}  ·  open repair orders ${r.ros_open}  ·  unbilled ${money(r.unbilled_cents)}  ·  outstanding ${money(r.outstanding_cents)}`);
  console.log(`  service due ${r.service_due}  ·  floorplan interest accruing ${money(r.floorplan_interest_cents)}`);
  if (num(r.cin_missing) > 0) console.log(`  CIN MISSING on ${r.cin_missing} unit(s) offered for sale. Run: compliance cin`);
};

// ---- the lot -------------------------------------------------------------

const LOT_COLS = [
  { key: 'ref', label: 'ref' },
  { key: 'unit', label: 'unit', width: 26 },
  { key: 'odometer_km', label: 'km', align: 'right', format: (v) => (v == null ? 'NONE' : Number(v).toLocaleString('en-NZ')) },
  { key: 'source', label: 'source' },
  { key: 'days_in_stock', label: 'days', align: 'right' },
  { key: 'asking_cents', label: 'asking', align: 'right', format: money },
  { key: 'recon_cents', label: 'recon', align: 'right', format: (v) => (num(v) ? money(v) : '') },
  { key: 'floorplan_interest_cents', label: 'interest', align: 'right', format: (v) => (num(v) ? money(v) : '') },
  { key: 'paper', label: 'CIN/PPSR/WoF' },
  { key: 'state', label: 'state' },
];

function withPaper(rows) {
  return rows.map((r) => ({
    ...r,
    paper: [r.cin_completed_on ? 'cin' : 'CIN?', r.ppsr_checked_on ? 'ppsr' : 'PPSR?', r.wof_issued_on ? 'wof' : 'WOF?'].join(' '),
  }));
}

commands.lot = async (db, args, flags) => {
  let where = `kind = 'stock' and status = 'in_stock'`;
  if (flags.all) where = `kind = 'stock'`;
  if (flags.aged) where = `kind = 'stock' and status = 'in_stock' and days_in_stock >= (select aged_days from v_settings)`;
  const rows = withPaper(plainAll(await db.query(`select * from v_vehicles where ${where} order by days_in_stock desc nulls last`)));
  out(rows, LOT_COLS);
};

commands.aged = async (db, args, flags) => commands.lot(db, args, { ...flags, aged: true });

commands.vehicle = async (db, args, flags) => {
  const sub = args[0];
  if (['odometer', 'cin', 'ppsr', 'wof'].includes(sub)) {
    const v = await resolveVehicle(db, args[1]);
    if (sub === 'odometer') {
      const km = parseKm(flags.km);
      if (km == null) throw new CliError('The reading: --km= kilometres off the dash.');
      const [row] = await db.query(`update vehicles set odometer_km = $2 where id = $1 returning *`, [v.id, km]);
      if (asJson) return console.log(JSON.stringify(plain(row), null, 2));
      return console.log(`${v.ref}: odometer ${km.toLocaleString('en-NZ')} km on record.`);
    }
    if (sub === 'cin') {
      if (v.kind !== 'stock') throw new CliError(`${v.ref} is a customer's car; a CIN belongs on a unit offered for sale.`);
      if (v.odometer_km == null) {
        throw new CliError(`${v.ref} has no odometer reading on record, and the CIN must state it (Consumer Information Standards (Used Motor Vehicles) Regulations 2008). Read the dash first: vehicle odometer ${v.ref} --km=`);
      }
      const on = parseDate(flags.on) || today();
      const [row] = await db.query(`update vehicles set cin_completed_on = $2 where id = $1 returning *`, [v.id, on]);
      if (asJson) return console.log(JSON.stringify(plain(row), null, 2));
      return console.log(`${v.ref}: CIN recorded ${on}. Print it for the windscreen: npm run docs`);
    }
    if (sub === 'ppsr') {
      const on = parseDate(flags.on) || today();
      const security = flags.clear ? false : flags.security ? true : false;
      if (!flags.clear && !flags.security) {
        throw new CliError(`What did the search say? --clear (nothing registered) or --security (an interest is registered). The answer goes on the record either way.`);
      }
      const [row] = await db.query(`update vehicles set ppsr_checked_on = $2, security_interest = $3 where id = $1 returning *`, [v.id, on, security]);
      if (asJson) return console.log(JSON.stringify(plain(row), null, 2));
      return console.log(`${v.ref}: PPSR search recorded ${on}, ${security ? 'SECURITY INTEREST REGISTERED. The unit does not deliver until it is discharged and re-searched clear.' : 'clear.'}`);
    }
    if (sub === 'wof') {
      const issued = parseDate(flags.issued, 'WoF issue date');
      if (!issued) throw new CliError('When was it issued? --issued=YYYY-MM-DD (or today).');
      const [row] = await db.query(`update vehicles set wof_issued_on = $2 where id = $1 returning *`, [v.id, issued]);
      if (asJson) return console.log(JSON.stringify(plain(row), null, 2));
      return console.log(`${v.ref}: WoF issued ${issued} on record.`);
    }
  }
  const v = await resolveVehicle(db, args[0]);
  const [card] = await db.query(`select * from v_vehicles where vehicle_id = $1`, [v.id]);
  const deals = plainAll(await db.query(`select * from v_deals where vehicle_id = $1 order by opened_on desc`, [v.id]));
  const ros = plainAll(await db.query(`select * from v_ros where vehicle_id = $1 order by on_date desc limit 12`, [v.id]));
  const notes = plainAll(await db.query(
    `select fn.noted_on, s.name as staff, fn.note from file_notes fn left join staff s on s.id = fn.staff_id
     where fn.vehicle_id = $1 order by fn.noted_on desc limit 8`, [v.id]));
  const result = { vehicle: plain(card), deals, repair_orders: ros, notes };
  if (asJson) return console.log(JSON.stringify(result, null, 2));
  const c = plain(card);
  console.log(heading(`${c.ref}  ${c.unit}  (${c.kind === 'customer' ? 'customer car' : c.status})`));
  console.log(`  vin ${c.vin || '?'}  plate ${c.plate || '?'}  ·  ${c.colour || ''}  ·  odometer ${c.odometer_km == null ? 'NONE ON RECORD' : Number(c.odometer_km).toLocaleString('en-NZ') + ' km'}`);
  if (c.kind === 'stock') {
    console.log(`  in ${isoDate(c.acquired_on)} (${c.days_in_stock} days, ${c.source || '?'})  ·  cost ${money(c.cost_cents)}  recon ${money(c.recon_cents)}  asking ${money(c.asking_cents)}${num(c.floorplan_interest_cents) ? '  ·  floorplan interest ' + money(c.floorplan_interest_cents) : ''}`);
    console.log(`  CIN ${c.cin_completed_on ? isoDate(c.cin_completed_on) : 'MISSING'}  ·  PPSR ${c.ppsr_checked_on ? isoDate(c.ppsr_checked_on) + (c.security_interest ? ' SECURITY INTEREST' : ' clear') : 'MISSING'}  ·  WoF ${c.wof_issued_on ? isoDate(c.wof_issued_on) : 'MISSING'}${c.as_is_ack_on ? '  ·  as-is ack ' + isoDate(c.as_is_ack_on) : ''}`);
  }
  if (c.owner) console.log(`  owner ${c.owner}`);
  if (deals.length) {
    console.log(heading('Deals'));
    console.log(table(deals, [
      { key: 'ref', label: 'ref' },
      { key: 'customer', label: 'customer' },
      { key: 'salesperson', label: 'sales' },
      { key: 'opened_on', label: 'opened', format: isoDate },
      { key: 'sale_price_cents', label: 'price', align: 'right', format: money },
      { key: 'gross_cents', label: 'gross', align: 'right', format: (x) => (x == null ? '' : money(x)) },
      { key: 'state', label: 'state' },
    ]));
  }
  if (ros.length) {
    console.log(heading('Workshop'));
    console.log(table(ros, [
      { key: 'ref', label: 'ref' },
      { key: 'on_date', label: 'date', format: isoDate },
      { key: 'type', label: 'type' },
      { key: 'reason', label: 'reason', width: 30, format: (x) => truncate(x, 30) },
      { key: 'technician', label: 'tech' },
      { key: 'value_cents', label: 'value', align: 'right', format: money },
      { key: 'state', label: 'state' },
    ]));
  }
  if (notes.length) {
    console.log(heading('File notes'));
    for (const n of notes) console.log(`  ${isoDate(n.noted_on)}  ${n.staff || ''}: ${n.note}`);
  }
};

commands.stock = async (db, args, flags) => {
  if (args[0] !== 'in') throw new CliError('Usage: stock in --make= --model= --odometer= [--year= --cost= --asking= --source= --vin= --plate= --colour= --floorplan]');
  const make = str(flags.make).trim();
  const model = str(flags.model).trim();
  if (!make || !model) throw new CliError('The unit: --make= and --model= at minimum.');
  const km = parseKm(flags.odometer);
  if (km == null) {
    throw new CliError('No odometer, no stock-in. The CIN must state the reading and odometer misstatement is the classic dealer prosecution (Fair Trading Act 1986). --odometer= what the dash says. No force flag.');
  }
  const source = str(flags.source) || 'trade_in';
  if (!['trade_in', 'auction', 'import', 'private', 'new'].includes(source)) {
    throw new CliError(`"${source}" is not a source. Use trade_in, auction, import, private or new.`);
  }
  const ref = await nextRef(db, 'vehicles', 'VH', 101);
  const [row] = await db.query(
    `insert into vehicles (ref, kind, make, model, year, odometer_km, colour, vin, plate, source, acquired_on, cost_cents, asking_cents, floorplan)
     values ($1, 'stock', $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13) returning *`,
    [ref, make, model, flags.year ? Math.round(num(flags.year)) : null, km, str(flags.colour) || null,
     str(flags.vin) || null, str(flags.plate) || null, source, parseDate(flags.on) || today(),
     parseMoney(flags.cost, 'cost'), parseMoney(flags.asking, 'asking price'), !!flags.floorplan],
  );
  const r = plain(row);
  if (asJson) return console.log(JSON.stringify(r, null, 2));
  return console.log(`${ref}: ${make} ${model} in stock at ${km.toLocaleString('en-NZ')} km. Next: vehicle cin ${ref}, vehicle ppsr ${ref} --clear, then it is honestly for sale.`);
};

// ---- customers and staff ---------------------------------------------------

commands.customers = async (db, args, flags) => {
  const rows = plainAll(await db.query(
    `select c.name, c.phone, c.suburb, c.status,
            (select count(*) from deals d where d.customer_id = c.id and d.status = 'delivered') as bought,
            (select count(*) from repair_orders r where r.customer_id = c.id and r.status = 'completed') as workshop_visits,
            (select coalesce(sum(i.total_cents), 0) from invoices i where i.customer_id = c.id and i.status = 'issued')::bigint as owing_cents,
            (select max(x.d) from (
               select max(r.on_date) as d from repair_orders r where r.customer_id = c.id and r.status = 'completed'
               union all select max(dl.delivered_on) from deals dl where dl.customer_id = c.id and dl.status = 'delivered'
             ) x) as last_seen_on
     from customers c ${flags.all ? '' : `where c.status = 'active'`} order by c.name`,
  ));
  out(rows, [
    { key: 'name', label: 'customer' },
    { key: 'phone', label: 'phone' },
    { key: 'suburb', label: 'suburb' },
    { key: 'bought', label: 'bought', align: 'right' },
    { key: 'workshop_visits', label: 'workshop', align: 'right' },
    { key: 'owing_cents', label: 'owing', align: 'right', format: (v) => (num(v) ? money(v) : '') },
    { key: 'last_seen_on', label: 'last seen', format: isoDate },
    { key: 'status', label: 'status' },
  ]);
};

commands.customer = async (db, args, flags) => {
  if (args[0] === 'add') {
    const name = args.slice(1).join(' ').trim();
    if (!name) throw new CliError('Usage: customer add NAME [--phone= --email= --suburb= --address=]');
    const existing = await db.query('select * from customers where lower(name) = lower($1)', [name]);
    if (existing.length) throw new CliError(`${name} is already on file.`);
    const [row] = await db.query(
      `insert into customers (name, phone, email, address, suburb) values ($1, $2, $3, $4, $5) returning *`,
      [name, str(flags.phone) || null, str(flags.email) || null, str(flags.address) || null, str(flags.suburb) || null]);
    if (asJson) return console.log(JSON.stringify(plain(row), null, 2));
    return console.log(`${name} is on file.`);
  }
  const customer = await resolveCustomer(db, args.join(' '));
  const vehicles = plainAll(await db.query(
    `select * from v_vehicles where customer_id = $1
      or vehicle_id in (select vehicle_id from deals where customer_id = $1 and status = 'delivered') order by ref`, [customer.id]));
  const deals = plainAll(await db.query(`select * from v_deals where customer_id = $1 order by opened_on desc`, [customer.id]));
  const ros = plainAll(await db.query(`select * from v_ros where customer_id = $1 order by on_date desc limit 10`, [customer.id]));
  const invoices = plainAll(await db.query(`select * from v_invoices where customer_id = $1 order by issued_on desc limit 10`, [customer.id]));
  const notes = plainAll(await db.query(
    `select fn.noted_on, s.name as staff, fn.note from file_notes fn left join staff s on s.id = fn.staff_id
     where fn.customer_id = $1 order by fn.noted_on desc limit 8`, [customer.id]));
  const result = { customer: plain(customer), vehicles, deals, repair_orders: ros, invoices, notes };
  if (asJson) return console.log(JSON.stringify(result, null, 2));
  console.log(heading(`${customer.name}  (${customer.status})`));
  console.log(`  ${customer.phone || ''}  ${customer.email || ''}  ${[customer.address, customer.suburb].filter(Boolean).join(', ')}`);
  if (vehicles.length) {
    console.log(heading('Vehicles'));
    console.log(table(vehicles, [
      { key: 'ref', label: 'ref' },
      { key: 'unit', label: 'unit', width: 26 },
      { key: 'plate', label: 'plate' },
      { key: 'odometer_km', label: 'km', align: 'right', format: (v) => (v == null ? '?' : Number(v).toLocaleString('en-NZ')) },
    ]));
  }
  if (deals.length) {
    console.log(heading('Deals'));
    console.log(table(deals, [
      { key: 'ref', label: 'ref' },
      { key: 'unit', label: 'unit', width: 24 },
      { key: 'salesperson', label: 'sales' },
      { key: 'opened_on', label: 'opened', format: isoDate },
      { key: 'sale_price_cents', label: 'price', align: 'right', format: money },
      { key: 'state', label: 'state' },
    ]));
  }
  if (ros.length) {
    console.log(heading('Workshop'));
    console.log(table(ros, [
      { key: 'ref', label: 'ref' },
      { key: 'on_date', label: 'date', format: isoDate },
      { key: 'unit', label: 'unit', width: 22 },
      { key: 'type', label: 'type' },
      { key: 'value_cents', label: 'value', align: 'right', format: money },
      { key: 'state', label: 'state' },
    ]));
  }
  if (invoices.length) {
    console.log(heading('Invoices'));
    console.log(table(invoices, [
      { key: 'ref', label: 'ref' },
      { key: 'issued_on', label: 'issued', format: isoDate },
      { key: 'total_cents', label: 'total', align: 'right', format: money },
      { key: 'state', label: 'state' },
    ]));
  }
  if (notes.length) {
    console.log(heading('File notes'));
    for (const n of notes) console.log(`  ${isoDate(n.noted_on)}  ${n.staff || ''}: ${n.note}`);
  }
};

commands.team = async (db, args, flags) => {
  const rows = plainAll(await db.query(
    `select * from v_staff ${flags.all ? '' : `where status = 'active'`} order by role, name`));
  out(rows, [
    { key: 'name', label: 'name' },
    { key: 'role', label: 'role' },
    { key: 'inspector_number', label: 'inspector no' },
    { key: 'inspector_expires_on', label: 'auth expires', format: isoDate },
    { key: 'inspector', label: 'auth' },
    { key: 'wof_bookings', label: 'wof jobs', align: 'right' },
    { key: 'ros_open', label: 'ros open', align: 'right' },
    { key: 'deals_open', label: 'deals open', align: 'right' },
    { key: 'delivered_28d', label: 'delivered 28d', align: 'right' },
    { key: 'status', label: 'status' },
  ]);
};

// ---- deals ---------------------------------------------------------------

const DEAL_COLS = [
  { key: 'ref', label: 'ref' },
  { key: 'unit', label: 'unit', width: 24 },
  { key: 'customer', label: 'customer' },
  { key: 'salesperson', label: 'sales' },
  { key: 'opened_on', label: 'opened', format: isoDate },
  { key: 'sale_price_cents', label: 'price', align: 'right', format: money },
  { key: 'deposit_cents', label: 'deposit', align: 'right', format: (v) => (num(v) ? money(v) : '') },
  { key: 'gross_cents', label: 'gross', align: 'right', format: (v) => (v == null ? '' : money(v)) },
  { key: 'state', label: 'state' },
];

commands.deals = async (db, args, flags) => {
  const where = flags.all ? '1=1' : `status in ('quote', 'deposit') or (status = 'delivered' and delivered_on >= current_date - 28)`;
  const rows = plainAll(await db.query(`select * from v_deals where ${where} order by case status when 'deposit' then 0 when 'quote' then 1 when 'delivered' then 2 else 3 end, opened_on desc`));
  out(rows, DEAL_COLS);
};

commands.deal = async (db, args, flags) => {
  const sub = args[0];
  if (sub === 'open') {
    const vehicle = await resolveVehicle(db, args[1]);
    if (vehicle.kind !== 'stock') throw new CliError(`${vehicle.ref} is a customer's car, not stock.`);
    if (vehicle.status !== 'in_stock') throw new CliError(`${vehicle.ref} is ${vehicle.status}.`);
    const live = await db.query(`select ref, status from deals where vehicle_id = $1 and status in ('quote', 'deposit')`, [vehicle.id]);
    if (live.length) {
      throw new CliError(`${vehicle.ref} already carries ${live[0].ref} (${live[0].status}). One unit, one live deal: lose that one first (deal lost ${live[0].ref} --reason=) or deliver it.`);
    }
    const customer = await resolveCustomer(db, args[2]);
    if (customer.status !== 'active') throw new CliError(`${customer.name} is marked ${customer.status}.`);
    const sales = await resolveStaff(db, str(flags.sales));
    gateSalesperson(sales, 'hold a deal');
    const price = flags.price !== undefined ? parseMoney(flags.price, 'sale price') : num(vehicle.asking_cents) || null;
    const ref = await nextRef(db, 'deals', 'DL', 5001);
    const [row] = await db.query(
      `insert into deals (ref, vehicle_id, customer_id, staff_id, sale_price_cents, trade_in_desc, trade_in_allowance_cents)
       values ($1, $2, $3, $4, $5, $6, $7) returning *`,
      [ref, vehicle.id, customer.id, sales.id, price, str(flags.trade) || null, parseMoney(flags.allowance, 'trade allowance')],
    );
    const r = plain(row);
    if (asJson) return console.log(JSON.stringify(r, null, 2));
    return console.log(`${ref}: ${vehicle.make} ${vehicle.model} (${vehicle.ref}) quoted to ${customer.name} at ${money(price)} (${sales.name}). Deposit: deal deposit ${ref} --amount=`);
  }
  if (sub === 'price') {
    const deal = await resolveByRef(db, 'deals', 'DL', args[1], 'deal');
    if (['delivered', 'lost'].includes(deal.status)) throw new CliError(`${deal.ref} is ${deal.status}; the price is history now.`);
    const price = parseMoney(flags.price, 'sale price');
    if (price == null) throw new CliError('The new number: --price=');
    await db.query(`update deals set sale_price_cents = $2 where id = $1`, [deal.id, price]);
    if (asJson) return console.log(JSON.stringify({ ref: deal.ref, sale_price_cents: price }, null, 2));
    return console.log(`${deal.ref}: price now ${money(price)}.`);
  }
  if (sub === 'deposit') {
    const deal = await resolveByRef(db, 'deals', 'DL', args[1], 'deal');
    if (deal.status !== 'quote') throw new CliError(`${deal.ref} is ${deal.status}${deal.status === 'deposit' ? ' already' : ''}.`);
    const [vehicle] = await db.query('select * from vehicles where id = $1', [deal.vehicle_id]);
    if (vehicle.source !== 'new' && !vehicle.cin_completed_on) {
      throw new CliError(
        `${vehicle.ref} has no Consumer Information Notice on record. A used vehicle is not offered, let alone sold, without a displayed CIN ` +
        `(Consumer Information Standards (Used Motor Vehicles) Regulations 2008; Fair Trading Act 1986). Record it first: vehicle cin ${vehicle.ref}. No force flag.`,
      );
    }
    const amount = parseMoney(flags.amount, 'deposit');
    if (amount == null) throw new CliError('How much? --amount= the deposit taken.');
    const on = parseDate(flags.on) || today();
    const [row] = await db.query(
      `update deals set status = 'deposit', deposit_cents = $2, deposit_on = $3, payment_method = coalesce(nullif($4, ''), payment_method) where id = $1 returning *`,
      [deal.id, amount, on, str(flags.method)],
    );
    const r = plain(row);
    if (asJson) return console.log(JSON.stringify(r, null, 2));
    return console.log(`${deal.ref}: ${money(amount)} deposit held, ${vehicle.ref} is off the market. Deliver: deal deliver ${deal.ref}`);
  }
  if (sub === 'deliver') {
    const deal = await resolveByRef(db, 'deals', 'DL', args[1], 'deal');
    if (!['quote', 'deposit'].includes(deal.status)) throw new CliError(`${deal.ref} is already ${deal.status}.`);
    const [vehicle] = await db.query('select * from vehicles where id = $1', [deal.vehicle_id]);
    const on = parseDate(flags.on) || today();
    // CIN: the deposit gate normally catches this, but a straight-to-delivery
    // deal gets no free pass.
    if (vehicle.source !== 'new' && !vehicle.cin_completed_on) {
      throw new CliError(`${vehicle.ref} has no CIN on record (Consumer Information Standards (Used Motor Vehicles) Regulations 2008). Record it first: vehicle cin ${vehicle.ref}. No force flag.`);
    }
    // PPSR: the security follows the car.
    if (!vehicle.ppsr_checked_on) {
      throw new CliError(
        `${vehicle.ref} has no PPSR check on record. If money is owing on this unit the security interest follows the car to your customer's driveway ` +
        `(Personal Property Securities Act 1999). Run the search and record it: vehicle ppsr ${vehicle.ref} --clear or --security. No force flag.`,
      );
    }
    if (vehicle.security_interest) {
      throw new CliError(`${vehicle.ref} carries a registered security interest. Discharge it, re-search, record it clear (vehicle ppsr ${vehicle.ref} --clear), then deliver. No force flag.`);
    }
    // WoF: inside the month, or the lawful written as-is acknowledgment.
    const wof = vehicle.wof_issued_on ? isoDate(vehicle.wof_issued_on) : null;
    const wofFresh = wof && daysBetween(wof, on) <= 30;
    let asIsOn = vehicle.as_is_ack_on ? isoDate(vehicle.as_is_ack_on) : null;
    if (!wofFresh && !flags['as-is'] && !asIsOn) {
      throw new CliError(
        `${vehicle.ref}'s WoF ${wof ? `was issued ${wof}, more than 30 days before delivery` : 'is not on record'}. A used vehicle is delivered with a WoF issued inside the month ` +
        `(Land Transport Rule: Vehicle Standards Compliance 2002). Get it inspected (ro book ${vehicle.ref} --type=wof --tech=...), or record a written as-is acknowledgment with --as-is.`,
      );
    }
    if (!wofFresh && flags['as-is'] && !asIsOn) asIsOn = on;
    // AML: big cash settles with CDD on record.
    const method = str(flags.method) || deal.payment_method || null;
    const threshold = num(await setting(db, 'cash_cdd_threshold_cents')) || 1000000;
    let cdd = deal.cdd_completed_on ? isoDate(deal.cdd_completed_on) : null;
    if (flags.cdd) cdd = flags.cdd === true ? on : parseDate(flags.cdd, 'CDD date');
    if (method === 'cash' && num(deal.sale_price_cents) >= threshold && !cdd) {
      throw new CliError(
        `${deal.ref} settles ${money(deal.sale_price_cents)} in cash, at or over the ${money(threshold)} threshold. A motor vehicle dealer is a high-value dealer: ` +
        `customer due diligence goes on record before the cash does (AML/CFT Act 2009). Verify identity, then --cdd (today) or --cdd=DATE. No force flag.`,
      );
    }
    const [row] = await db.query(
      `update deals set status = 'delivered', delivered_on = $2, payment_method = $3, cdd_completed_on = $4 where id = $1 returning *`,
      [deal.id, on, method, cdd],
    );
    await db.query(`update vehicles set status = 'sold', as_is_ack_on = coalesce($2, as_is_ack_on) where id = $1`, [vehicle.id, asIsOn]);
    const [v] = await db.query(`select * from v_deals where deal_id = $1`, [deal.id]);
    const r = plain({ ...row, gross_cents: v.gross_cents == null ? null : num(v.gross_cents) });
    if (asJson) return console.log(JSON.stringify(r, null, 2));
    return console.log(`${deal.ref}: delivered ${on}${v.gross_cents != null ? ', ' + money(v.gross_cents) + ' front-end gross' : ''}${asIsOn ? ' (as-is acknowledgment on record)' : ''}. ${v.customer} joins the service-due list from here.`);
  }
  if (sub === 'lost') {
    const deal = await resolveByRef(db, 'deals', 'DL', args[1], 'deal');
    if (['delivered', 'lost'].includes(deal.status)) throw new CliError(`${deal.ref} is already ${deal.status}.`);
    if (!str(flags.reason)) throw new CliError('Why did it die? --reason= goes on the record: the lost-reason report is how pricing arguments end.');
    const [row] = await db.query(`update deals set status = 'lost', lost_reason = $2 where id = $1 returning *`, [deal.id, str(flags.reason)]);
    if (asJson) return console.log(JSON.stringify(plain(row), null, 2));
    return console.log(`${deal.ref}: lost. The unit is back on the market.`);
  }
  throw new CliError('Usage: deal open VEHICLE CUSTOMER --sales=  |  deal deposit REF --amount=  |  deal deliver REF [--method=] [--cdd] [--as-is]  |  deal lost REF --reason=  |  deal price REF --price=');
};

commands.sales = async (db) => {
  const rows = plainAll(await db.query(
    `select s.name as salesperson,
            (select count(*) from deals d where d.staff_id = s.id and d.status in ('quote', 'deposit')) as open_deals,
            (select count(*) from deals d where d.staff_id = s.id and d.status = 'delivered' and d.delivered_on >= current_date - 28) as delivered_28d,
            (select coalesce(sum(v.gross_cents), 0) from v_deals v where v.staff_id = s.id and v.status = 'delivered' and v.delivered_on >= current_date - 28)::bigint as gross_28d_cents,
            (select count(*) from deals d where d.staff_id = s.id and d.status = 'lost' and d.opened_on >= current_date - 28) as lost_28d
     from staff s where s.status = 'active' and s.role in ('sales', 'manager') order by gross_28d_cents desc`));
  out(rows, [
    { key: 'salesperson', label: 'salesperson' },
    { key: 'open_deals', label: 'open', align: 'right' },
    { key: 'delivered_28d', label: 'delivered 28d', align: 'right' },
    { key: 'gross_28d_cents', label: 'gross 28d', align: 'right', format: money },
    { key: 'lost_28d', label: 'lost 28d', align: 'right' },
  ]);
};

// ---- the workshop ----------------------------------------------------------

const RO_COLS = [
  { key: 'ref', label: 'ref' },
  { key: 'on_date', label: 'date', format: isoDate },
  { key: 'promised_at', label: 'at', format: (v) => (v ? String(v).slice(0, 5) : '') },
  { key: 'unit', label: 'unit', width: 24 },
  { key: 'customer', label: 'customer' },
  { key: 'technician', label: 'tech' },
  { key: 'type', label: 'type' },
  { key: 'reason', label: 'reason', width: 28, format: (v) => truncate(v, 28) },
  { key: 'value_cents', label: 'value', align: 'right', format: (v) => (num(v) ? money(v) : '') },
  { key: 'state', label: 'state' },
];

commands.workshop = async (db) => {
  const rows = plainAll(await db.query(
    `select * from v_ros where (on_date = current_date and status in ('booked', 'open')) or state in ('BOOKED PAST', 'OPEN STALE') order by on_date, promised_at nulls last`));
  out(rows, RO_COLS);
};

commands.ros = async (db, args, flags) => {
  let where = `on_date >= current_date - 30 or status in ('booked', 'open')`;
  if (flags.week) where = `(status in ('booked', 'open') and on_date between current_date and current_date + 7) or state in ('BOOKED PAST', 'OPEN STALE')`;
  if (flags.open) where = `status in ('booked', 'open')`;
  if (flags.unbilled) where = `state = 'unbilled'`;
  if (flags.all) where = `1=1`;
  const rows = plainAll(await db.query(`select * from v_ros where ${where} order by on_date desc, promised_at nulls last`));
  out(rows, RO_COLS);
};

commands.ro = async (db, args, flags) => {
  const sub = args[0];
  if (sub === 'book') {
    const vehicle = await resolveVehicle(db, args[1]);
    const tech = await resolveStaff(db, str(flags.tech));
    const onDate = parseDate(flags.on) || today();
    const type = str(flags.type) || (vehicle.kind === 'stock' && vehicle.status === 'in_stock' ? 'recon' : 'service');
    if (!['service', 'repair', 'wof', 'recon', 'accessory'].includes(type)) {
      throw new CliError(`"${type}" is not a job type. Use service, repair, wof, recon or accessory.`);
    }
    if (type === 'wof') gateInspector(tech, onDate, 'take a WoF inspection');
    else gateTechnician(tech, 'take a workshop job');
    // Whose job is it? A customer car's owner pays; a sold unit's buyer pays;
    // work on unsold stock is internal (it lands in the unit's cost) unless a
    // customer is named explicitly.
    let customerId = vehicle.customer_id;
    if (!customerId && vehicle.kind === 'stock' && vehicle.status === 'sold') {
      const [buyer] = await db.query(`select customer_id from deals where vehicle_id = $1 and status = 'delivered' order by delivered_on desc limit 1`, [vehicle.id]);
      customerId = buyer ? buyer.customer_id : null;
    }
    if (flags.customer) customerId = (await resolveCustomer(db, str(flags.customer))).id;
    if (vehicle.kind === 'stock' && vehicle.status === 'in_stock' && !flags.customer) customerId = null;
    if (type === 'recon') customerId = null;
    const ref = await nextRef(db, 'repair_orders', 'RO', 7001);
    const [row] = await db.query(
      `insert into repair_orders (ref, vehicle_id, customer_id, staff_id, on_date, promised_at, type, reason, odometer_km)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9) returning *`,
      [ref, vehicle.id, type === 'recon' ? null : customerId, tech.id, onDate, parseTime(flags.at), type, str(flags.reason) || null, parseKm(flags.odometer)],
    );
    const r = plain(row);
    if (asJson) return console.log(JSON.stringify(r, null, 2));
    return console.log(`${ref}: ${type} on ${vehicle.make} ${vehicle.model} (${vehicle.ref}) with ${tech.name}, ${onDate}${row.promised_at ? ' ' + String(row.promised_at).slice(0, 5) : ''}.`);
  }
  if (sub === 'start') {
    const ro = await resolveByRef(db, 'repair_orders', 'RO', args[1], 'repair order');
    if (ro.status !== 'booked') throw new CliError(`${ro.ref} is ${ro.status}.`);
    const [row] = await db.query(`update repair_orders set status = 'open', on_date = coalesce($2, on_date) where id = $1 returning *`, [ro.id, parseDate(flags.on)]);
    if (asJson) return console.log(JSON.stringify(plain(row), null, 2));
    return console.log(`${ro.ref}: on the hoist. Add lines with: ro add ${ro.ref} ITEM`);
  }
  if (sub === 'assign') {
    const ro = await resolveByRef(db, 'repair_orders', 'RO', args[1], 'repair order');
    if (ro.status === 'completed') throw new CliError(`${ro.ref} is completed; the record keeps who did the work.`);
    const tech = await resolveStaff(db, str(flags.tech));
    if (ro.type === 'wof') gateInspector(tech, parseDate(flags.on) || today(), 'take a WoF inspection');
    else gateTechnician(tech, 'take a workshop job');
    await db.query(`update repair_orders set staff_id = $2 where id = $1`, [ro.id, tech.id]);
    if (asJson) return console.log(JSON.stringify({ ref: ro.ref, technician: tech.name }, null, 2));
    return console.log(`${ro.ref}: reassigned to ${tech.name}.`);
  }
  if (sub === 'add') {
    const ro = await resolveByRef(db, 'repair_orders', 'RO', args[1], 'repair order');
    if (ro.status === 'completed') throw new CliError(`${ro.ref} is completed. Charges go on while the job is open; book a new one for new work.`);
    const item = await resolveItem(db, args[2]);
    const qty = flags.qty !== undefined ? parseQty(flags.qty) : 1;
    const price = flags.price !== undefined ? parseMoney(flags.price, 'unit price') : num(item.price_cents);
    if (item.track_stock) {
      if (num(item.stock_qty) < qty) {
        throw new CliError(`Only ${item.stock_qty} ${item.unit} of ${item.name} on the shelf; cannot fit ${qty}. Receive stock first: parts receive ${item.code} --qty=`);
      }
      await db.query(`update items set stock_qty = stock_qty - $2 where id = $1`, [item.id, qty]);
    }
    const [line] = await db.query(
      `insert into ro_lines (ro_id, item_id, qty, unit_price_cents, note) values ($1, $2, $3, $4, $5) returning *`,
      [ro.id, item.id, qty, price, str(flags.note) || null],
    );
    const r = plain({ ...line, item: item.name, code: item.code, total_cents: Math.round(qty * price) });
    if (asJson) return console.log(JSON.stringify(r, null, 2));
    return console.log(`${ro.ref}: ${qty} x ${item.name} at ${money(price)} = ${money(qty * price)}.`);
  }
  if (sub === 'done') {
    const ro = await resolveByRef(db, 'repair_orders', 'RO', args[1], 'repair order');
    if (ro.status === 'completed') throw new CliError(`${ro.ref} is already completed.`);
    const notes = str(flags.notes).trim();
    if (!notes) {
      throw new CliError(`${ro.ref} does not complete without work notes. When a customer disputes a repair, the record is the dealership's defence (Consumer Guarantees Act 1993). --notes= what you found and what you did. No force flag.`);
    }
    const onDate = parseDate(flags.on) || (ro.status === 'booked' ? today() : isoDate(ro.on_date));
    let wofResult = null;
    let wofWrite = null;
    if (ro.type === 'wof') {
      const [tech] = await db.query('select * from staff where id = $1', [ro.staff_id]);
      gateInspector(tech, onDate, 'complete a WoF inspection');
      wofResult = str(flags.result).toLowerCase();
      if (!['pass', 'fail'].includes(wofResult)) {
        throw new CliError(`${ro.ref} is a WoF inspection: it completes with a result. --result=pass or --result=fail. No force flag.`);
      }
      if (wofResult === 'pass') wofWrite = onDate;
    } else if (flags.result !== undefined) {
      throw new CliError(`${ro.ref} is a ${ro.type} job; --result belongs on WoF inspections.`);
    }
    const km = parseKm(flags.odometer);
    const [row] = await db.query(
      `update repair_orders set status = 'completed', notes = $2, on_date = $3, odometer_km = coalesce($4, odometer_km), wof_result = $5 where id = $1 returning *`,
      [ro.id, notes, onDate, km, wofResult],
    );
    if (wofWrite) {
      await db.query(`update vehicles set wof_issued_on = $2 where id = $1`, [ro.vehicle_id, wofWrite]);
    }
    if (km != null) {
      await db.query(`update vehicles set odometer_km = greatest(coalesce(odometer_km, 0), $2) where id = $1`, [ro.vehicle_id, km]);
    }
    const [v] = await db.query(`select value_cents, customer, unit from v_ros where ro_id = $1`, [ro.id]);
    const r = plain({ ...row, value_cents: num(v.value_cents) });
    if (asJson) return console.log(JSON.stringify(r, null, 2));
    return console.log(`${ro.ref}: completed${wofResult ? ', WoF ' + wofResult + (wofResult === 'pass' ? ' (issue date on the vehicle)' : '') : ''}, ${money(v.value_cents)} on the sheet.${v.customer !== '(recon)' ? ` Invoice it: invoice build ${ro.ref}` : ' Recon lands in the unit cost, nobody gets a bill.'}`);
  }
  throw new CliError('Usage: ro book VEHICLE --tech= [--type=] [--on=] [--at=]  |  ro start REF  |  ro add REF ITEM [--qty=]  |  ro done REF --notes= [--result=pass|fail]');
};

commands['service-due'] = async (db) => {
  const rows = plainAll(await db.query(`select * from v_service_due order by days_since desc`));
  out(rows, [
    { key: 'ref', label: 'ref' },
    { key: 'unit', label: 'unit', width: 26 },
    { key: 'plate', label: 'plate' },
    { key: 'owner', label: 'owner' },
    { key: 'phone', label: 'phone' },
    { key: 'last_seen_on', label: 'last seen', format: isoDate },
    { key: 'days_since', label: 'days', align: 'right' },
    { key: 'state', label: 'state' },
  ]);
};

// ---- money ---------------------------------------------------------------

commands.invoice = async (db, args, flags) => {
  const sub = args[0];
  if (sub === 'build') {
    const ro = await resolveByRef(db, 'repair_orders', 'RO', args[1], 'repair order');
    if (ro.status !== 'completed') {
      throw new CliError(`${ro.ref} is still ${ro.status}. Complete it first (ro done ${ro.ref} --notes=...): the invoice bills the record, not the plan.`);
    }
    if (!ro.customer_id) throw new CliError(`${ro.ref} is internal recon: the cost lands on the unit, nobody gets a bill.`);
    const existing = await db.query(`select ref from invoices where ro_id = $1`, [ro.id]);
    if (existing.length) throw new CliError(`${ro.ref} is already invoiced (${existing[0].ref}).`);
    const [v] = await db.query(`select * from v_ros where ro_id = $1`, [ro.id]);
    if (!num(v.line_count)) throw new CliError(`${ro.ref} has no charge lines. Add what was done first: ro add ${ro.ref} ITEM`);
    const issued = today();
    const due = parseDate(flags.due, 'due date') || addDays(issued, 14);
    const ref = await nextRef(db, 'invoices', 'INV', 9001);
    const [row] = await db.query(
      `insert into invoices (ref, customer_id, ro_id, issued_on, due_on, total_cents) values ($1, $2, $3, $4, $5, $6) returning *`,
      [ref, ro.customer_id, ro.id, issued, due, num(v.value_cents)],
    );
    const r = plain({ ...row, customer: v.customer, unit: v.unit });
    if (asJson) return console.log(JSON.stringify(r, null, 2));
    return console.log(`${ref}: ${money(v.value_cents)} to ${v.customer} for ${v.unit} (${ro.ref}), due ${due}.`);
  }
  if (sub === 'paid') {
    const inv = await resolveByRef(db, 'invoices', 'INV', args[1], 'invoice');
    if (inv.status === 'paid') throw new CliError(`${inv.ref} is already paid.`);
    const on = parseDate(flags.on) || today();
    const [row] = await db.query(`update invoices set status = 'paid', paid_on = $2 where id = $1 returning *`, [inv.id, on]);
    if (asJson) return console.log(JSON.stringify(plain(row), null, 2));
    return console.log(`${inv.ref}: paid ${on}.`);
  }
  throw new CliError('Usage: invoice build RO-REF [--due=]  |  invoice paid REF [--on=]');
};

commands.invoices = async (db, args, flags) => {
  let where = `1=1`;
  if (flags.unpaid) where = `status = 'issued'`;
  else if (!flags.all) where = `status = 'issued' or issued_on >= current_date - 60`;
  const rows = plainAll(await db.query(`select * from v_invoices where ${where} order by issued_on desc`));
  out(rows, [
    { key: 'ref', label: 'ref' },
    { key: 'customer', label: 'customer' },
    { key: 'unit', label: 'unit', width: 22 },
    { key: 'issued_on', label: 'issued', format: isoDate },
    { key: 'due_on', label: 'due', format: isoDate },
    { key: 'total_cents', label: 'total', align: 'right', format: money },
    { key: 'state', label: 'state' },
  ]);
};

commands.debtors = async (db) => {
  const rows = plainAll(await db.query(
    `select customer, phone, count(*) as invoices, sum(total_cents)::bigint as owing_cents, max(days_overdue) as oldest_days
     from v_invoices where status = 'issued' and days_overdue > 0
     group by customer, phone order by max(days_overdue) desc`));
  out(rows, [
    { key: 'customer', label: 'customer' },
    { key: 'phone', label: 'phone' },
    { key: 'invoices', label: 'invoices', align: 'right' },
    { key: 'owing_cents', label: 'owing', align: 'right', format: money },
    { key: 'oldest_days', label: 'oldest', align: 'right', format: (v) => `${v}d` },
  ]);
};

commands.unbilled = async (db) => {
  const rows = plainAll(await db.query(
    `select ref, on_date, (current_date - on_date) as days_old, unit, customer, technician, value_cents
     from v_ros where state = 'unbilled' order by on_date`));
  out(rows, [
    { key: 'ref', label: 'ref' },
    { key: 'on_date', label: 'date', format: isoDate },
    { key: 'days_old', label: 'days', align: 'right' },
    { key: 'unit', label: 'unit', width: 24 },
    { key: 'customer', label: 'customer' },
    { key: 'technician', label: 'tech' },
    { key: 'value_cents', label: 'value', align: 'right', format: money },
  ]);
};

// ---- the shelf -----------------------------------------------------------

commands.parts = async (db, args, flags) => {
  if (args[0] === 'receive') {
    const item = await resolveItem(db, args[1]);
    if (!item.track_stock) throw new CliError(`${item.name} does not track stock (${item.kind}).`);
    const qty = parseQty(flags.qty);
    const [row] = await db.query(`update items set stock_qty = stock_qty + $2 where id = $1 returning *`, [item.id, qty]);
    const r = plain(row);
    if (asJson) return console.log(JSON.stringify(r, null, 2));
    return console.log(`${item.code}: +${qty} ${item.unit}, now ${row.stock_qty}.`);
  }
  const rows = plainAll(await db.query(
    `select * from v_parts ${flags.all ? '' : `where state <> 'ok'`} order by case state when 'OUT' then 0 when 'low' then 1 else 2 end, code`));
  out(rows, [
    { key: 'code', label: 'code' },
    { key: 'name', label: 'name', width: 30 },
    { key: 'stock_qty', label: 'on hand', align: 'right' },
    { key: 'unit', label: 'unit' },
    { key: 'reorder_at', label: 'reorder at', align: 'right' },
    { key: 'last_used_on', label: 'last used', format: isoDate },
    { key: 'state', label: 'state' },
  ]);
};

// ---- settings and notes ----------------------------------------------------

commands.settings = async (db, args) => {
  if (args[0] === 'set') {
    const key = str(args[1]);
    const value = args.slice(2).join(' ').trim();
    if (!key || !value) throw new CliError('Usage: settings set KEY VALUE');
    const existing = await db.query('select key from settings where key = $1', [key]);
    if (!existing.length) {
      const known = (await db.query('select key from settings order by key')).map((r) => r.key);
      throw new CliError(`No setting "${key}". Known: ${known.join(', ')}. A new setting starts life in a migration, not a typo.`);
    }
    await db.query(`update settings set value = $2, updated_at = now() where key = $1`, [key, value]);
    if (asJson) return console.log(JSON.stringify({ key, value }, null, 2));
    return console.log(`${key} = ${value}`);
  }
  const rows = plainAll(await db.query('select key, value, note from settings order by key'));
  out(rows, [
    { key: 'key', label: 'setting' },
    { key: 'value', label: 'value' },
    { key: 'note', label: 'note', width: 60 },
  ]);
};

commands.note = async (db, args, flags) => {
  if (args[0] !== 'add') throw new CliError('Usage: note add VEHICLE TEXT [--staff=]  |  note add --customer=NAME TEXT');
  let vehicleId = null;
  let customerId = null;
  let text;
  if (flags.customer) {
    const customer = await resolveCustomer(db, str(flags.customer));
    customerId = customer.id;
    text = args.slice(1).join(' ');
  } else {
    const vehicle = await resolveVehicle(db, args[1]);
    vehicleId = vehicle.id;
    customerId = vehicle.customer_id;
    text = args.slice(2).join(' ');
  }
  if (!text || !text.trim()) throw new CliError('What is the note? In a Disputes Tribunal hearing, this is the record.');
  let staffId = null;
  if (flags.staff) staffId = (await resolveStaff(db, str(flags.staff))).id;
  const [row] = await db.query(
    `insert into file_notes (vehicle_id, customer_id, staff_id, note) values ($1, $2, $3, $4) returning *`,
    [vehicleId, customerId, staffId, text.trim()],
  );
  if (asJson) return console.log(JSON.stringify(plain(row), null, 2));
  return console.log('Noted.');
};

commands.notes = async (db, args) => {
  const vehicle = await resolveVehicle(db, args[0]);
  const rows = plainAll(await db.query(
    `select fn.noted_on, s.name as staff, fn.note from file_notes fn left join staff s on s.id = fn.staff_id
     where fn.vehicle_id = $1 or ($2::uuid is not null and fn.customer_id = $2) order by fn.noted_on desc`, [vehicle.id, vehicle.customer_id]));
  out(rows, [
    { key: 'noted_on', label: 'date', format: isoDate },
    { key: 'staff', label: 'staff' },
    { key: 'note', label: 'note', width: 76 },
  ]);
};

// ---- attention -----------------------------------------------------------

commands.attention = async (db) => {
  const rows = plainAll(await db.query(
    `select rank, reason, label, who, place, days, detail from v_attention order by rank, days desc nulls last`));
  if (asJson) return console.log(JSON.stringify(rows, null, 2));
  if (!rows.length) return console.log('Nothing wants a decision. Enjoy it while it lasts.');
  console.log(heading(`Needs attention (${rows.length})`));
  for (const r of rows) {
    console.log(`\n  [${r.reason}] ${r.label}${r.who ? ' · ' + r.who : ''}${r.place ? ' · ' + r.place : ''}`);
    console.log(`    ${r.detail}`);
  }
};

// ---- compliance ----------------------------------------------------------

const RULES = [
  {
    key: 'cin',
    rule: 'Every used vehicle offered for sale carries a completed Consumer Information Notice',
    source: 'Consumer Information Standards (Used Motor Vehicles) Regulations 2008; Fair Trading Act 1986',
    sql: `select vv.ref as label, vv.unit || ', ' || (current_date - vv.acquired_on) || ' days on the lot, no CIN on record' as detail
          from v_vehicles vv where vv.kind = 'stock' and vv.status = 'in_stock' and vv.cin_completed_on is null and coalesce(vv.source, '') <> 'new'`,
  },
  {
    key: 'ppsr',
    rule: 'No vehicle is delivered without a PPSR search on record, and never with an uncleared security interest',
    source: 'Personal Property Securities Act 1999',
    sql: `select vv.ref as label, vv.unit || ' delivered to ' || coalesce(vv.owner, '?') || ' with ' || case when vv.ppsr_checked_on is null then 'no PPSR search on record' else 'a registered security interest never recorded as discharged' end as detail
          from v_vehicles vv where vv.kind = 'stock' and vv.status = 'sold' and (vv.ppsr_checked_on is null or vv.security_interest)`,
  },
  {
    key: 'wof',
    rule: 'Every used vehicle is delivered with a WoF issued inside the month, or a written as-is acknowledgment',
    source: 'Land Transport Rule: Vehicle Standards Compliance 2002',
    sql: `select d.ref as label, d.unit || ' delivered ' || to_char(d.delivered_on, 'YYYY-MM-DD') || ' with ' || case when d.wof_issued_on is null then 'no WoF on record' else 'a WoF issued ' || to_char(d.wof_issued_on, 'YYYY-MM-DD') || ', ' || (d.delivered_on - d.wof_issued_on) || ' days before delivery' end || ' and no as-is acknowledgment' as detail
          from v_deals d where d.status = 'delivered' and d.as_is_ack_on is null and (d.wof_issued_on is null or d.delivered_on - d.wof_issued_on > 30)`,
  },
  {
    key: 'inspector',
    rule: 'WoF inspections sit only under technicians whose inspector authorisation is current',
    source: 'Land Transport Rule: Vehicle Standards Compliance 2002 (vehicle inspector authorisation)',
    sql: `select r.ref as label, 'WoF on ' || r.unit || ' (' || r.state || ') under ' || r.technician || ', whose authorisation ' || case when s.inspector_expires_on is null then 'is not on record' else 'expired ' || to_char(s.inspector_expires_on, 'YYYY-MM-DD') end as detail
          from v_ros r join staff s on s.id = r.staff_id
          where r.type = 'wof' and r.status in ('booked', 'open') and (s.inspector_number is null or s.inspector_expires_on is null or s.inspector_expires_on < current_date)`,
  },
  {
    key: 'aml',
    rule: 'Cash at or over the reporting threshold settles only with customer due diligence on record',
    source: 'AML/CFT Act 2009 (motor vehicle dealers as high-value dealers)',
    sql: `select d.ref as label, d.unit || ' settled ' || '$' || to_char(d.sale_price_cents / 100.0, 'FM999,999,990') || ' in cash on ' || to_char(d.delivered_on, 'YYYY-MM-DD') || ' with no customer due diligence on record' as detail
          from v_deals d where d.status = 'delivered' and d.payment_method = 'cash' and d.cdd_completed_on is null
            and d.sale_price_cents >= (select cash_cdd_threshold_cents from v_settings)`,
  },
  {
    key: 'odometer',
    rule: 'Every stock unit carries an odometer reading on record',
    source: 'Fair Trading Act 1986; the CIN states the reading',
    sql: `select vv.ref as label, vv.unit || ', in stock ' || (current_date - vv.acquired_on) || ' days with no odometer reading' as detail
          from v_vehicles vv where vv.kind = 'stock' and vv.status = 'in_stock' and vv.odometer_km is null`,
  },
  {
    key: 'registration',
    rule: 'The motor vehicle trader registration is current',
    source: 'Motor Vehicle Sales Act 2003 s 10',
    sql: `select 'registration' as label, 'motor vehicle trader registration ' || case when (select mvt_registration_expires_on from v_settings) is null then 'is not on record (settings set mvt_registration_expires_on)' else 'expired ' || to_char((select mvt_registration_expires_on from v_settings), 'YYYY-MM-DD') end as detail
          where (select mvt_registration_expires_on from v_settings) is null or (select mvt_registration_expires_on from v_settings) < current_date`,
  },
  {
    key: 'records',
    rule: 'Every repair order is finished with work notes, the day the work happened',
    source: 'Consumer Guarantees Act 1993 (the record is the defence that the service was carried out with reasonable care and skill)',
    sql: `select r.ref as label, case when r.state = 'BOOKED PAST' then 'booked ' || to_char(r.on_date, 'YYYY-MM-DD') || ' and never resolved' when r.state = 'OPEN STALE' then 'opened ' || to_char(r.on_date, 'YYYY-MM-DD') || ' and never completed' else 'completed with no work notes' end as detail
          from v_ros r where r.state in ('BOOKED PAST', 'OPEN STALE', 'NO NOTES')`,
  },
  {
    key: 'retention',
    rule: 'Sales and workshop records are never deleted',
    source: 'Motor Vehicle Sales Act 2003 (records of transactions); Consumer Guarantees Act 1993',
    sql: `select null as label, null as detail where false`,
    note: 'Held by design: this CLI has no delete path. Vehicles sell, deals are lost with a reason on record, customers and staff become former, and invoices stay.',
  },
];

commands.compliance = async (db, args) => {
  const only = args[0] ? String(args[0]).toLowerCase() : null;
  const rules = only ? RULES.filter((r) => r.key === only) : RULES;
  if (!rules.length) throw new CliError(`No rule "${only}". Rules: ${RULES.map((r) => r.key).join(', ')}`);
  const results = [];
  for (const r of rules) {
    const breaches = plainAll(await db.query(r.sql));
    results.push({ key: r.key, rule: r.rule, source: r.source, note: r.note, breaches });
  }
  if (asJson) return console.log(JSON.stringify(results, null, 2));
  for (const r of results) {
    const state = r.breaches.length ? `${r.breaches.length} BREACH(ES)` : 'ok';
    console.log(`\n  [${r.key}] ${state}`);
    console.log(`    ${r.rule} (${r.source})`);
    if (r.note) console.log(`    ${r.note}`);
    for (const b of r.breaches) console.log(`      - ${b.label}: ${b.detail}`);
  }
  const total = results.reduce((s, r) => s + r.breaches.length, 0);
  console.log(`\n  ${results.length} rule(s), ${total} breach(es).`);
};

// ---- import / export -----------------------------------------------------

commands.import = async (db, args, flags) => {
  if (args[0] !== 'cdk') throw new CliError('Usage: import cdk --customers=FILE [--vehicles=FILE] [--dry-run]');
  const dry = !!flags['dry-run'];
  const report = { customers: 0, customers_updated: 0, vehicles: 0, vehicles_updated: 0, skips: [] };

  const readRows = (flag, label) => {
    const file = str(flags[flag]);
    if (!file) return null;
    if (!existsSync(file)) throw new CliError(`No ${label} file at ${file}.`);
    return parseCsv(readFileSync(file, 'utf8'));
  };

  const customerRows = readRows('customers', 'customers');
  const vehicleRows = readRows('vehicles', 'vehicles');
  if (!customerRows && !vehicleRows) throw new CliError('Nothing to import: give --customers= and/or --vehicles= (CDK CSV exports).');

  if (customerRows) {
    for (const row of customerRows) {
      const code = pick(row, 'Customer Number', 'Customer No', 'Cust No', 'Id');
      const first = pick(row, 'First Name', 'FirstName');
      const last = pick(row, 'Last Name', 'LastName', 'Surname');
      const name = pick(row, 'Name', 'Customer Name', 'Full Name') || [first, last].filter(Boolean).join(' ') || pick(row, 'Company', 'Company Name');
      if (!name) {
        report.skips.push(`customer row with no name (number ${code || '?'})`);
        continue;
      }
      const existing = await db.query(
        `select id from customers where (external_ref is not null and external_ref = $1) or lower(name) = lower($2)`,
        [code || `__none__`, name]);
      const fields = {
        phone: pick(row, 'Cell Phone', 'Mobile', 'Phone', 'Home Phone'),
        email: pick(row, 'Email', 'Email Address'),
        address: pick(row, 'Address', 'Address 1', 'Street'),
        suburb: pick(row, 'City', 'Suburb'),
      };
      if (existing.length) {
        report.customers_updated++;
        if (!dry) {
          await db.query(
            `update customers set phone = coalesce(nullif($2, ''), phone), email = coalesce(nullif($3, ''), email),
             address = coalesce(nullif($4, ''), address), suburb = coalesce(nullif($5, ''), suburb),
             external_ref = coalesce(external_ref, nullif($6, '')) where id = $1`,
            [existing[0].id, fields.phone, fields.email, fields.address, fields.suburb, code]);
        }
      } else {
        report.customers++;
        if (!dry) {
          await db.query(
            `insert into customers (name, phone, email, address, suburb, external_ref) values ($1, $2, $3, $4, $5, $6)`,
            [name, fields.phone || null, fields.email || null, fields.address || null, fields.suburb || null, code || null]);
        }
      }
    }
  }

  if (vehicleRows) {
    for (const row of vehicleRows) {
      const code = pick(row, 'Stock Number', 'Stock No', 'StockNo', 'Id');
      const make = pick(row, 'Make');
      const model = pick(row, 'Model');
      if (!make || !model) {
        report.skips.push(`vehicle row with no make/model (stock number ${code || '?'})`);
        continue;
      }
      const vin = pick(row, 'VIN', 'Vin');
      const fields = {
        year: pick(row, 'Year', 'Model Year'),
        km: pick(row, 'Odometer', 'Mileage', 'Kms', 'KM'),
        colour: pick(row, 'Color', 'Colour'),
        plate: pick(row, 'License Number', 'Plate', 'Registration', 'Rego'),
        cost: pick(row, 'Cost', 'Inventory Cost'),
        asking: pick(row, 'List Price', 'Price', 'Asking Price'),
        acquired: pick(row, 'Date In Stock', 'Stock Date', 'Purchase Date'),
      };
      const existing = await db.query(
        `select id from vehicles where (external_ref is not null and external_ref = $1) or (vin is not null and $2 <> '' and upper(vin) = upper($2))`,
        [code || '__none__', vin || '']);
      const km = fields.km ? parseKm(fields.km) : null;
      const acquired = fields.acquired ? parseDate(fields.acquired, 'date in stock') : null;
      if (existing.length) {
        report.vehicles_updated++;
        if (!dry) {
          await db.query(
            `update vehicles set odometer_km = coalesce($2, odometer_km), colour = coalesce(nullif($3, ''), colour),
             plate = coalesce(nullif($4, ''), plate), cost_cents = coalesce($5, cost_cents), asking_cents = coalesce($6, asking_cents),
             external_ref = coalesce(external_ref, nullif($7, '')) where id = $1`,
            [existing[0].id, km, fields.colour, fields.plate, parseMoney(fields.cost), parseMoney(fields.asking), code]);
        }
      } else {
        report.vehicles++;
        if (!dry) {
          const ref = await nextRef(db, 'vehicles', 'VH', 101);
          await db.query(
            `insert into vehicles (ref, kind, make, model, year, odometer_km, colour, vin, plate, acquired_on, cost_cents, asking_cents, external_ref)
             values ($1, 'stock', $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
            [ref, make, model, fields.year ? Math.round(Number(fields.year)) : null, km, fields.colour || null,
             vin || null, fields.plate || null, acquired || today(), parseMoney(fields.cost), parseMoney(fields.asking), code || null]);
        }
      }
    }
  }

  if (asJson) return console.log(JSON.stringify(report, null, 2));
  console.log(`${dry ? 'DRY RUN, nothing written. ' : ''}customers: ${report.customers} new, ${report.customers_updated} updated · vehicles: ${report.vehicles} new, ${report.vehicles_updated} updated`);
  if (report.skips.length) {
    console.log(`\n  ${report.skips.length} skip(s): the import is the first audit, each one is a question about the old data`);
    for (const s of report.skips) console.log(`  - ${s}`);
  }
  console.log('\nEvery imported unit arrives with no CIN and no PPSR on record, deliberately: the paper gets checked on the way in, not assumed. See docs/replace-cdk.md.');
};

commands.export = async (db, args, flags) => {
  const tables = ['settings', 'customers', 'staff', 'vehicles', 'deals', 'repair_orders', 'ro_lines', 'items', 'invoices', 'file_notes'];
  const dump = {};
  const counts = {};
  for (const t of tables) {
    dump[t] = plainAll(await db.query(`select * from ${t} order by ${t === 'settings' ? 'key' : 'created_at'}`));
    counts[t] = dump[t].length;
  }
  const outFile = str(flags.out) || path.join(REPO_ROOT, 'exports', `dealership-export-${today()}.json`);
  mkdirSync(path.dirname(outFile), { recursive: true });
  writeFileSync(outFile, JSON.stringify(dump, null, 2));
  if (asJson) return console.log(JSON.stringify({ file: outFile, counts }, null, 2));
  console.log(`Exported ${Object.values(counts).reduce((a, b) => a + b, 0)} rows to ${outFile}`);
  for (const [t, n] of Object.entries(counts)) console.log(`  ${t}: ${n}`);
};

// ---------------------------------------------------------------------------
// Main

const { args, flags } = parseArgv(process.argv.slice(2));
asJson = !!flags.json;
const cmd = args.shift() || 'help';

if (!commands[cmd]) {
  console.error(`Unknown command "${cmd}". Run: node scripts/dealer.mjs help`);
  process.exit(1);
}

if (cmd === 'help') {
  await commands.help();
  process.exit(0);
}

const db = await getDb();
try {
  await commands[cmd](db, args, flags);
} catch (err) {
  if (err instanceof CliError) {
    console.error(err.message);
    process.exitCode = err.code;
  } else {
    console.error(err.stack || String(err));
    process.exitCode = 1;
  }
} finally {
  await db.close();
}
