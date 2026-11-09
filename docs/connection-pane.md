# Connection detail pane

Decided 9 Nov 2026. Mockup: "Panoptic window concepts" canvas, artboard E. All mock data is the fictional Fabrikam estate. Companion to `docs/environment-pane.md`; shares its tokens, components and rules, so only differences are spelled out here.

Replaces the current connection view in `DetailPane.svelte` (title, nine text buttons, Engine and Server rows). The Edit connection dialog is no longer needed for existing connections; every property edits in place. The New connection dialog stays.

## Principles

Same as the environment pane, plus:

- The pane is a status board about the server, not a second tree. It never lists the server's databases; the explorer already does that directly beneath the selected row. Database-level problems surface as exceptions only.
- Everything the pane shows is either from the store (instant), from the reachability probe (cheap, no auth), or read once on connect and cached. No query runs because the pane opened.
- One component for every engine. Each card asks the backend for a flat list of labelled facts; the backend decides what those facts are. The UI has no `if engine === ...`.

## Layout

Same frame as the environment pane: 3px colour rule in the environment colour, 28px side padding, header, two-column body (`minmax(0,1fr)` / 320px, gap 24px), 30px footer.

### Header

1. Identity tile 44px, radius 10px, background the engine badge colour from the tree (SQL `#2b4a8a`, Cosmos `#1e6e5c`, Synapse `#5a3ea8`), engine letter(s) in mono 17px 700 in the badge text colour. A 14px environment dot sits on the bottom-right corner, 2px page-colour border, in `--env`. A loose connection has no dot.
2. Name block: host in mono 24px 700 using the tree's `{prefix, core, suffix}` split (prefix and suffix dim, weight 500), single line, ellipsis. To its right `CONNECTION · n OF m IN <env>` 11px mono uppercase dim (`LOOSE CONNECTION` when it has no environment). Below, one 13px muted line: `12 databases | ● reachable | Azure SQL | writes read-only from Prod`. The reachable segment follows the environment pane's states (`checking` grey until the probe returns). The engine word is the backend's display name. The writes segment shows the effective policy and where it comes from.
3. Actions, right-aligned: `New query` primary (kbd `Ctrl+N`), `Copy name` icon button (kbd `C`), `Refresh` icon button (kbd `R`). Edit, Move to environment, Move up/down, Remove from environment and Remove connection all leave the header; they live in the rail.

### Left column

Three blocks, gap 14px, top-aligned.

#### Server card (live strip)

Card header row 12px: `SERVER` label, `probed 12 s ago` mono dim, right-aligned `next on refresh` mono dim. Below, a four-tile grid (`repeat(4, minmax(0,1fr))`), tiles separated by hairlines, each 14px 16px padding: 10.5px uppercase dim key, 20px 600 value (mono for numbers), 11.5px muted subline.

1. **Ping**: round trip in ms coloured like the status, subline the status word with its dot. Same probe, cache and thresholds as the environment pane. Slow threshold is the environment pane's; do not define a second one here.
2. **Connected**: handshake time in ms, subline `opened 2 min ago` or `not connected` with the value `-`. From the sidecar's record of its own opens: when the session to this connection started and how long that open took. Whether a pooled connection is still open is not shown: the drivers' pools cannot be asked.
3. **Catalog**: `warm` green, `cold` dim, `refreshing` amber; subline `3 of 12 databases · 4 min ago` (how many databases have a snapshot and when the newest was built). From the catalog snapshot store the query editor already uses. Tile omitted until that store exists in the build.
4. **Session**: the authenticated identity in mono 15px (Entra UPN, SQL login name, or `account key` for Cosmos key auth), subline the auth mode and, for token auth, time left on the token. Value `-` with subline `not connected` until a session has been opened.

Tiles never block paint. Each shows `-` until its source answers.

#### About this server card

Header row: `ABOUT THIS SERVER` label, `read on connect, cached` mono dim. Then rows 34px, hairline top border, grid `150px minmax(0,1fr)`: key dim, value text, mono where it is an identifier or number.

The rows are a flat `{label, value, detail?, mono?}` list returned by the backend's `describeServer()` after a session opens, cached per connection until Refresh. The UI renders whatever comes back in order and adds one row of its own at the end: **Databases**, `12 · 11 online` plus a state pill for every non-online state present (`1 restoring`, `2 offline`). The counts come from the same describe, which reads every database and its state: the SQL tree lists online databases only, so the tree's children cannot say which are not.

Reference lists per backend, so the shape is agreed up front (backends may add or drop rows):

- SQL family: Product (`Microsoft Azure SQL Database · v12`), Version (`12.0.2000.8`), Edition (`General Purpose · serverless, 4 vCores`; on-prem `Developer Edition (64-bit)`), Collation, Server time (UTC, as returned at connect, not ticking).
- Cosmos: Account kind (`NoSQL`), Default consistency (`Session`), Regions (`UK South (write), North Europe`), Containers (total across databases, from the tree), Free tier / serverless where reported.
- Synapse serverless: Product, Version, Pool (`built-in serverless`), Collation, Server time.

Card hidden until the first session has opened; it never shows placeholders.

#### Needs attention strip

Rendered only when there is at least one exception. Amber hairline border `#3a2f16`, background `#15130e`, 12px 16px padding. Amber dot, then a 13px 600 title `1 database needs attention` (or `3 databases need attention`), a 12.5px muted line per item naming the object in mono and the state with its age (`is restoring, started 14 min ago`), and a right-aligned `Show in tree` link that selects and reveals the first item.

Sources in phase 2: any database the describe found not online (restoring, offline, suspect...; on Postgres, one that takes no connections or was left invalid). No age is shown: there is no portable source for when a state began. No `Show in tree` link either, as these databases are not in the tree. Later: expired or expiring token (under 5 min), probe unreachable while a session is open, catalog refresh failed. Each source is a backend-reported `{severity, title, detail, nodeId?}`; the UI only renders. Red variant (`#3a2226` / `#1a0f11`, dot `#ff7b7b`) for severity error.

### Right rail

Two cards, then Remove pinned to the bottom (`margin-top: auto`). Same row styling as the environment pane's Properties card.

**Properties card.** Label `PROPERTIES`.

- Host: mono text input styled as plain text, right-aligned, border on hover and focus, ellipsis when long. Saves on blur or Enter; Escape reverts; empty rejected as in the environment pane. Changing the host invalidates the cached About rows, the catalog and the probe cache for this connection, and rebinds the secret (the secret-rebinding rule from the stabilise phase applies).
- Engine: badge plus display name. Read-only; the engine is fixed at creation.
- Environment: button with env dot and name, chevron. Menu lists every environment with its dot, a separator, then `None (loose)`. Picking saves and moves the node; this replaces Move to environment and Remove from environment. `None (loose)` is present only once loose connections are supported.
- Authentication: button with the mode (`Entra interactive`, `SQL login`, `Account key`, `Entra service principal`), chevron. Opens the same auth editor the New connection dialog uses, as a popover, prefilled. Saving rebinds the secret.
- Default database: button, mono value, chevron. Menu lists the server's databases from the tree. Omitted for engines without the concept (Cosmos).
- Write policy: dot and value, no chevron, with a dim `inherited` tag. Connection-level policy is display only; policy is set on the environment (ADR 0016). A loose connection shows `Allowed` with the tag `no environment`.
- Secret: lock icon and where it lives (`Credential Manager`, `Keychain`), or `none` for integrated/interactive auth that stores nothing. Display only.
- Position: `2 of 8` mono, up and down ghost arrows, disabled at the ends. Replaces Move up / Move down. Hidden for a loose connection.

**Recent card.** Label `RECENT`. Same MRU as the environment pane, filtered to this connection, each row `database · object` with the database dim. Hidden until at least one entry exists.

**Remove.** Ghost danger button `Remove connection`, full width, then the 12px dim centred note: `Deletes the saved connection and its secret. Nothing on the server is touched.` Confirmation dialog as now.

### Footer

As the environment pane: `Ready`, `<core>: n items in x ms` (time to list the connection's children from the store), `Changes save as you make them`.

## Data contract additions

Behind the backend contract, generic across engines:

- `probe(connection)`: already specified by the environment pane; reused.
- `describeServer(session)`: returns `Array<{label, value, detail?, mono?}>` and every database with its state. Called once, in the background, when the sidecar first opens a session to the connection (an expand, a query, a catalog), and on Refresh; the pane reads the cached result and is told (`connection.serverUpdated`) when a describe finishes. Must complete in under 200 ms on a warm connection against the SQL family (`SERVERPROPERTY`, `sys.dm_user_db_resource_governance` or `sys.database_service_objectives` for the edition, `sysdatetimeoffset()`); Cosmos uses the account read the SDK already does on connect.
- `sessionInfo(connection)`: from the sidecar's record of its opens, no network: `{openedAt, handshakeMs, identity, authMode, tokenExpiresAt?}` or null.
- `exceptions(connection)`: `Array<{severity: 'warn'|'error', title, detail, nodeId?}>`, computed from state the app already holds; no new queries in phase 1.

## Keyboard

`Ctrl+N` new query on this connection, `C` copy host, `R` refresh (re-probe, re-describe, re-list), `F2` focus the Host field, `Delete` with the connection selected in the tree opens the remove confirmation.

## Out of scope

Per-connection write policy, query history (a separate feature), light theme, latency sparklines, any database listing in the pane.

## Phases

1. Layout and inline properties, no new backend calls: colour rule, header (reachable segment `checking` until phase 2 of the environment pane lands, then live), actions, Properties card with Host, Engine, Environment menu, Authentication popover, Default database, Write policy inherited, Secret, Position; Remove at the bottom; footer. Server card shows only the tiles whose source already exists (Ping once the environment pane's probe is in; otherwise the strip is omitted). About card and Needs attention hidden. Remove the nine-button toolbar and the Edit dialog path for existing connections.
2. `describeServer` and `sessionInfo` behind the contract for the SQL family, Cosmos and Postgres; About card; Connected and Session tiles; Needs attention from non-online database states.
3. Catalog tile (once the catalog snapshot store exists), Recent card filtered to the connection, token-expiry and probe exceptions.

Each phase is its own PR with a change fragment in `changes/`.
