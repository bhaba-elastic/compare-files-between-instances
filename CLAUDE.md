# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Context

This is a **ServiceNow (SNow) scripting project**. Code here runs inside a ServiceNow instance — there is no local build system, no npm, and no test runner. Scripts are pasted directly into ServiceNow's script editors and executed server-side by the Rhino JavaScript engine or client-side in AngularJS (Service Portal).

The sibling directory `../check incidents/` contains a complete Service Portal widget for reference.

## Execution Environments

| Context | Engine | Globals available |
|---|---|---|
| Server Script (widget, business rule, script include) | Rhino (ES5) | `GlideRecord`, `gs`, `data`, `input` |
| Client Controller (Service Portal widget) | AngularJS 1.x in browser | `$scope`, `$location`, `spUtil`, `$window`, `api.controller` |
| Background Scripts / Fix Scripts | Rhino (ES5) | `gs`, `GlideRecord`, `GlideSystem` |

**Do not use ES6+ syntax** (arrow functions, `let`/`const`, template literals, destructuring) in server-side scripts — Rhino does not support it.  
**Do not use Angular 2+ syntax** in client controllers or HTML templates.

## Key ServiceNow APIs

- `GlideRecord(table)` — ORM for querying/updating tables. Always call `.query()` before iterating with `.next()`.
- `gs.getUserID()` / `gs.getUserDisplayName()` — current session user.
- `gr.getDisplayValue(field)` — human-readable value (e.g. choice label); `gr.getValue(field)` — raw stored value.
- `data` object — shared between Server Script and Client Controller in SP widgets; populate on server, read on client via `$scope.data`.
- `spUtil.update($scope)` — re-runs the Server Script and merges new `data` into scope (used for refresh without page reload).

## Service Portal Widget Structure

Each widget consists of four files pasted into separate tabs in the Widget Editor (`sp_widget.list`):

| File | Tab in editor |
|---|---|
| `widget_html.html` | HTML Template |
| `client_controller.js` | Client Script |
| `server_script.js` | Server Script |
| `widget_css.scss` | CSS – SCSS |

Navigation within SP: use `$location.search({ id: 'form', table: '<table>', sys_id: '<sys_id>' })` — assumes a page with ID `form` exists in the portal.

## Common Gotchas

- State values for `incident` table: `1`=New, `2`=In Progress, `3`=On Hold, `6`=Resolved, `7`=Closed, `8`=Cancelled. Customized instances may differ.
- ACLs apply even in server scripts executed by widgets — query results are automatically filtered by the user's roles.
- `gs.getUserID()` returns a guest/null sys_id for unauthenticated users; guard against this in widgets accessible without login.
- Add `gr.setLimit(N)` before `gr.query()` for queries that could return large result sets.
