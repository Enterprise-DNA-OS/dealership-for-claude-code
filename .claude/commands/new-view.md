---
description: Add a read-only HTML dashboard page in plain language - "a page of this month's deliveries by source", "a board of WoF jobs due". Writes the SQL into views.json and renders it.
---

1. The operator describes the page. Write the SQL against the existing views (`v_vehicles`, `v_deals`, `v_ros`, `v_invoices`, `v_service_due`, `v_attention`) - read the migration for their columns.
2. Add a section (or a whole page) to `views.json`, matching the existing shape.
3. Run `npm run view`, open the file it names, and check the page actually answers the question.
4. Say honestly what a real front end gives that this page does not: live refresh, drag-and-drop, phone-friendly input. This is a report, and a good one.
