# Landing and Seek spec

The empty workspace's start page ("C - Quiet wordmark") and Seek, the one box that finds environments, connections and recent objects. Seek lives in its own module (`apps/desktop/src/app/seek.ts`) so a later Ctrl+P palette reuses it unchanged.

## When it shows

The landing shows when no tab is open **and** nothing is selected in the tree. It replaces only the detail pane's empty state: a selected node still shows its details. Esc in the tree clears the selection and brings the landing back.

## Layout

A centred column, at most 460px wide:

- Header: the 32px mark (`src-tauri/icons/icon.svg`), `PANOPTIC` (16px, 600, letter-spacing 2.4px, muted), the version in mono 11px on the right.
- The Seek box: 56px tall, radius 12, a cyan border with a 4px cyan ring, placeholder "Seek anything, anywhere", a `Ctrl P` chip. Focused when the landing shows.
- A muted line: "Objects across all N environments. Type a table, container, proc or host." ("No environments yet" with none.)
- Actions, 44px rows with dividers: Reopen last session (amber clock and the last place in muted mono, only when there is one), New query `Ctrl N`, New connection `Ctrl Shift N` (with no environments yet it asks for one first; New environment stays in the explorer toolbar), Import `Ctrl I` (dimmed).
- Bottom left, mono 11px: an amber dot, "Ready" and "opened in NNN ms" when the engine is up; "Starting database engine..."; or "Database engine stopped" and Restart.
- Bottom right: a faded 300px "Panoptic" wordmark overflowing the corner, `aria-hidden`, behind everything.

The word "sidecar" never appears in user-facing text, here or in the status bar.

## Seek

One index over the loaded environments, their connections and the recent objects in usage.

**Nothing typed:** "Pick up where you left off" (the last place, pre-selected), then environments by last use (use count breaks ties, then name), capped at 5 with a muted "N more, type to find" hint, then up to 3 recent objects. At most 9 selectable rows; the hint is not a row. No environments, no rows.

**Typed:** the query splits into tokens, and every token must match (AND). Matching is case-insensitive substring; a prefix of the text scores 3, the start of a word 2, anywhere 1.

1. Environments where every token is in the environment's name or id, one of its hosts' names, or one of its recent objects' labels. Ranked by how well the tokens match the environment's own name, capped at 5 with a "more" hint.
2. The top environment's connections whose name (with the environment's name) holds every token, by name.
3. The top environment's recent objects whose label or host name (with the environment's name) holds every token, up to 3.

So "uk prod" ranks Prod first with only its `uk-` hosts under it: "uk" is in neither `us-prod-sql-01` nor "Prod".

**Connections only** (the unconnected tab's picker): every connection, the last used one first when nothing is typed; typed, tokens AND across the host and environment names, the host name counting double.

**Stale usage:** usage outlives config. A remembered place in an environment that has since been removed is never offered, in Seek or as Reopen last session.

### Keys

| Key | Does |
| --- | --- |
| Up / Down | Move the highlight |
| Enter | Environment: select it and collapse the others. Connection: the same, with the connection expanded. Place: reopen it. |
| Ctrl+Enter | A new query tab on the connection (an environment's first one); a place reopens |
| Tab | The next group's first row; past the last group, focus moves on |
| Esc | Clear the query; with nothing typed, focus the tree |

Click is Enter, Ctrl+click is Ctrl+Enter.

## App shortcuts

Ctrl+N is New query: with a node selected that offers it, on that node, as before; otherwise an unconnected tab. Ctrl+Shift+N is New connection (once the engine is ready), Ctrl+I is Import (left to the editor, where it opens suggestions), Ctrl+P clears the selection and focuses Seek on the landing. None of them fire while a dialog is open.

## Usage

Kept in local storage under `panoptic.usage`, on this machine only, never sent anywhere:

- per environment, the last time a query tab was opened in it and how many times;
- the last place: the environment, connection and node of the last query tab opened;
- recent objects: places below connection level (a database, table, view, procedure or container), newest first, 20 kept.

Reopen last session and Pick up where you left off restore the **place only**: the tree focuses the environment and connection, selects the connection, and a new query tab opens on the node. No tabs or text are restored. Broken or missing storage just means an empty landing.

## Unconnected query tabs

New query with nothing chosen opens "Query N", not connected: the editor (plain text) and, above it, "Not connected - choose a connection" with Seek scoped to connections. Run is disabled and IntelliSense is off until connected. The last used connection is pre-selected but never connected automatically. Choosing one connects the tab in place: it keeps its title and text, the editor switches to the connection's language, and the catalog loads. See docs/query-editor.md.

## Colours

In `src/app/app.css`, no hex in components. `--brand-cyan` (`#24c8db`) and `--brand-amber` (`#ffc131`) are the icon's two colours, the same in both themes. `--landing-bg`, `--wordmark-faded`, `--kbd-bg` and `--kbd-border` take the design's values in the dark theme and are derived from existing tokens in the light one, so the page stays readable there. `--accent` (blue) is untouched.

## Interpretations

- "Nine rows max" counts selectable rows; the "N more, type to find" line is a hint, not a row (1 resume + 5 environments + 3 recent = 9).
- A recent object is any node a query tab was opened on below connection level, newest first, 20 kept.
- "opened in NNN ms" is launch to engine ready, the moment the landing becomes usable.
- "Do not use the word sidecar anywhere user-facing" covers the status bar and error texts too, not only the landing.
- Light theme: the new variables get derived light values; the spec's exact hexes are the dark values.

## Out of scope for this change

The Ctrl+P palette over open tabs, restoring tabs or their text, and indexing objects that have never been opened.
