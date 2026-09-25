-- dealership-for-claude-code: core schema.
-- A New Zealand motor dealership's operating record the way CDK Global sells
-- it: the customers, the salespeople and technicians with their inspector
-- authorisations, the stock on the lot with its compliance paper (CIN, PPSR,
-- WoF), the deals from quote to delivery, the workshop repair orders, the
-- parts shelf, and the invoices.
--
-- Runs unchanged on PGlite (embedded) and on Postgres / Supabase.
-- Money is in cents, NZD. Odometers are kilometres.
--
-- Deliberately NOT here: the general ledger, payroll, OEM warranty claim
-- lodgement, finance company integrations. Those are connections and
-- accounting, not the operating record; the record of what was bought, sold,
-- repaired and charged lives here either way, and your accountant gets it
-- with one export.
--
-- The sharp edges are deliberate:
--   * a used vehicle does not take a deposit without a Consumer Information
--     Notice on record (Consumer Information Standards (Used Motor Vehicles)
--     Regulations 2008; Fair Trading Act 1986)
--   * a vehicle is not delivered without a PPSR check on record, and never
--     with an uncleared security interest (Personal Property Securities Act
--     1999)
--   * a used vehicle is delivered with a WoF issued inside the month, or a
--     written as-is acknowledgment on the record (Land Transport Rule:
--     Vehicle Standards Compliance 2002)
--   * a WoF inspection is booked and completed only under a technician whose
--     inspector authorisation is current on the day, and there is no force
--     flag (NZTA vehicle inspector authorisation under the same Rule)
--   * cash at or over the reporting threshold settles only with customer due
--     diligence on record (AML/CFT Act 2009: motor vehicle dealers are
--     high-value dealers)
--   * every unit carries an odometer reading: the CIN states it, and odometer
--     misstatement is the classic dealer prosecution (Fair Trading Act 1986)
--   * a repair order does not complete without work notes: the record is the
--     dealership's defence in a Consumer Guarantees Act dispute
--   * nothing is deleted: vehicles sell, deals are lost with a reason,
--     customers and staff become former

create or replace function set_updated_at() returns trigger
language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end
$$;

-- Settings ------------------------------------------------------------------------
-- The handful of numbers the rules and views read: the floorplan interest
-- rate, the motor vehicle trader registration expiry, the AML cash threshold,
-- the service-due and aged-stock windows. Change them with `settings set`.

create table if not exists settings (
  key         text primary key,
  value       text not null,
  note        text,
  updated_at  timestamptz not null default now()
);

-- Customers ------------------------------------------------------------------------
-- Buyers and workshop customers, one table. Every deal, repair order and
-- dollar owed traces to one of these.

create table if not exists customers (
  id            uuid primary key default gen_random_uuid(),
  name          text not null,
  phone         text,
  email         text,
  address       text,
  suburb        text,
  status        text not null default 'active',   -- active | former
  note          text,
  external_ref  text unique,                      -- the CDK customer number, for import
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create unique index if not exists customers_name_lower_idx on customers (lower(name));

-- Staff ---------------------------------------------------------------------------
-- Sales, technicians, the service advisor, the manager. The WoF inspector
-- authorisation dates live here because a WoF issued by a lapsed inspector is
-- the breach that costs the workshop its authority: the booking gate reads
-- these dates.

create table if not exists staff (
  id                     uuid primary key default gen_random_uuid(),
  name                   text not null,
  role                   text not null default 'sales',   -- sales | technician | service_advisor | manager
  employment             text not null default 'permanent',  -- permanent | part_time | contractor
  inspector_number       text,                            -- NZTA vehicle inspector ID, technicians only
  inspector_expires_on   date,                            -- inspector authorisation; the WoF gates read this
  phone                  text,
  email                  text,
  status                 text not null default 'active',  -- active | former
  note                   text,
  external_ref           text unique,
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now()
);
create unique index if not exists staff_name_lower_idx on staff (lower(name));

-- Vehicles ---------------------------------------------------------------------------
-- Stock units and customer cars, one table, told apart by kind. A stock unit
-- carries its cost, asking price and compliance paper (CIN, PPSR, WoF); a
-- customer car carries its owner. A sold unit stays on file with its buyer:
-- the service-due list is where the next decade of workshop revenue lives.

create table if not exists vehicles (
  id               uuid primary key default gen_random_uuid(),
  ref              text unique,                    -- VH-101
  kind             text not null default 'stock',  -- stock | customer
  customer_id      uuid references customers(id) on delete cascade,  -- owner, customer cars only
  vin              text unique,
  plate            text,
  make             text not null,
  model            text not null,
  year             int,
  odometer_km      int,                            -- blank is loud: the CIN states it (Fair Trading Act 1986)
  colour           text,
  source           text,                           -- trade_in | auction | import | private | new
  acquired_on      date,
  cost_cents       bigint,                         -- what the unit owes us, before recon
  asking_cents     bigint,
  floorplan        boolean not null default false, -- financed stock: days on the lot cost real interest
  cin_completed_on date,                           -- Consumer Information Notice; the deposit gate reads this
  ppsr_checked_on  date,                           -- PPSR search; the delivery gate reads this
  security_interest boolean,                       -- what the PPSR search found; true blocks delivery until cleared
  wof_issued_on    date,                           -- the delivery gate wants this inside 30 days
  as_is_ack_on     date,                           -- written as-is acknowledgment, the lawful alternative
  status           text not null default 'in_stock',  -- in_stock | sold (stock) | active (customer cars)
  note             text,
  external_ref     text unique,                    -- the CDK stock number, for import
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);
create index if not exists vehicles_customer_idx on vehicles (customer_id);

-- Deals ---------------------------------------------------------------------------
-- Quote, deposit, delivered, or lost with a reason. The compliance gates live
-- on the two transitions that matter: deposit (CIN on record) and delivery
-- (PPSR, WoF or as-is, and CDD on big cash). One vehicle carries one live
-- deal at a time; losing a deal frees the unit.

create table if not exists deals (
  id                       uuid primary key default gen_random_uuid(),
  ref                      text unique,            -- DL-5001
  vehicle_id               uuid not null references vehicles(id),
  customer_id              uuid not null references customers(id),
  staff_id                 uuid not null references staff(id),   -- the salesperson
  opened_on                date not null default current_date,
  sale_price_cents         bigint,
  deposit_cents            bigint,
  deposit_on               date,
  trade_in_desc            text,
  trade_in_allowance_cents bigint,
  payment_method           text,                   -- cash | finance | eft
  cdd_completed_on         date,                   -- AML/CFT customer due diligence; the cash gate reads this
  delivered_on             date,
  status                   text not null default 'quote',  -- quote | deposit | delivered | lost
  lost_reason              text,
  external_ref             text unique,
  created_at               timestamptz not null default now(),
  updated_at               timestamptz not null default now()
);
create index if not exists deals_vehicle_idx on deals (vehicle_id);
create index if not exists deals_customer_idx on deals (customer_id);

-- Repair orders ---------------------------------------------------------------------------
-- The workshop. Customer work and internal recon on stock units share the
-- table; recon has no customer and never appears in the unbilled list, it
-- lands in the unit's true cost instead. A WoF repair order carries its
-- result, and only a currently authorised inspector holds one.

create table if not exists repair_orders (
  id           uuid primary key default gen_random_uuid(),
  ref          text unique,                      -- RO-7001
  vehicle_id   uuid not null references vehicles(id),
  customer_id  uuid references customers(id),    -- null = internal recon on a stock unit
  staff_id     uuid not null references staff(id),   -- the technician
  on_date      date not null default current_date,
  promised_at  time,
  type         text not null default 'service',  -- service | repair | wof | recon | accessory
  reason       text,
  odometer_km  int,                              -- reading at the door; the service history depends on it
  notes        text,                             -- required to complete; the CGA defence
  wof_result   text,                             -- pass | fail, wof type only
  status       text not null default 'booked',   -- booked | open | completed
  external_ref text unique,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create index if not exists repair_orders_vehicle_idx on repair_orders (vehicle_id);
create index if not exists repair_orders_staff_idx on repair_orders (staff_id);
create index if not exists repair_orders_on_idx on repair_orders (on_date);

-- Items ---------------------------------------------------------------------------
-- Labour lines and parts. Parts track the shelf with a reorder point.

create table if not exists items (
  id           uuid primary key default gen_random_uuid(),
  code         text not null unique,            -- LAB-STD, PAD-F
  name         text not null,
  kind         text not null default 'part',    -- labour | part
  unit         text not null default 'each',    -- each | hour | litre
  price_cents  bigint not null,
  cost_cents   bigint,
  track_stock  boolean not null default false,
  stock_qty    numeric not null default 0,
  reorder_at   numeric,
  note         text,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

-- Repair order lines ---------------------------------------------------------------------------
-- Labour and parts, priced. Parts decrement the shelf on the way out and the
-- CLI refuses to hand over more than the shelf holds.

create table if not exists ro_lines (
  id                uuid primary key default gen_random_uuid(),
  ro_id             uuid not null references repair_orders(id) on delete cascade,
  item_id           uuid not null references items(id),
  qty               numeric not null default 1,
  unit_price_cents  bigint not null,
  note              text,
  created_at        timestamptz not null default now()
);

-- Invoices ---------------------------------------------------------------------------
-- One invoice per completed customer repair order. Vehicle sales settle on
-- the deal itself; recon never invoices anybody. Nothing here connects to a
-- bank: `invoice paid` records what the bank statement shows.

create table if not exists invoices (
  id           uuid primary key default gen_random_uuid(),
  ref          text unique,                     -- INV-9001
  customer_id  uuid not null references customers(id) on delete cascade,
  ro_id        uuid unique references repair_orders(id) on delete set null,
  issued_on    date not null default current_date,
  due_on       date not null,
  total_cents  bigint not null,
  status       text not null default 'issued',  -- issued | paid | written_off
  paid_on      date,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create index if not exists invoices_customer_idx on invoices (customer_id);

-- File notes ---------------------------------------------------------------------------
-- Calls, promises to pay, the deal that nearly happened. In a Disputes
-- Tribunal hearing, the record.

create table if not exists file_notes (
  id           uuid primary key default gen_random_uuid(),
  vehicle_id   uuid references vehicles(id) on delete cascade,
  customer_id  uuid references customers(id) on delete cascade,
  staff_id     uuid references staff(id) on delete set null,
  noted_on     date not null default current_date,
  note         text not null,
  created_at   timestamptz not null default now()
);
create index if not exists file_notes_vehicle_idx on file_notes (vehicle_id);

-- updated_at triggers ------------------------------------------------------------------

do $$
declare t text;
begin
  foreach t in array array['customers','staff','vehicles','deals','repair_orders','items','invoices']
  loop
    execute format('drop trigger if exists %I on %I', t || '_updated_at', t);
    execute format('create trigger %I before update on %I for each row execute function set_updated_at()', t || '_updated_at', t);
  end loop;
end
$$;

-- =====================================================================================
-- Views: the questions a dealer principal asks every Monday, as SQL anyone can read.
-- =====================================================================================

-- One settings read, typed.
create or replace view v_settings as
select
  coalesce((select value::numeric from settings where key = 'floorplan_rate_pct'), 0) as floorplan_rate_pct,
  (select value::date from settings where key = 'mvt_registration_expires_on') as mvt_registration_expires_on,
  coalesce((select value::bigint from settings where key = 'cash_cdd_threshold_cents'), 1000000) as cash_cdd_threshold_cents,
  coalesce((select value::int from settings where key = 'service_due_days'), 180) as service_due_days,
  coalesce((select value::int from settings where key = 'aged_days'), 90) as aged_days;

-- Staff with the inspector authorisation state loud and the load visible.
create or replace view v_staff as
select
  s.id as staff_id,
  s.name,
  s.role,
  s.employment,
  s.inspector_number,
  s.inspector_expires_on,
  (s.inspector_expires_on - current_date) as inspector_days_left,
  case
    when s.role <> 'technician' then ''
    when s.inspector_number is null then ''
    when s.inspector_expires_on is null then 'NONE'
    when s.inspector_expires_on < current_date then 'EXPIRED'
    when s.inspector_expires_on <= current_date + 30 then 'expiring'
    else 'current'
  end as inspector,
  s.status,
  (select count(*) from repair_orders r where r.staff_id = s.id and r.status in ('booked', 'open') and r.type = 'wof') as wof_bookings,
  (select count(*) from repair_orders r where r.staff_id = s.id and r.status in ('booked', 'open')) as ros_open,
  (select count(*) from deals d where d.staff_id = s.id and d.status = 'delivered' and d.delivered_on >= current_date - 28) as delivered_28d,
  (select count(*) from deals d where d.staff_id = s.id and d.status in ('quote', 'deposit')) as deals_open
from staff s;

-- The lot. Days in stock, the recon spent on the unit, the floorplan interest
-- it has quietly cost so far, and the compliance paper on one line.
create or replace view v_vehicles as
select
  v.id as vehicle_id,
  v.ref,
  v.kind,
  v.vin,
  v.plate,
  v.make,
  v.model,
  v.year,
  (v.make || ' ' || v.model || case when v.year is not null then ' ' || v.year else '' end) as unit,
  v.odometer_km,
  v.source,
  v.acquired_on,
  v.cost_cents,
  v.asking_cents,
  v.floorplan,
  v.cin_completed_on,
  v.ppsr_checked_on,
  v.security_interest,
  v.wof_issued_on,
  v.as_is_ack_on,
  v.status,
  v.customer_id,
  coalesce(c.name, (select c2.name from deals d join customers c2 on c2.id = d.customer_id
                    where d.vehicle_id = v.id and d.status = 'delivered' order by d.delivered_on desc limit 1)) as owner,
  (select d.ref from deals d where d.vehicle_id = v.id and d.status in ('quote', 'deposit') limit 1) as live_deal,
  case when v.kind = 'stock' then
    coalesce((select d.delivered_on from deals d where d.vehicle_id = v.id and d.status = 'delivered' order by d.delivered_on desc limit 1), current_date) - v.acquired_on
  end as days_in_stock,
  (select coalesce(sum(l.qty * l.unit_price_cents), 0)::bigint from repair_orders r join ro_lines l on l.ro_id = r.id
    where r.vehicle_id = v.id and r.customer_id is null) as recon_cents,
  case when v.floorplan and v.status = 'in_stock' and v.cost_cents is not null then
    round(v.cost_cents * (select floorplan_rate_pct from v_settings) / 100.0 * (current_date - v.acquired_on) / 365.0)::bigint
  else 0 end as floorplan_interest_cents,
  case
    when v.kind = 'customer' then ''
    when v.status = 'sold' then 'sold'
    when v.odometer_km is null then 'NO ODOMETER'
    when v.cin_completed_on is null then 'NO CIN'
    when v.status = 'in_stock' and (current_date - v.acquired_on) >= (select aged_days from v_settings) then 'AGED ' || (current_date - v.acquired_on) || 'd'
    when exists (select 1 from deals d where d.vehicle_id = v.id and d.status = 'deposit') then 'deposit held'
    when exists (select 1 from deals d where d.vehicle_id = v.id and d.status = 'quote') then 'quoted'
    else 'for sale'
  end as state
from vehicles v
left join customers c on c.id = v.customer_id;

-- The deals board with the money worked out. Gross on a delivered deal is the
-- sale price less what the unit owed us less the recon we spent on it: the
-- number CDK spreads across three modules.
create or replace view v_deals as
select
  d.id as deal_id,
  d.ref,
  v.ref as vehicle_ref,
  vv.unit,
  vv.days_in_stock,
  c.name as customer,
  c.id as customer_id,
  c.phone,
  s.name as salesperson,
  s.id as staff_id,
  d.opened_on,
  d.sale_price_cents,
  d.deposit_cents,
  d.deposit_on,
  d.trade_in_desc,
  d.trade_in_allowance_cents,
  d.payment_method,
  d.cdd_completed_on,
  d.delivered_on,
  d.status,
  d.lost_reason,
  v.id as vehicle_id,
  v.cin_completed_on,
  v.ppsr_checked_on,
  v.security_interest,
  v.wof_issued_on,
  v.as_is_ack_on,
  case when d.status = 'delivered' and d.sale_price_cents is not null and v.cost_cents is not null then
    (d.sale_price_cents - v.cost_cents - (select coalesce(sum(l.qty * l.unit_price_cents), 0)::bigint
      from repair_orders r join ro_lines l on l.ro_id = r.id where r.vehicle_id = v.id and r.customer_id is null))
  end as gross_cents,
  case
    when d.status = 'lost' then 'lost'
    when d.status = 'delivered' then 'delivered'
    when d.status = 'deposit' and d.deposit_on < current_date - 14 then 'DEPOSIT STALE'
    when d.status = 'deposit' then 'deposit'
    else 'quote'
  end as state
from deals d
join vehicles v on v.id = d.vehicle_id
join v_vehicles vv on vv.vehicle_id = v.id
join customers c on c.id = d.customer_id
join staff s on s.id = d.staff_id;

-- The workshop with the story on one line. A booked repair order whose day
-- has passed is loud: the customer either came or they did not, and the
-- record should say which.
create or replace view v_ros as
select
  r.id as ro_id,
  r.ref,
  v.ref as vehicle_ref,
  vv.unit,
  v.plate,
  coalesce(c.name, '(recon)') as customer,
  r.customer_id,
  s.name as technician,
  s.id as staff_id,
  r.on_date,
  r.promised_at,
  r.type,
  r.reason,
  r.odometer_km,
  r.notes,
  r.wof_result,
  r.status,
  r.vehicle_id,
  (select coalesce(sum(l.qty * l.unit_price_cents), 0)::bigint from ro_lines l where l.ro_id = r.id) as value_cents,
  (select count(*) from ro_lines l where l.ro_id = r.id) as line_count,
  exists (select 1 from invoices i where i.ro_id = r.id) as invoiced,
  case
    when r.status = 'booked' and r.on_date < current_date then 'BOOKED PAST'
    when r.status = 'booked' then 'booked'
    when r.status = 'open' and r.on_date < current_date then 'OPEN STALE'
    when r.status = 'open' then 'open'
    when r.status = 'completed' and (r.notes is null or r.notes = '') then 'NO NOTES'
    when exists (select 1 from invoices i where i.ro_id = r.id) then 'billed'
    when r.customer_id is not null and (select count(*) from ro_lines l where l.ro_id = r.id) > 0 then 'unbilled'
    else 'completed'
  end as state
from repair_orders r
join vehicles v on v.id = r.vehicle_id
join v_vehicles vv on vv.vehicle_id = v.id
join staff s on s.id = r.staff_id
left join customers c on c.id = r.customer_id;

-- Invoices with the age of the money.
create or replace view v_invoices as
select
  i.id as invoice_id,
  i.ref,
  c.name as customer,
  c.id as customer_id,
  c.phone,
  r.ref as ro_ref,
  (select vv.unit from v_vehicles vv where vv.vehicle_id = r.vehicle_id) as unit,
  i.issued_on,
  i.due_on,
  (current_date - i.due_on) as days_overdue,
  i.total_cents,
  i.status,
  i.paid_on,
  case
    when i.status = 'paid' then 'paid'
    when i.status = 'written_off' then 'written off'
    when i.due_on < current_date - 60 then 'OVERDUE 60+'
    when i.due_on < current_date - 30 then 'OVERDUE 30+'
    when i.due_on < current_date then 'overdue'
    else 'issued'
  end as state
from invoices i
join customers c on c.id = i.customer_id
left join repair_orders r on r.id = i.ro_id;

-- The parts shelf with the state loud.
create or replace view v_parts as
select
  it.id as item_id,
  it.code,
  it.name,
  it.unit,
  it.price_cents,
  it.stock_qty,
  it.reorder_at,
  (select max(r.on_date) from repair_orders r join ro_lines l on l.ro_id = r.id where l.item_id = it.id) as last_used_on,
  case
    when it.stock_qty <= 0 then 'OUT'
    when it.reorder_at is not null and it.stock_qty <= it.reorder_at then 'low'
    else 'ok'
  end as state
from items it
where it.track_stock;

-- The service-due list: every car this dealership has sold or serviced,
-- ranked by how long since we last saw it, with nothing booked. This is the
-- retention engine, and it is the list CDK's CRM add-on charges for.
create or replace view v_service_due as
select
  vv.vehicle_id,
  vv.ref,
  vv.unit,
  vv.plate,
  vv.owner,
  (select c.phone from customers c where c.name = vv.owner) as phone,
  last_seen.on_date as last_seen_on,
  (current_date - last_seen.on_date) as days_since,
  case
    when (current_date - last_seen.on_date) >= 2 * (select service_due_days from v_settings) then 'LONG OVERDUE'
    else 'due'
  end as state
from v_vehicles vv
join lateral (
  select max(d) as on_date from (
    select max(r.on_date) as d from repair_orders r where r.vehicle_id = vv.vehicle_id and r.status = 'completed'
    union all
    select max(dl.delivered_on) from deals dl where dl.vehicle_id = vv.vehicle_id and dl.status = 'delivered'
  ) x where d is not null
) last_seen on true
where vv.owner is not null
  and last_seen.on_date < current_date - (select service_due_days from v_settings)
  and not exists (select 1 from repair_orders r where r.vehicle_id = vv.vehicle_id and r.status in ('booked', 'open'));

-- Everything that wants a decision, one union, worst first. A delivered
-- vehicle with no PPSR check outranks everything: if there is money owing on
-- that unit, the finance company can take it off your customer's driveway.
create or replace view v_attention as
-- A vehicle went out the door with no PPSR check on record.
select 1 as rank, 'ppsr_missing' as reason, vv.ref as label, vv.unit as who, vv.owner as place,
       (current_date - (select max(d.delivered_on) from deals d where d.vehicle_id = vv.vehicle_id and d.status = 'delivered'))::int as days,
       'delivered with no PPSR check on record: if money is owing on this unit the security follows the car, not you. Run the search today and clear anything registered (Personal Property Securities Act 1999)' as detail
from v_vehicles vv
where vv.kind = 'stock' and vv.status = 'sold' and vv.ppsr_checked_on is null
union all
-- A used unit offered for sale with no CIN.
select 2, 'cin_missing', vv.ref, vv.unit, vv.source,
       (current_date - vv.acquired_on)::int,
       case when vv.odometer_km is null then 'no odometer reading and ' else '' end ||
       'no Consumer Information Notice on record after ' || (current_date - vv.acquired_on) ||
       ' days on the lot: offering a used vehicle without a displayed CIN is an offence (Consumer Information Standards (Used Motor Vehicles) Regulations 2008). Record it before anyone is shown the car'
from v_vehicles vv
where vv.kind = 'stock' and vv.status = 'in_stock' and vv.cin_completed_on is null
union all
-- WoF work sitting under a lapsed inspector.
select 3, 'inspector_expired', s.name, '', 'holds ' || s.wof_bookings || ' WoF booking(s)',
       abs(coalesce(s.inspector_days_left, 0))::int,
       'inspector authorisation ' || case when s.inspector_expires_on is null then 'NOT ON RECORD'
         else 'expired ' || to_char(s.inspector_expires_on, 'YYYY-MM-DD') end ||
       ' and WoF work is still booked under them: reassign it today, a WoF issued by a lapsed inspector puts the workshop''s inspecting authority on the line (Land Transport Rule: Vehicle Standards Compliance 2002)'
from v_staff s
where s.role = 'technician' and s.status = 'active' and s.inspector in ('EXPIRED', 'NONE') and s.wof_bookings > 0
union all
-- The trader registration is expiring or expired.
select case when (select mvt_registration_expires_on from v_settings) < current_date then 1 else 4 end,
       'registration', 'motor vehicle trader registration', '', '',
       abs((select mvt_registration_expires_on from v_settings) - current_date)::int,
       'motor vehicle trader registration ' ||
       case when (select mvt_registration_expires_on from v_settings) < current_date
         then 'EXPIRED ' || to_char((select mvt_registration_expires_on from v_settings), 'YYYY-MM-DD') || ': trading unregistered is an offence, renew before another vehicle is offered'
         else 'expires ' || to_char((select mvt_registration_expires_on from v_settings), 'YYYY-MM-DD') || ' (' || ((select mvt_registration_expires_on from v_settings) - current_date) || ' days): renew with the Registrar now' end ||
       ' (Motor Vehicle Sales Act 2003)'
where (select mvt_registration_expires_on from v_settings) is not null
  and (select mvt_registration_expires_on from v_settings) <= current_date + 30
union all
-- A repair order whose day has passed with no story.
select 5, 'ro_unresolved', r.ref, r.unit, r.technician,
       (current_date - r.on_date)::int,
       case when r.state = 'BOOKED PAST'
         then 'booked ' || to_char(r.on_date, 'YYYY-MM-DD') || ' and never started, completed or rebooked: did the customer come?'
         else 'opened ' || to_char(r.on_date, 'YYYY-MM-DD') || ' and never completed: finish the notes while ' || r.technician || ' still remembers the job' end
from v_ros r
where r.state in ('BOOKED PAST', 'OPEN STALE')
union all
-- Finished customer work nobody invoiced.
select 6, 'unbilled', r.ref, r.unit, r.customer,
       (current_date - r.on_date)::int,
       '$' || to_char(r.value_cents / 100.0, 'FM999,999,990') || ' of completed work with no invoice, ' ||
       (current_date - r.on_date) || ' days old: build it before it becomes a write-off'
from v_ros r
where r.state = 'unbilled'
union all
-- A deposit going cold.
select 7, 'deposit_stale', d.ref, d.unit, d.customer,
       (current_date - d.deposit_on)::int,
       'deposit taken ' || to_char(d.deposit_on, 'YYYY-MM-DD') || ' (' || (current_date - d.deposit_on) ||
       ' days ago) and the unit still has not delivered: finance falling over, paper missing, or cold feet. Ring ' || d.customer || ' today'
from v_deals d
where d.state = 'DEPOSIT STALE'
union all
-- Aged stock quietly eating its margin.
select 8, 'aged_stock', vv.ref, vv.unit, vv.source,
       vv.days_in_stock::int,
       vv.days_in_stock || ' days on the lot' ||
       case when vv.floorplan_interest_cents > 0 then ', $' || to_char(vv.floorplan_interest_cents / 100.0, 'FM999,999,990') || ' of floorplan interest so far' else '' end ||
       ': every week it sits costs real margin. Price it to move or send it to auction'
from v_vehicles vv
where vv.kind = 'stock' and vv.status = 'in_stock' and vv.days_in_stock >= (select aged_days from v_settings)
union all
-- Money past 30 days.
select 9, 'debtor', i.customer, '', count(*) || ' invoice(s)',
       max(i.days_overdue)::int,
       '$' || to_char(sum(i.total_cents) / 100.0, 'FM999,999,990') || ' outstanding, oldest ' || max(i.days_overdue) ||
       ' days past due: ring before it ages another bucket'
from v_invoices i
where i.state in ('OVERDUE 30+', 'OVERDUE 60+')
group by i.customer
union all
-- Parts at or under the reorder point.
select 10, 'parts_low', p.code, p.name, '',
       null::int,
       p.stock_qty || ' on hand, reorder point ' || coalesce(p.reorder_at::text, '?') || ': order it before a job waits on it'
from v_parts p
where p.state in ('low', 'OUT')
union all
-- An inspector authorisation inside 30 days.
select 11, 'inspector_expiring', s.name, '', s.role,
       s.inspector_days_left::int,
       'inspector authorisation expires ' || to_char(s.inspector_expires_on, 'YYYY-MM-DD') ||
       ' (' || s.inspector_days_left || ' days): renew with NZTA now, the WoF gate will refuse the day it lapses'
from v_staff s
where s.role = 'technician' and s.status = 'active' and s.inspector = 'expiring'
union all
-- A unit with no odometer on record.
select 12, 'odometer_missing', vv.ref, vv.unit, vv.source,
       (current_date - vv.acquired_on)::int,
       'no odometer reading on record: the CIN must state it and odometer misstatement is the classic dealer prosecution (Fair Trading Act 1986). Read the dash today'
from v_vehicles vv
where vv.kind = 'stock' and vv.status = 'in_stock' and vv.odometer_km is null
union all
-- A car this dealership sold or serviced, gone quiet.
select 13, 'service_due', sd.ref, sd.unit, sd.owner,
       sd.days_since::int,
       'not seen for ' || sd.days_since || ' days, nothing booked: one call books the service and keeps the next trade-in in the family'
from v_service_due sd;
