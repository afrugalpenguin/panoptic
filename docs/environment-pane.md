# Environment detail pane

Decided 9 Nov 2026. Mockup: "Panoptic window concepts" canvas, artboard D. All mock data is the fictional Fabrikam estate.

Replaces the current environment view in `DetailPane.svelte` (title, six text buttons, three-row property list). The Edit environment dialog is no longer needed for existing environments; every property edits in place and saves immediately. `EnvironmentDialog.svelte` stays for New environment only.

## Principles

- The pane shows live facts, not a property sheet. Reachability, ping and timings are what make the app read as fast; the layout just gives them room.
- Nothing in the pane blocks on the network. Static content paints from the store at once; probes fill in afterwards and never delay first paint.
- Every edit saves on change, with the store write awaited and surfaced on failure. No Save button, no dirty state.
- One component, no per-engine branches. Engine badge and label come from the node, as in the tree.

## Layout

Pane fills the area right of the explorer. Padding 28px sides, 22px top. Tokens are the explorer's: `--env` set once on the pane root from the environment colour; text `#e6e8ec`, muted `#8a93a3`, dim `#5f6878`, hairline `#1c2029`, card `#12151b`, page `#0f1115`. Numbers and hostnames in the mono stack already used by the tree.

### Colour rule (3px)

Full width across the top of the pane. `linear-gradient(90deg, var(--env) 0 40%, transparent 100%)`.

### Header

Row, align top, gap 20px.

1. Identity tile 44px square, radius 10px, background `--env`, first letter of the name in 17px weight 700, text colour chosen for contrast against `--env` (dark on light colours, white on dark).
2. Name block: name 26px weight 700 letter-spacing -0.02em; to its right `ENVIRONMENT · n OF m` 11px mono uppercase dim. Below, one 13px muted line: `9 connections | 3 engines | ● 9 reachable | writes allowed`, separators `|` in hairline colour, numbers 600 in text colour, the reachable dot green. When probes have not run yet the reachable segment reads `checking` with the dot grey.
3. Actions, right-aligned: `New connection` primary (amber `#f2a33a`, dark text, kbd `N`), `Refresh` icon button (kbd `R`). Move up/down, Edit and Delete leave the header.

### Body: two columns, gap 24px, 24px below the header

Left `minmax(0, 1fr)`, right 320px.

#### Connections card (left)

Card: hairline border, radius 10px, card background. Header row 12px: `CONNECTIONS` label, `9 listed in 3 ms` mono dim (the time to build the list from the store, measured, never a constant), engine count pills right-aligned using the tree's badge colours (`SQL 5`, `Cosmos 3`, `Synapse 1`). Pills only for engines present.

Column header row 30px, uppercase 10.5px dim: blank, Host, Engine, Status, Ping. Grid `28px minmax(0,1fr) 100px 96px 70px`, gap 14px, 16px side padding.

Connection row 42px, hairline top border, hover `#151922`:

- engine badge 22px, same letters and colours as the tree
- host label using the tree's `{prefix, core, suffix}` split: dim, 600 white, dim; single line, ellipsis
- engine name, 12.5px muted
- status: 8px dot with 3px ring at 15% alpha plus word. `Reachable` green `#3ddc84`, `Slow` amber `#f2a33a` (over 40 ms), `Unreachable` red `#ff7b7b`, `Checking` grey with no ring
- ping, mono 12.5px right-aligned, coloured like the status; `-` while checking

Click a row to select that connection in the tree (same as clicking it there). Double-click expands it. Right-click gives the tree's connection context menu.

#### Right rail

Two cards then Delete pinned to the bottom (`margin-top: auto`).

**Properties card.** Label `PROPERTIES`. Rows 22px, label dim left, value right, 13px:

- Name: text input styled as plain text, right-aligned, border appears on hover and focus. Saves on blur or Enter; Escape reverts; empty is rejected with the previous value restored and the field flashing the bad colour once.
- Colour: button showing 14px swatch, hex in mono, chevron. Opens a popover anchored below-right: the existing swatch set plus a hex field. Picking saves and closes.
- Write policy: button showing a status dot and the current value with a chevron. Menu lists `Allowed` and `Read-only` today, mapped to the existing `readOnly` boolean. `Guarded` is added when the production write policy model lands (ADR 0016 amendment); until then it is not shown rather than shown disabled.
- Position: `2 of 8` mono, then up and down ghost arrow buttons, disabled at the ends. Same behaviour as the old Move up / Move down.
- Catalog: `warm · 2 min ago` or `cold`, from the warm-up state the sidecar already reports. Shown only when the backend exposes it; otherwise the row is omitted, never faked.

**Recent card.** Label `RECENT`. Up to 5 rows: `connection core · object name` (connection dim), age right-aligned in mono dim (`4m`, `22m`, `1h`). Click opens the object as the tree would. Source is a per-environment MRU of objects opened or queried, capped at 50, in the local store. Hidden until at least one entry exists.

**Delete.** Ghost danger button `Delete environment`, full rail width, then a 12px dim centred note: `Removes the grouping only. Connections and saved secrets are kept and become loose.` Confirmation dialog as now, with the same wording. (Depends on loose connections being supported; until that branch lands the note reads `Removes the environment and its n connections. Saved secrets are deleted.` and the behaviour is unchanged.)

### Footer (30px)

Hairline top border, 11.5px dim: green dot `Ready`, then `UAT: 9 items in 3 ms` mono, then right-aligned `Changes save as you make them`. The timing is the same measurement as the Connections card header.

## Reachability probes

- Run when the environment becomes selected and on Refresh, never on a timer.
- One probe per connection, all in parallel, through the sidecar: open a socket to host and port (or the Cosmos endpoint over HTTPS HEAD), no authentication, no query. Timeout 2 s, which maps to Unreachable.
- Result cached per connection for 60 s so flicking between environments does not re-probe.
- Ping is the round trip of that probe in ms. Slow threshold 40 ms.
- Probes run behind the backend contract as a generic capability (same shape as warm-up), not per engine in the UI.

## Keyboard

`N` new connection, `R` refresh, `F2` focus the name field, `Delete` with the environment header selected in the tree opens the delete confirmation. Arrow keys in the Connections card move the selection and mirror it in the tree.

## Out of scope for this branch

Guarded write policy, latency sparklines (concept B, rejected), an Edit dialog for existing environments, light theme.

## Phases

1. Layout and inline properties. No new data: colour rule, header, actions, Connections card with status `Checking` hidden (status and ping columns omitted), Properties card with Name, Colour, Write policy, Position, Delete, footer with measured list time. Remove the old six-button toolbar and the Edit dialog path for existing environments.
2. Reachability and ping: sidecar probe capability, cache, status and ping columns, reachable count in the header.
3. Recent card and Catalog row, each shown only when its data exists.

Each phase is its own PR with a change fragment in `changes/`.
