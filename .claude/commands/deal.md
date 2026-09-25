---
description: Work a deal from quote to delivery - open it, take the deposit (CIN gate), deliver it (PPSR, WoF and cash-CDD gates). The gates cite their sources and have no force flags; do not work around them, satisfy them.
---

1. Open: `node scripts/dealer.mjs deal open VEHICLE CUSTOMER --sales= [--price=] [--trade= --allowance=]`.
2. Deposit: `deal deposit REF --amount= [--method=]`. If the CIN gate refuses, record the CIN first (`vehicle cin`); that is the law working, not an error.
3. Deliver: `deal deliver REF [--method=] [--cdd] [--as-is]`. If the gate asks for PPSR, run the search and record it. If it asks for a WoF, book one (`ro book ... --type=wof`) or record a written as-is acknowledgment with `--as-is`. Cash at or over the threshold needs `--cdd` after identity is verified.
4. Lost: `deal lost REF --reason=` - the reason goes on the record, always.
5. After delivery, `npm run docs` renders the offer and sale agreement for signing.
