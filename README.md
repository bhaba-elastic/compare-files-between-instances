# Demo Record Finder – ServiceNow Fix Script

Identifies records that exist in a **production** instance but not in a **sandbox** instance, on a per-table basis. This is useful for isolating demo data accidentally loaded during an application upgrade when timestamps cannot be used to distinguish records.

---

## How It Works

1. For each table in `TABLES`, all `sys_id` values are fetched from the sandbox via paginated REST calls and stored in a JavaScript hash map.
2. Production records for the same table are iterated with `GlideRecord`. Any `sys_id` not present in the sandbox hash is treated as a demo record.
3. Results are printed to the fix-script output log.

The script is **read-only** — it does not modify or delete any records.

---

## Setup

### 1 – Configure the script

Open `find_demo_records.js` and edit the `CONFIGURATION` block at the top:

```js
var SANDBOX_URL  = 'https://YOUR-SANDBOX.service-now.com';
var SANDBOX_USER = 'admin';
var SANDBOX_PASS = 'your_sandbox_password';

var TABLES = [
    'incident',
    'problem',
    'change_request'
    // add more tables as needed
];
```

### 2 – Verify prerequisites

| Requirement | Where to check |
|---|---|
| Outbound REST enabled on production | **System Properties > REST** – `glide.rest.outbound.ecc_enabled` or check that `sn_ws.RESTMessageV2` is available |
| Sandbox reachable from production | Both are ServiceNow cloud instances – no extra network config needed |
| Sandbox user has `rest_service` role | Sandbox › **User Administration > Users** |
| Sandbox user has read ACL on each table | Test with a manual REST call (see below) |

**Manual REST test (from a browser or curl):**
```
GET https://YOUR-SANDBOX.service-now.com/api/now/table/incident?sysparm_fields=sys_id&sysparm_limit=1
Authorization: Basic <base64(user:pass)>
```

### 3 – Run as a Fix Script

1. In production, navigate to **System Definition > Fix Scripts**.
2. Click **New**.
3. Set **Name** (e.g. `Find Demo Records - 2026-04-21`).
4. Paste the full contents of `find_demo_records.js` into the **Script** field.
5. Click **Run Fix Script** (do NOT check *Run* in the list view — use the button on the record).
6. Output appears in the **Messages** section below the script after it completes.

---

## Reading the Output

```
========================================
Table: incident
========================================
  Fetching sandbox sys_ids...
  Sandbox record count : 1432
  Walking production records...
  Production record count: 1687
  Demo records (prod only): 255
  sys_ids: abc123...,def456...,...
========================================
SUMMARY
========================================
incident  | prod=1687 | sandbox=1432 | demo=255
problem   | prod=312  | sandbox=312  | demo=0
========================================
```

The `sys_ids` line is a comma-separated list ready to paste into an encoded query:

```
sys_idINabc123...,def456...
```

Use this to preview the records in a list view before deciding to delete or update them.

---

## Large Tables

For tables with hundreds of thousands of records, the fix-script transaction may time out before the `GlideRecord` walk completes. Options:

- **Split by table** – run the script once per table instead of all at once.
- **Add a `GlideRecord` filter** – if you know a date range or application that brought in the demo data, narrow the production query to reduce iteration time:
  ```js
  gr.addQuery('sys_class_name', 'incident');
  gr.addQuery('sys_created_on', '>=', '2026-01-15 00:00:00');  // upgrade date
  ```
- **Switch to a Scheduled Script Execution** – runs without the interactive transaction timeout limit.

---

## After You Have the sys_ids

Once you have confirmed the records are demo data, you can delete them using a second fix script:

```js
// CAUTION: deletes records. Verify the sys_id list first.
var ids = ['abc123', 'def456']; // paste sys_ids here
var gr = new GlideRecord('incident');
gr.addQuery('sys_id', 'IN', ids.join(','));
gr.query();
while (gr.next()) {
    gr.deleteRecord();
}
gs.print('Deleted ' + ids.length + ' records from incident.');
```
