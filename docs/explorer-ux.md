# Explorer UX spec

Decided 29 Oct 2026. Mockups: Panoptic explorer mockups canvas (artboards B and L1).

## Principles

- Connections are the primary object; environments are optional grouping (changed 31 Oct 2026, see "Grouping"). Every kind (SQL, Cosmos, Synapse, Postgres) sits inside its environment group, or with the ungrouped connections. There is no kind-first grouping.
- One tree, one row component. No per-kind row renderers. Backends supply nodes; the tree draws them.
- Everything the row needs is precomputed when the tree model changes. Render reads fields, it never computes labels, prefixes or icon visibility.
- Fixed row heights per level so the virtualiser can multiply. Header 26px, connection 24px, folder and leaf 22px.
- Settings changes re-render the tree once. No restart, no sidecar call.

## Layout

Toolbar (40px): `EXPLORER` label left, icon buttons right (Expand all, Collapse all, Import, New environment, New connection, Settings). Icons replace the current text buttons. Expand all opens every environment as far as its connections and closes anything deeper, so it never calls a server; Collapse all closes every node. A selection hidden by either moves up to its nearest shown ancestor.

Kind filter row (32px, below toolbar): one chip per kind present in the tree plus `All`. Chip shows kind badge, kind name and connection count. Clicking a chip filters the tree to that kind; `All` clears. The row is not rendered when only one kind exists. Chips are derived from the loaded connections, never a hard-coded list.

Tree below, virtualised, env groups separated by a 4px gap.

## Grouping

A connection may be in one environment or in none, and an environment may have no connections.

- **No environments at all:** the connections are listed flat at the root, with no header, no bar and no environment tint. Connection rows indent 10px (there is no group bar to clear), then 20px more per level.
- **At least one environment:** the environments come first, in `explorer.envOrder`, and the connections in no environment come last under a dimmed **Ungrouped** header (muted, weight 600, with a count). The group has no environment colour: no bar and no tint, only the neutral hover and selection washes. It is collapsible, starts open and opens again with Expand all. Selecting it shows a short note in the detail pane.
- **An empty environment** shows its header (no chevron, count 0) with a muted row under it: "Empty - drag a connection here". The row is not a node and cannot be selected.
- **Read-only** is an environment setting, so a connection in no environment is never read-only.
- **Kind filter:** the Ungrouped header shows only when a connection in none has that kind; an empty environment is hidden by any filter.

Moving a connection:

- Drag a connection row onto an environment header or its empty row to move it there, or onto the Ungrouped header to take it out of its environment. The target is outlined while a drop is possible.
- A connection's menu has **Move to environment...** (the environments other than its own, or New environment..., which creates one) and, for a connection in an environment, **Remove from environment**.
- New connection and Import ask for an environment with a picker whose default is None (docs/landing.md).

A connection's node id never includes its environment, so moving one keeps open query tabs, recent objects and anything expanded below it. Deleting an environment still deletes its connections; its confirmation says so.

## Environment group header (26px)

- An environment with no connections has no chevron; see "Grouping" for the row under it.
- Background: env colour at 14% alpha (22% on hover, 30% selected). Left bar: 4px solid env colour.
- Label: env name, 13px, weight 700, white.
- Read-only envs show an uppercase `READ ONLY` pill after the name (10px, env-coloured text, 1px border).
- Right side: connection count, 11px, muted.
- Chevron collapses the group.
- Env colour is set once on the group element as `--env`; children inherit it.

## Connection row (24px)

- Left bar: 4px, the env colour darkened (roughly 25% lightness of `--env`). Continues the group's bar visually without competing with the header.
- Indent 30px from the bar, then chevron, kind badge, label, in that order with 8px gaps.
- Kind badge: 14px square, 3px radius, letter(s) in 9px bold. Colours: SQL `#2d5aa0` "S", Cosmos `#1f7a74` "C", Synapse `#7b4fb5` "Sy", Postgres `#5f7a2e` "PG". New kinds register a badge with the backend.
- Badge visibility is a setting (`explorer.showKindBadge`, default true). Hidden badges leave no gap.
- Label is the real endpoint in Consolas / Cascadia Mono 12.5px, split into three segments: dim prefix, bright core, dim suffix. Dim is `#6a6a6a`, bright is white weight 700. No alias field.
- Selected row: background env colour at 22% alpha over the base (11% on hover), dim segments lift to `#9aa3b5`. Folder and leaf rows follow the same rule.

### Prefix and suffix detection

Run once per tree build, result stored on the node as `label: { prefix, core, suffix }`.

1. Collect all connection endpoints of the same kind across the whole tree.
2. Common prefix = longest common prefix of that set, cut back to the last `.` or `-` boundary so a core never starts mid-token. When the common prefix contains no boundary at all (names glued together, such as `acmedwhuat`), the whole common prefix is kept.
3. Common suffix = longest common suffix of that set, cut forward to the first `.` boundary.
4. If the set has one member, or prefix and suffix would leave an empty core, fall back to the same computation over the connection's env siblings of that kind. If that also yields nothing, prefix and suffix are empty and the whole endpoint is bright.
5. Local instances: `localhost\` is treated as a prefix, `localhost` alone is fully bright. Local instances are left out of the sets in steps 1 and 4, so one local server does not erase every other prefix.

Worked results (invented names in the same shape as the real tree): `acmedwh` + `int-uk` + `.database.windows.net`; `acmesure` + `dev` + `.documents.azure.com`; `acmesuresupport-ondemand.sql.azuresynapse.net` (Synapse, single member of its kind, so nothing is dimmed and the whole endpoint is bright).

## Folder row (22px)

Indent one step (20px) deeper than its parent. Chevron, folder icon (12px stroke), name in the UI font 12.5px `#d0d0d0`, optional count 11px muted. Folders are the backend's container nodes: Databases, Tables, Views, Programmability, Security, SQL pools, Lake databases.

## Leaf row (22px)

Same indent rule. Chevron if expandable, type icon (table, database, container `{ }`), name in monospace 12px. Schema prefix (`dbo.`) is dimmed the same way as endpoint prefixes. Secondary text (partition key, pool tier, `serverless`) is 11px muted in the UI font after the name. Overflow rows (`208 more`) are a muted 11px line, not a node.

## Settings

```
explorer.showKindBadge   bool   default true
explorer.rowFont         enum   mono | ui   default mono (connection and leaf rows only)
explorer.envOrder        string[] manual order of env ids, default order added
```

`explorer.envOrder` is set in the tree, with Move up and Move down on an environment's context menu, not in the Settings dialog. Drag and drop is issue #31.

No layout mode setting. L2 (kind tabs) and L3 (stacked sections) are rejected.

## Destructive actions

Delete environment and Remove connection ask first in `ConfirmDialog` (`apps/desktop/src/app/ConfirmDialog.svelte`): a title, one line saying what goes ("Delete "Prod" and its 3 connections?"), Cancel and a red action button. Cancel has focus, so Enter, Esc and a click on the backdrop all cancel. After the delete the status bar shows "Deleted environment Prod - Undo" (or "Removed connection ...") for ten seconds, and Undo writes back the config from before the delete. The sidecar keeps the deleted connections' secrets until that window closes, so an undone connection still signs in. A second delete, or any other config change, makes the pending one stand at once. If Panoptic closes during the window the delete stands and the secrets are dropped at the next start. Never use `window.confirm`, `alert` or `prompt`: Tauri's webview does not implement them, so the action ran with no prompt. `apps/desktop/src/no-native-dialogs.test.ts` fails on any call to them.

## Keys

Up/Down, Page Up/Down, Home/End move. Right expands (or steps into), Left collapses (or steps to the parent). Enter toggles, F5 refreshes, typing jumps to a matching row, the context-menu key or right-click opens actions. Esc clears the selection, which brings back the landing when no tab is open (docs/landing.md).

## Out of scope for this change

Display-name aliases, pipeline ordering with an Other divider, region chips. All on the canvas, all rejected or deferred.
