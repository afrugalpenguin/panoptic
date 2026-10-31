# Explorer UX spec

Decided 29 Oct 2026; toolbar and filter layout revised 31 Oct 2026 (layout C on the "Panoptic explorer toolbar concepts" canvas). Row mockups: Panoptic explorer mockups canvas (artboards B and L1).

## Principles

- Connections are the primary object; environments are optional grouping (changed 31 Oct 2026, see "Grouping"). Every engine (SQL, Cosmos, Synapse, Postgres) sits inside its environment group, or with the ungrouped connections. There is no engine-first grouping.
- One tree, one row component. No per-engine row renderers. Backends supply nodes; the tree draws them.
- Everything the row needs is precomputed when the tree model changes. Render reads fields, it never computes labels, prefixes or icon visibility.
- Fixed row heights per level so the virtualiser can multiply. Header 26px, connection 24px, folder and leaf 22px.
- Settings changes re-render the tree once. No restart, no sidecar call.
- Nothing in the explorer ever scrolls horizontally. The panel can be as narrow as 220px; every control either fits, wraps vertically, or collapses into a menu.

## Terminology

The user-facing word for SQL Server / Cosmos / Synapse / Postgres is **engine**. The node contract keeps `kind` as its field name; the two meet only in the explorer view model, which maps `kind` onto the "Engine" label. Do not rename the contract. The `explorer.showKindBadge` setting key keeps `kind` too; its label in Settings says engine.

## Layout (top to bottom)

### Filter bar (36px)

Replaces the old `EXPLORER` title row and the chip row. No title; the panel icon identifies it.

- Left: text filter input, flex 1, min-width 0. Placeholder "Filter" at narrow widths, "Filter connections" when the input is wider than 200px. Matches against the full endpoint and the environment name, case-insensitive, substring. Filtering collapses nothing and expands nothing; it hides non-matching connection rows and any environment with no visible children. Debounced 50ms; the tree model is filtered, not the DOM. Esc clears it; Down moves to the tree.
- Right: the engine control, one of two forms chosen by available width (the filter bar's own width, not window width):
  - **Toggles**: one icon-only toggle per engine present in the tree, 22px square, badge inside, `aria-pressed`. On = full opacity with `#2a3356` background; off = 45% opacity. Multi-select. When the bar is wider than 380px each toggle also shows its engine name (a container query on the filter bar).
  - **Button + popover**: used when the toggles would not fit at 22px each plus 2px gaps, leaving the filter at least 80px. One button labelled `Engine` with a `selected/total` count (`12/15`), chevron, `aria-expanded`. Opens a popover anchored to its right edge, max height = panel height minus footer: a find box (shown only when 8 or more engines), `All` / `None` / `Invert` links, then one checkbox row per engine with badge, name and connection count. The list scrolls vertically; the popover never widens past 240px or the panel.
- Engines listed are derived from the loaded connections, never hard-coded. The control is not rendered when only one engine exists.
- Toggle and popover state are the same model (`Set<kind>`, the engines switched off), so switching forms on resize loses nothing. An engine no connection has any more drops out of the set.

### Tree

Virtualised, env groups separated by a 4px gap, as before. Two additions:

- **Sticky environment headers.** The header of the group currently at the top of the viewport stays pinned while its children scroll, with a 4px shadow below it, and the next group's header pushes it up as it arrives. Implemented in the virtualiser (it already knows the first visible row's group), not with `position: sticky` on a non-virtualised list. The Ungrouped header pins the same way.
- **Vertical scrollbar only.** 6px thumb, transparent track, no arrow buttons, thumb visible on hover or while scrolling (`::-webkit-scrollbar` rules; WebView2 is Chromium). Chromium keeps the 6px as a gutter beside the rows; the track is transparent, so it reads as an overlay. `overflow-x: hidden` on the tree container; long labels are clipped with no ellipsis, the dim suffix is the first thing to disappear.

### Footer (30px, always rendered)

Sits over the bottom of the tree, `position: sticky; bottom: 0` inside the scroll container, background `rgba(28,28,33,.9)` with `backdrop-filter: blur(4px)` and a 1px top border. Always present, even when the tree does not overflow, so the layout never jumps.

Contents left to right, icon buttons 26px with `aria-label` and tooltip:

1. New connection
2. New environment
3. Import
4. 1px separator
5. Collapse all
6. Expand all
7. Summary text, right-aligned, 10.5px muted: `3 environments · 20 connections` when nothing is filtered (`20 connections` with no environments), `9 of 20 match` when the text filter or engine filter hides anything. This is the only "filter active" indicator besides the controls themselves.
8. Settings

Expand all opens every environment as far as its connections and closes anything deeper, so it never calls a server; Collapse all closes every node. A selection hidden by either moves up to its nearest shown ancestor.

At widths under 260px the summary drops the words and shows `9 / 20` (`3 · 20` unfiltered). Nothing else in the footer ever hides; at 220px the eight items fit with 4px padding.

Colours are theme variables in `app.css`: `--engine-toggle-on` (`#2a3356`), `--explorer-footer-bg` (`rgba(28,28,33,.9)`), `--explorer-sticky-shadow` and `--scrollbar-thumb`, with light-theme values beside them.

## Grouping

A connection may be in one environment or in none, and an environment may have no connections.

- **No environments at all:** the connections are listed flat at the root, with no header, no bar and no environment tint. Connection rows indent 10px (there is no group bar to clear), then 20px more per level.
- **At least one environment:** the environments come first, in `explorer.envOrder`, and the connections in no environment come last under a dimmed **Ungrouped** header (muted, weight 600, with a count). The group has no environment colour: no bar and no tint, only the neutral hover and selection washes. It is collapsible, starts open and opens again with Expand all. Selecting it shows a short note in the detail pane.
- **An empty environment** shows its header (no chevron, count 0) with a muted row under it: "Empty - drag a connection here". The row is not a node and cannot be selected.
- **Read-only** is an environment setting, so a connection in no environment is never read-only.
- **Filters:** the Ungrouped header shows only when a connection in none passes the engine and text filters (it has no environment name for the text filter to match); an empty environment is hidden by any filter.

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
- Right side: connection count, 11px, muted. When a filter is active this is the visible count.
- Chevron collapses the group.
- Env colour is set once on the group element as `--env`; children inherit it.

## Connection row (24px)

- Left bar: 4px, the env colour darkened (roughly 25% lightness of `--env`). Continues the group's bar visually without competing with the header.
- Indent 30px from the bar, then chevron, engine badge, label, in that order with 8px gaps.
- Engine badge: 14px square, 3px radius, letter(s) in 9px bold. Colours: SQL `#2d5aa0` "S", Cosmos `#1f7a74` "C", Synapse `#7b4fb5` "Sy", Postgres `#5f7a2e` "PG". New engines register a badge with the backend.
- Badge visibility is a setting (`explorer.showKindBadge`, default true). Hidden badges leave no gap.
- Label is the real endpoint in Consolas / Cascadia Mono 12.5px, split into three segments: dim prefix, bright core, dim suffix. Dim is `#6a6a6a`, bright is white weight 700. No alias field.
- Selected row: background env colour at 22% alpha over the base (11% on hover), dim segments lift to `#9aa3b5`. Folder and leaf rows follow the same rule.

### Prefix and suffix detection

Run once per tree build, result stored on the node as `label: { prefix, core, suffix }`.

1. Collect all connection endpoints of the same engine across the whole tree.
2. Common prefix = longest common prefix of that set, cut back to the last `.` or `-` boundary so a core never starts mid-token. When the common prefix contains no boundary at all (names glued together, such as `acmedwhuat`), the whole common prefix is kept.
3. Common suffix = longest common suffix of that set, cut forward to the first `.` boundary.
4. If the set has one member, or prefix and suffix would leave an empty core, fall back to the same computation over the connection's env siblings of that engine. If that also yields nothing, prefix and suffix are empty and the whole endpoint is bright.
5. Local instances: `localhost\` is treated as a prefix, `localhost` alone is fully bright. Local instances are left out of the sets in steps 1 and 4, so one local server does not erase every other prefix.

Worked results (invented names in the same shape as the real tree): `acmedwh` + `int-uk` + `.database.windows.net`; `acmesure` + `dev` + `.documents.azure.com`; `acmesuresupport-ondemand.sql.azuresynapse.net` (Synapse, single member of its engine, so nothing is dimmed and the whole endpoint is bright).

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

No layout mode setting. L2 (engine tabs) and L3 (stacked sections) are rejected. The old toolbar + chip-row layout is superseded by the filter bar + footer above.

## Destructive actions

Delete environment and Remove connection ask first in `ConfirmDialog` (`apps/desktop/src/app/ConfirmDialog.svelte`): a title, one line saying what goes ("Delete "Prod" and its 3 connections?"), Cancel and a red action button. Cancel has focus, so Enter, Esc and a click on the backdrop all cancel. After the delete the status bar shows "Deleted environment Prod - Undo" (or "Removed connection ...") for ten seconds, and Undo writes back the config from before the delete. The sidecar keeps the deleted connections' secrets until that window closes, so an undone connection still signs in. A second delete, or any other config change, makes the pending one stand at once. If Panoptic closes during the window the delete stands and the secrets are dropped at the next start. Never use `window.confirm`, `alert` or `prompt`: Tauri's webview does not implement them, so the action ran with no prompt. `apps/desktop/src/no-native-dialogs.test.ts` fails on any call to them.

Moving a connection out of a read-only environment, into a writable one or none, asks the same way ("Leave read-only", action Move), whether by drag, Move to environment... or Remove from environment, because its queries stop being rolled back. Other moves do not ask.

## Keys

Up/Down, Page Up/Down, Home/End move. Right expands (or steps into), Left collapses (or steps to the parent). Enter toggles, F5 refreshes, typing jumps to a matching row, the context-menu key or right-click opens actions. Esc clears the selection, which brings back the landing when no tab is open (docs/landing.md).

## Out of scope for this change

Display-name aliases, pipeline ordering with an Other divider, region chips. All on the canvas, all rejected or deferred.
