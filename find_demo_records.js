/**
 * Fix Script: Find Demo Records Introduced During Upgrade
 *
 * PURPOSE
 *   Compares sys_ids in a single table between a remote production instance
 *   and this (sandbox) instance. Records present in production but absent from
 *   sandbox are assumed to be demo data loaded during the upgrade.
 *
 * EXECUTION CONTEXT
 *   Run this script IN THE SANDBOX. It connects to production via outbound
 *   REST and compares those records against local sandbox data.
 *
 * FILTER LOGIC
 *   Both sys_created_by AND sys_updated_by must be in SYSTEM_USERS. This
 *   ensures any record a human user has ever touched is strictly excluded.
 *
 *   The identical filter is applied to both sides:
 *     - Production  → sysparm_query in the REST URL
 *     - Sandbox     → GlideRecord.addQuery() (local)
 *
 * SAFE TO RUN
 *   Read-only. Does not modify or delete any records.
 *
 * RUNTIME NOTE
 *   Run once per table. For very large tables split by sys_id range or move
 *   to a Scheduled Script Execution to avoid the fix-script timeout.
 *
 * ENGINE: Rhino (ES5) — no arrow functions, let/const, or template literals.
 */

(function findDemoRecords() {

    // =========================================================
    // CONFIGURATION — edit before running
    // =========================================================

    /** Base URL of the production instance (no trailing slash). */
    var PROD_URL  = 'https://YOUR-PRODUCTION.service-now.com';

    /** Production credentials (needs rest_service role + read on TABLE). */
    var PROD_USER = 'admin';
    var PROD_PASS = 'your_production_password';

    /** Table to compare in this run. Change between executions. */
    var TABLE = 'incident';

    /**
     * Usernames considered purely system-generated.
     * Both sys_created_by AND sys_updated_by must be in this list for a
     * record to be included. Any record touched by a user not in this list
     * is ignored.
     */
    var SYSTEM_USERS = ['system', 'admin', 'maint', 'glide.maint'];

    /** Records fetched per REST page (max 10 000; lower = less memory). */
    var PAGE_SIZE = 1000;

    // =========================================================
    // STEP 1 — Build encoded query (shared by both sides)
    // =========================================================

    /**
     * Produces a ServiceNow encoded-query string that requires both
     * sys_created_by and sys_updated_by to be IN SYSTEM_USERS.
     *
     * Used verbatim in GlideRecord.addQuery() on the local sandbox and
     * URL-encoded into sysparm_query for the production REST call.
     *
     * @return {string}
     */
    function buildEncodedQuery() {
        var userList = SYSTEM_USERS.join(',');
        return 'sys_created_byIN' + userList
             + '^sys_updated_byIN' + userList;
    }

    // =========================================================
    // STEP 2 — Fetch production sys_ids via REST (paginated, filtered)
    // =========================================================

    /**
     * Pages through the production table using the supplied encoded query and
     * returns a hash-set of all matching sys_ids.
     *
     * @param  {string} tableName
     * @param  {string} encodedQuery  Raw (not URL-encoded) encoded-query string
     * @return {Object}  { '<sys_id>': true, ... }
     */
    function fetchProductionIds(tableName, encodedQuery) {
        var ids = {};
        var offset = 0;
        var records, i, resp, statusCode;

        while (true) {
            var endpoint = PROD_URL + '/api/now/table/' + tableName
                + '?sysparm_fields=sys_id'
                + '&sysparm_limit='  + PAGE_SIZE
                + '&sysparm_offset=' + offset
                + '&sysparm_exclude_reference_link=true'
                + '&sysparm_query='  + encodeURIComponent(encodedQuery);

            var rm = new sn_ws.RESTMessageV2();
            rm.setHttpMethod('GET');
            rm.setEndpoint(endpoint);
            rm.setBasicAuth(PROD_USER, PROD_PASS);
            rm.setRequestHeader('Accept', 'application/json');
            rm.setHttpTimeout(60000);

            resp       = rm.execute();
            statusCode = resp.getStatusCode();

            if (statusCode !== 200) {
                gs.print('[ERROR] Production REST failed:'
                    + ' table='  + tableName
                    + ' offset=' + offset
                    + ' http='   + statusCode
                    + ' body='   + resp.getBody());
                break;
            }

            records = JSON.parse(resp.getBody()).result || [];

            for (i = 0; i < records.length; i++) {
                ids[records[i].sys_id] = true;
            }

            if (records.length < PAGE_SIZE) {
                break;          // final page
            }
            offset += PAGE_SIZE;
        }

        return ids;
    }

    // =========================================================
    // STEP 3 — Walk sandbox locally with same filter, compare
    // =========================================================

    /**
     * Queries this (sandbox) instance using GlideRecord with the same filter
     * applied to the production REST call. Returns every production sys_id
     * that is absent from the local sandbox, i.e. the demo records.
     *
     * @param  {string} tableName
     * @param  {Object} prodIds   Hash-set from fetchProductionIds()
     * @return {{ sandboxCount: number, demoIds: string[] }}
     */
    function walkSandbox(tableName, prodIds) {
        var userList     = SYSTEM_USERS.join(',');
        var sandboxCount = 0;
        var sysId;

        // Collect local sandbox sys_ids into a hash-set
        var sandboxIds = {};
        var gr = new GlideRecord(tableName);
        gr.addQuery('sys_created_by', 'IN', userList);
        gr.addQuery('sys_updated_by', 'IN', userList);
        gr.query();

        while (gr.next()) {
            sandboxCount++;
            sandboxIds[gr.getUniqueValue()] = true;
        }

        // Diff: production sys_ids not present locally = demo records
        var demoIds = [];
        for (sysId in prodIds) {
            if (!sandboxIds[sysId]) {
                demoIds.push(sysId);
            }
        }

        return { sandboxCount: sandboxCount, demoIds: demoIds };
    }

    // =========================================================
    // MAIN
    // =========================================================

    gs.print('========================================');
    gs.print('Table         : ' + TABLE);
    gs.print('Allowed users : ' + SYSTEM_USERS.join(', '));

    var encodedQuery = buildEncodedQuery();
    gs.print('Filter        : ' + encodedQuery);
    gs.print('Condition     : sys_created_by AND sys_updated_by must both be'
        + ' in allowed list (any record ever touched by another user is skipped)');
    gs.print('========================================');

    // Production — filtered fetch via REST
    gs.print('\nFetching production sys_ids via REST...');
    var prodIds = fetchProductionIds(TABLE, encodedQuery);
    var prodCount = 0;
    var k;
    for (k in prodIds) { prodCount++; }
    gs.print('Production filtered count : ' + prodCount);

    // Sandbox — filtered local walk + diff
    gs.print('Walking sandbox records locally...');
    var result = walkSandbox(TABLE, prodIds);
    gs.print('Sandbox filtered count    : ' + result.sandboxCount);
    gs.print('Demo records (prod only)  : ' + result.demoIds.length);

    if (result.demoIds.length > 0) {
        // Paste into an encoded query as:  sys_idIN<value>
        gs.print('\nsys_ids:');
        gs.print(result.demoIds.join(','));
    }

    gs.print('\n========================================');
    gs.print('DONE');
    gs.print('========================================');

})();
