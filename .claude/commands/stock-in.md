---
description: A unit arrives - trade-in, auction buy, import. Put it into stock with its odometer reading (mandatory, the CIN states it), cost and asking price, then walk the paper.
---

1. Gather: make, model, year, odometer (off the dash, not the listing), cost, intended asking price, source, VIN and plate if in hand, whether it goes on floorplan.
2. Run `node scripts/dealer.mjs stock in --make= --model= --year= --odometer= --cost= --asking= --source= [--vin= --plate= --floorplan]`.
3. Then walk the paper in order and run each as the operator confirms it: `vehicle cin VH-xx`, `vehicle ppsr VH-xx --clear` (or `--security` if the search finds one), and book the WoF if it needs one (`ro book VH-xx --type=wof --tech=`).
4. The unit is not honestly for sale until the CIN is on it. Say so if the operator stops early.
