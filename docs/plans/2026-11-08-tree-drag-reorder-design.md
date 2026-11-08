# Reorder the explorer by drag and drop (#63)

## What exists

- Dragging a connection onto an environment header, its empty row or the Ungrouped header moves it there (#142). It is appended to the end.
- Moving a connection out of a read-only environment asks first ("Leave read-only"). Moving into one does not ask, because it only adds protection.
- Environments have Move up and Move down on their context menu, which saves `explorer.envOrder`.
- Connection node ids are `conn:<id>`, with no environment in them, so open query tabs survive a move without rebinding.
- `config.saveConnection` keeps a connection's position when it is edited in place, and appends it when it moves.

## What this adds

1. **Reorder connections by dragging.** Dropping a connection on another connection row places it before or after that row: the upper half of the row means before, the lower half after. This works within an environment, across environments, and in Ungrouped. A 2px accent line at the row's indent shows where the connection will land. Dropping on a header or an empty row still appends and outlines the target, as today.
2. **Reorder environments by dragging their headers.** Dropping an environment header on another environment header places it before or after that header, by the same half-row rule, and saves `explorer.envOrder`. Ungrouped is always last and is not a target for environment drags.
3. **Keyboard equivalents.** Alt+Up and Alt+Down move the selected environment, or the selected connection within its group, up or down one place. Connections also get Move up and Move down on their context menu, matching environments. Moving to another environment stays with Move to environment... and dragging.
4. **Cancel.** Escape during a drag cancels it (native HTML5 behaviour). The indicator clears on `dragend` whether or not a drop happened. A drop on an invalid target does nothing.
5. **Selection follows.** After a move, the moved row stays selected and scrolled into view.

The read-only rule is unchanged: only leaving a read-only environment asks. Reordering within one environment never asks.

## Sidecar

New method `config.moveConnection { connectionId, environmentId: string | null, beforeId: string | null }`, which returns the `AppConfig`. `ConfigStore.MoveConnection` removes the connection from wherever it is and inserts it before `beforeId` in the target list. It appends when `beforeId` is null or not in that list. Moving a connection before itself does nothing. It does not touch secrets or run the duplicate check, because the connection itself does not change. An unknown connection or environment is an invalid-params error, as in `SaveConnection`.

Passing a neighbour's id rather than an index keeps the move correct when the tree is filtered and hides some connections. The UI works out "after X" as "before X's next sibling in the config", or null if X is last.

The existing drag onto a header moves through `moveConnection` with `beforeId: null`, instead of re-saving the whole connection.

## UI

- `tree-model.ts` gets pure helpers that take the hovered row, whether the pointer is in its upper half, and the drag kind, and return the drop: a connection target `{ environmentId, beforeId }` or an environment `envOrder`, or nothing. Unit tests cover them.
- `Tree.svelte`: environment headers become draggable with their own MIME type. Rows get `drop-before` and `drop-after` classes for the line, cleared on `dragleave`, `drop` and `dragend`. Alt+Up and Alt+Down raise move events.
- `App.svelte`: `moveConnection` takes the optional `beforeId` and keeps the read-only confirm. A new reorder path for environments reuses `moveEnv`'s save.
- `row-menu.ts`: connections get Move up and Move down, disabled at the ends of their group.
- Docs: update `docs/explorer-ux.md` (Grouping, plus the line that says drag and drop is #31), and add a change fragment.

## Tests

- Sidecar: `MoveConnection` before a sibling, append, across environments, to and from loose, before itself, unknown ids, secrets kept.
- UI unit tests: drop helpers, menu items enabled and disabled at the ends, `envOrder` result.
- Browser tests: dragging a connection between two rows shows the line and lands in the right place, an environment drag reorders, Escape or `dragend` clears the line, and Alt+Up and Alt+Down work.
