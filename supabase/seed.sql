-- Demo data for dealership-for-claude-code.
-- Harbour City Motors, a fictional Petone used-vehicle dealership with a
-- workshop: eight customers, seven staff, eleven vehicles (stock and customer
-- cars), five deals, ten repair orders, a parts shelf and three invoices.
--
-- Deliberately messy, so the attention list has something to say:
--   the Navara was delivered with no PPSR check on record, $31,000 in cash, no CDD, and a 45-day-old WoF
--   three units on the lot have no Consumer Information Notice, one of them 95 days in
--   Steve Kovac's inspector authorisation expired 9 days ago and he still holds two WoF bookings
--   the motor vehicle trader registration expires in 20 days
--   the Corolla has no odometer reading on record
--   Marisol Reyes's deposit on the Swift is 20 days old and the unit has not delivered
--   the Hilux has sat 145 days on floorplan; the Commodore 95
--   $389 of completed workshop work was never invoiced
--   Callum Frost's invoice is 56 days past due
--   one repair order was booked five days ago and nobody recorded what happened
--   one pre-delivery check has sat open for six days
--   front brake pads are at 2 with a reorder point of 4; batteries are out
--   the Outlander sold 200 days ago and Tina Woods's CR-V was last seen 260 days ago: neither has been back
--
-- Dates are relative to current_date. Ids are derived from names with
-- seed_uuid, and every insert is ON CONFLICT DO NOTHING, so running it twice
-- changes nothing.
--
-- Customers, staff, vehicles, prices and events are DEMO VALUES for a
-- fictional dealership. No real person, business or vehicle is depicted.
-- VINs are placeholders, not valid check-digit VINs.

create or replace function seed_uuid(seed text) returns uuid language sql immutable as $$
  select (substr(m, 1, 8) || '-' || substr(m, 9, 4) || '-4' || substr(m, 13, 3)
          || '-8' || substr(m, 16, 3) || '-' || substr(m, 19, 12))::uuid
  from (select md5(seed) as m) s
$$;

-- Settings ------------------------------------------------------------------------

insert into settings (key, value, note) values
  ('floorplan_rate_pct', '9.5', 'annual floorplan interest rate, percent'),
  ('mvt_registration_expires_on', (current_date + 20)::text, 'motor vehicle trader registration expiry (Motor Vehicle Sales Act 2003)'),
  ('cash_cdd_threshold_cents', '1000000', 'AML/CFT cash threshold: NZD 10,000 (AML/CFT Act 2009, high-value dealers)'),
  ('service_due_days', '180', 'days since last visit before a car is service-due'),
  ('aged_days', '90', 'days in stock before a unit counts as aged')
on conflict do nothing;

-- Customers ------------------------------------------------------------------------

insert into customers (id, name, phone, email, address, suburb, status) values
  (seed_uuid('cust:opara'),  'Hemi Opara',     '021 555 0301', 'hemi.opara@example.nz',   '12 Britannia Street',  'Petone',        'active'),
  (seed_uuid('cust:reyes'),  'Marisol Reyes',  '021 555 0302', 'm.reyes@example.nz',      '45 Jackson Street',    'Petone',        'active'),
  (seed_uuid('cust:frost'),  'Callum Frost',   '021 555 0303', 'c.frost@example.nz',      '8 Wilford Road',       'Moera',         'active'),
  (seed_uuid('cust:woods'),  'Tina Woods',     '021 555 0304', 'tina.woods@example.nz',   '102 Waione Street',    'Petone',        'active'),
  (seed_uuid('cust:sharma'), 'Priya Sharma',   '021 555 0305', 'p.sharma@example.nz',     '31 Randwick Road',     'Moera',         'active'),
  (seed_uuid('cust:tanner'), 'Mike Tanner',    '021 555 0306', 'mike.tanner@example.nz',  '77 Hutt Road',         'Alicetown',     'active'),
  (seed_uuid('cust:hale'),   'Ruth Hale',      '021 555 0307', 'ruth.hale@example.nz',    '5 Marine Parade',      'Eastbourne',    'active'),
  (seed_uuid('cust:booth'),  'Gary Booth',     '021 555 0308', 'g.booth@example.nz',      '19 High Street',       'Lower Hutt',    'former')
on conflict do nothing;

-- Staff ---------------------------------------------------------------------------
-- Steve Kovac's inspector authorisation expired 9 days ago and he still holds
-- two WoF bookings: that is the breach the attention list exists to shout
-- about. Dev Patel's is current for most of a year.

insert into staff (id, name, role, employment, inspector_number, inspector_expires_on, phone, email, status) values
  (seed_uuid('staff:priest'), 'Dana Priest',  'manager',         'permanent', null,      null,               '021 555 0401', 'dana@harbourcitymotors.example.nz',   'active'),
  (seed_uuid('staff:bell'),   'Marcus Bell',  'sales',           'permanent', null,      null,               '021 555 0402', 'marcus@harbourcitymotors.example.nz', 'active'),
  (seed_uuid('staff:ngata'),  'Aroha Ngata',  'sales',           'permanent', null,      null,               '021 555 0403', 'aroha@harbourcitymotors.example.nz',  'active'),
  (seed_uuid('staff:patel'),  'Dev Patel',    'technician',      'permanent', 'VI-4471', current_date + 320, '021 555 0404', 'dev@harbourcitymotors.example.nz',    'active'),
  (seed_uuid('staff:kovac'),  'Steve Kovac',  'technician',      'permanent', 'VI-3082', current_date - 9,   '021 555 0405', 'steve@harbourcitymotors.example.nz',  'active'),
  (seed_uuid('staff:reid'),   'Joan Reid',    'service_advisor', 'permanent', null,      null,               '021 555 0406', 'joan@harbourcitymotors.example.nz',   'active'),
  (seed_uuid('staff:gray'),   'Tom Gray',     'sales',           'permanent', null,      null,               '021 555 0407', 'tom.gray@example.nz',                 'former')
on conflict do nothing;

-- Vehicles ---------------------------------------------------------------------------
-- The lot, plus the customer cars the workshop looks after. The Commodore,
-- Corolla and Demio have no CIN; the Corolla has no odometer either. The
-- Navara went out the door with no PPSR check. The Hilux has sat 145 days on
-- floorplan money.

insert into vehicles (id, ref, kind, customer_id, vin, plate, make, model, year, odometer_km, colour, source, acquired_on, cost_cents, asking_cents, floorplan, cin_completed_on, ppsr_checked_on, security_interest, wof_issued_on, status) values
  -- stock
  (seed_uuid('vh:outlander'), 'VH-101', 'stock', null, 'DEMO00000000101', 'MRK482', 'Mitsubishi', 'Outlander', 2019, 68400,  'silver', 'trade_in', current_date - 240, 1980000, 2450000, false, current_date - 230, current_date - 214, false, current_date - 210, 'sold'),
  (seed_uuid('vh:hilux'),     'VH-102', 'stock', null, 'DEMO00000000102', 'KWT903', 'Toyota',     'Hilux',     2017, 148200, 'white',  'auction',  current_date - 145, 2280000, 2890000, true,  current_date - 138, current_date - 140, false, current_date - 25,  'in_stock'),
  (seed_uuid('vh:swift'),     'VH-103', 'stock', null, 'DEMO00000000103', 'PDQ217', 'Suzuki',     'Swift',     2020, 41200,  'red',    'trade_in', current_date - 30,  1420000, 1799000, false, current_date - 27,  current_date - 26,  false, current_date - 45,  'in_stock'),
  (seed_uuid('vh:commodore'), 'VH-104', 'stock', null, 'DEMO00000000104', 'HGB664', 'Holden',     'Commodore', 2016, 112900, 'black',  'auction',  current_date - 95,  1450000, 1899000, true,  null,               current_date - 90,  false, current_date - 80,  'in_stock'),
  (seed_uuid('vh:corolla'),   'VH-105', 'stock', null, 'DEMO00000000105', 'QRS330', 'Toyota',     'Corolla',   2021, null,   'blue',   'import',   current_date - 12,  2150000, 2650000, false, null,               null,               null,  null,               'in_stock'),
  (seed_uuid('vh:navara'),    'VH-106', 'stock', null, 'DEMO00000000106', 'LTN518', 'Nissan',     'Navara',    2018, 96700,  'grey',   'auction',  current_date - 75,  2650000, 3190000, false, current_date - 70,  null,               null,  current_date - 65,  'sold'),
  (seed_uuid('vh:mazda3'),    'VH-107', 'stock', null, 'DEMO00000000107', 'JCF209', 'Mazda',      '3',         2019, 55300,  'white',  'trade_in', current_date - 60,  1680000, 2090000, false, current_date - 55,  current_date - 54,  false, current_date - 50,  'in_stock'),
  (seed_uuid('vh:demio'),     'VH-108', 'stock', null, 'DEMO00000000108', 'GHY771', 'Mazda',      'Demio',     2015, 89100,  'silver', 'trade_in', current_date - 8,   520000,  899000,  false, null,               current_date - 6,   false, null,               'in_stock'),
  -- customer cars
  (seed_uuid('vh:woods-crv'),    'VH-201', 'customer', seed_uuid('cust:woods'),  'DEMO00000000201', 'FTR882', 'Honda',      'CR-V',   2015, 132000, 'blue',  null, null, null, null, false, null, null, null, null, 'active'),
  (seed_uuid('vh:tanner-ranger'),'VH-202', 'customer', seed_uuid('cust:tanner'), 'DEMO00000000202', 'NBV417', 'Ford',       'Ranger', 2018, 104500, 'black', null, null, null, null, false, null, null, null, null, 'active'),
  (seed_uuid('vh:frost-golf'),   'VH-203', 'customer', seed_uuid('cust:frost'),  'DEMO00000000203', 'EJP665', 'Volkswagen', 'Golf',   2014, 118300, 'white', null, null, null, null, false, null, null, null, null, 'active')
on conflict do nothing;

-- Deals ---------------------------------------------------------------------------
-- The Outlander delivery is what clean looks like. The Navara delivery is
-- what the gates exist to stop: no PPSR check, a 45-day-old WoF, and $31,000
-- of cash with no customer due diligence on record (it was keyed into the
-- old system, which never asked). Reyes's deposit on the Swift is going cold.

insert into deals (id, ref, vehicle_id, customer_id, staff_id, opened_on, sale_price_cents, deposit_cents, deposit_on, trade_in_desc, trade_in_allowance_cents, payment_method, cdd_completed_on, delivered_on, status, lost_reason) values
  (seed_uuid('dl:5001'), 'DL-5001', seed_uuid('vh:outlander'), seed_uuid('cust:opara'),  seed_uuid('staff:bell'),  current_date - 215, 2450000, 100000, current_date - 212, '2015 Mazda Demio, 89,100 km', 550000, 'finance', null,               current_date - 200, 'delivered', null),
  (seed_uuid('dl:5002'), 'DL-5002', seed_uuid('vh:navara'),    seed_uuid('cust:hale'),   seed_uuid('staff:ngata'), current_date - 28,  3100000, 200000, current_date - 26,  null,                          null,   'cash',    null,               current_date - 20,  'delivered', null),
  (seed_uuid('dl:5003'), 'DL-5003', seed_uuid('vh:swift'),     seed_uuid('cust:reyes'),  seed_uuid('staff:bell'),  current_date - 22,  1750000, 50000,  current_date - 20,  null,                          null,   'finance', null,               null,               'deposit',   null),
  (seed_uuid('dl:5004'), 'DL-5004', seed_uuid('vh:mazda3'),    seed_uuid('cust:sharma'), seed_uuid('staff:ngata'), current_date - 3,   2050000, null,   null,               null,                          null,   null,      null,               null,               'quote',     null),
  (seed_uuid('dl:5005'), 'DL-5005', seed_uuid('vh:hilux'),     seed_uuid('cust:booth'),  seed_uuid('staff:bell'),  current_date - 40,  2790000, null,   null,               null,                          null,   null,      null,               null,               'lost',      'Bought a private-sale ute, said our price was $2,000 high')
on conflict do nothing;

-- Repair orders ---------------------------------------------------------------------------
-- Customer work and internal recon share the table. RO-7005 was booked five
-- days ago and nobody recorded what happened; RO-7007 is a pre-delivery
-- check that has sat open six days; RO-7008 is $389 of finished work nobody
-- invoiced. RO-7005 and RO-7009 are WoF jobs booked under Steve Kovac, whose
-- authorisation expired 9 days ago: the gate would refuse them today, the
-- old system took them without blinking.

insert into repair_orders (id, ref, vehicle_id, customer_id, staff_id, on_date, promised_at, type, reason, odometer_km, notes, wof_result, status) values
  (seed_uuid('ro:7001'), 'RO-7001', seed_uuid('vh:woods-crv'),     seed_uuid('cust:woods'),  seed_uuid('staff:patel'), current_date - 260, '08:30', 'service',   'Full service and WoF check',            128400, 'Full service. Oil and filter, air filter, rotated tyres. Rear pads at 40 percent, noted for next visit. All fluids checked.', null, 'completed'),
  (seed_uuid('ro:7002'), 'RO-7002', seed_uuid('vh:frost-golf'),    seed_uuid('cust:frost'),  seed_uuid('staff:patel'), current_date - 72,  '09:00', 'repair',    'Grinding on braking, front',            117900, 'Front pads worn to metal, rotors within spec after machining. New pads fitted, road tested, quiet.', null, 'completed'),
  (seed_uuid('ro:7003'), 'RO-7003', seed_uuid('vh:outlander'),     null,                     seed_uuid('staff:kovac'), current_date - 205, null,    'recon',     'Pre-delivery: service and groom',       68100,  'Oil and filter, wiper blades, full groom. WoF passed by Dev, sticker on.', null, 'completed'),
  (seed_uuid('ro:7004'), 'RO-7004', seed_uuid('vh:hilux'),         null,                     seed_uuid('staff:patel'), current_date - 140, null,    'recon',     'Recon: tyres and service',              148000, 'Two new front tyres, service, wheel alignment. Tray liner cleaned up.', null, 'completed'),
  (seed_uuid('ro:7005'), 'RO-7005', seed_uuid('vh:tanner-ranger'), seed_uuid('cust:tanner'), seed_uuid('staff:kovac'), current_date - 5,   '10:00', 'wof',       'WoF',                                   null,   null, null, 'booked'),
  (seed_uuid('ro:7006'), 'RO-7006', seed_uuid('vh:navara'),        seed_uuid('cust:hale'),   seed_uuid('staff:patel'), current_date,       '08:00', 'accessory', 'Fit towbar and floor mats',             null,   null, null, 'booked'),
  (seed_uuid('ro:7007'), 'RO-7007', seed_uuid('vh:swift'),         null,                     seed_uuid('staff:patel'), current_date - 6,   null,    'recon',     'Pre-delivery check for the Reyes deal', 41250,  null, null, 'open'),
  (seed_uuid('ro:7008'), 'RO-7008', seed_uuid('vh:tanner-ranger'), seed_uuid('cust:tanner'), seed_uuid('staff:patel'), current_date - 12,  '13:00', 'repair',    'Battery flat, will not hold charge',    104400, 'Battery load tested and failed. New battery fitted, charging system tested good at 14.2 V.', null, 'completed'),
  (seed_uuid('ro:7009'), 'RO-7009', seed_uuid('vh:frost-golf'),    seed_uuid('cust:frost'),  seed_uuid('staff:kovac'), current_date + 2,   '09:30', 'wof',       'WoF',                                   null,   null, null, 'booked'),
  (seed_uuid('ro:7010'), 'RO-7010', seed_uuid('vh:navara'),        seed_uuid('cust:hale'),   seed_uuid('staff:patel'), current_date - 12,  '11:00', 'accessory', 'Fit floor mats, first cut',             96900,  'Genuine mats fitted. Towbar on back order, rebooked.', null, 'completed')
on conflict do nothing;

-- Items ---------------------------------------------------------------------------
-- DEMO prices. Brake pads are at 2 with a reorder point of 4; batteries are
-- out, which is why RO-7008 matters: the last one on the shelf went into the
-- Ranger.

insert into items (id, code, name, kind, unit, price_cents, cost_cents, track_stock, stock_qty, reorder_at) values
  (seed_uuid('item:lab-std'),  'LAB-STD',  'Workshop labour',            'labour', 'hour',  12000, null, false, 0,  null),
  (seed_uuid('item:lab-wof'),  'LAB-WOF',  'WoF inspection',             'labour', 'each',  6500,  null, false, 0,  null),
  (seed_uuid('item:pad-f'),    'PAD-F',    'Front brake pad set',        'part',   'each',  18900, 9200, true,  2,  4),
  (seed_uuid('item:oil-5w30'), 'OIL-5W30', 'Engine oil 5W-30, 5 litre',  'part',   'each',  8900,  4100, true,  14, 6),
  (seed_uuid('item:filt-oil'), 'FILT-OIL', 'Oil filter',                 'part',   'each',  3400,  1300, true,  9,  8),
  (seed_uuid('item:bat-12v'),  'BAT-12V',  '12V battery, sealed',        'part',   'each',  32900, 18500,true,  0,  2),
  (seed_uuid('item:mat-set'),  'MAT-SET',  'Floor mat set, genuine',     'part',   'each',  15900, 8800, true,  5,  2),
  (seed_uuid('item:wiper'),    'WIPER',    'Wiper blade pair',           'part',   'each',  4200,  1700, true,  6,  4)
on conflict do nothing;

-- Repair order lines ---------------------------------------------------------------------------

insert into ro_lines (id, ro_id, item_id, qty, unit_price_cents, note) values
  (seed_uuid('rl:7001a'), seed_uuid('ro:7001'), seed_uuid('item:lab-std'),  1.5, 12000, null),
  (seed_uuid('rl:7001b'), seed_uuid('ro:7001'), seed_uuid('item:oil-5w30'), 1,   8900,  null),
  (seed_uuid('rl:7001c'), seed_uuid('ro:7001'), seed_uuid('item:filt-oil'), 1,   3400,  null),
  (seed_uuid('rl:7002a'), seed_uuid('ro:7002'), seed_uuid('item:lab-std'),  1.5, 12000, null),
  (seed_uuid('rl:7002b'), seed_uuid('ro:7002'), seed_uuid('item:pad-f'),    1,   18900, null),
  (seed_uuid('rl:7002c'), seed_uuid('ro:7002'), seed_uuid('item:lab-std'),  0.75,12000, 'Rotor machining'),
  (seed_uuid('rl:7003a'), seed_uuid('ro:7003'), seed_uuid('item:lab-std'),  2,   12000, null),
  (seed_uuid('rl:7003b'), seed_uuid('ro:7003'), seed_uuid('item:oil-5w30'), 1,   8900,  null),
  (seed_uuid('rl:7003c'), seed_uuid('ro:7003'), seed_uuid('item:filt-oil'), 1,   3400,  null),
  (seed_uuid('rl:7003d'), seed_uuid('ro:7003'), seed_uuid('item:wiper'),    1,   4200,  null),
  (seed_uuid('rl:7004a'), seed_uuid('ro:7004'), seed_uuid('item:lab-std'),  4,   12000, 'Tyres, service, alignment'),
  (seed_uuid('rl:7004b'), seed_uuid('ro:7004'), seed_uuid('item:oil-5w30'), 1,   8900,  null),
  (seed_uuid('rl:7004c'), seed_uuid('ro:7004'), seed_uuid('item:filt-oil'), 1,   3400,  null),
  (seed_uuid('rl:7008a'), seed_uuid('ro:7008'), seed_uuid('item:bat-12v'),  1,   32900, 'Last one on the shelf'),
  (seed_uuid('rl:7008b'), seed_uuid('ro:7008'), seed_uuid('item:lab-std'),  0.5, 12000, null),
  (seed_uuid('rl:7010a'), seed_uuid('ro:7010'), seed_uuid('item:mat-set'),  1,   15900, null),
  (seed_uuid('rl:7010b'), seed_uuid('ro:7010'), seed_uuid('item:lab-std'),  0.5, 12000, null)
on conflict do nothing;

-- Invoices ---------------------------------------------------------------------------
-- Tina Woods paid. Callum Frost's brake job is 56 days past due. Ruth Hale's
-- mats are 12 days past due. RO-7008 (the Ranger battery) was never invoiced
-- at all: that is the unbilled line on the attention list.

insert into invoices (id, ref, customer_id, ro_id, issued_on, due_on, total_cents, status, paid_on) values
  (seed_uuid('inv:9001'), 'INV-9001', seed_uuid('cust:woods'), seed_uuid('ro:7001'), current_date - 260, current_date - 246, 30300, 'paid',   current_date - 250),
  (seed_uuid('inv:9002'), 'INV-9002', seed_uuid('cust:frost'), seed_uuid('ro:7002'), current_date - 70,  current_date - 56,  45900, 'issued', null),
  (seed_uuid('inv:9003'), 'INV-9003', seed_uuid('cust:hale'),  seed_uuid('ro:7010'), current_date - 26,  current_date - 12,  21900, 'issued', null)
on conflict do nothing;

-- File notes ---------------------------------------------------------------------------

insert into file_notes (id, vehicle_id, customer_id, staff_id, noted_on, note) values
  (seed_uuid('fn:1'), seed_uuid('vh:frost-golf'), seed_uuid('cust:frost'), seed_uuid('staff:reid'),   current_date - 30, 'Called Callum re the brake invoice, now three weeks past due. Says pay day is the 20th. First promise on file.'),
  (seed_uuid('fn:2'), seed_uuid('vh:swift'),      seed_uuid('cust:reyes'), seed_uuid('staff:bell'),   current_date - 8,  'Marisol waiting on finance approval from her credit union. Chase Wednesday if nothing heard.'),
  (seed_uuid('fn:3'), seed_uuid('vh:hilux'),      null,                    seed_uuid('staff:priest'), current_date - 14, 'Hilux 130 days in. Agreed at sales meeting: drop to $27,500 this week, auction if not away by end of month.')
on conflict do nothing;
