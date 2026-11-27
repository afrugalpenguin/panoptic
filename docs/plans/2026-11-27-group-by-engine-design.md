# Group connections by engine (#385)

## Goal

Inside each environment, the Ungrouped group and the flat no-environment list, connections of the same engine sit
together. The order within an engine stays the manual one.

## Setting

`explorer.groupByEngine`, bool, default true. Settings shows it as "Group connections by engine" beside the badge
checkbox. Off gives today's purely manual order.

## Behaviour

- Display only. The tree stable-sorts each group's connections by engine, engines in the order the sidecar registers
  them (`kinds.ts`); an unknown engine sorts last. The saved config order is never rewritten, so switching the setting
  off restores exactly the order there was.
- No sub-headers, no extra rows, no indent change.
- The environment detail pane lists connections in the tree's order, so it follows the setting too.

## Reordering while on

A connection's group, for every reorder path, is the connections of its own engine in its environment (or none), in
config order:

- Drag onto another connection shows a drop line only when both are the same engine. Drop on an environment header,
  its empty row or the Ungrouped header still moves it there, landing at the end of its engine's block.
- Move up / Move down (menu, connection pane, Alt+Up/Down) step within the engine block and are off at its ends; the
  connection pane's position reads "n of m" within the block.

The backend needs nothing new: inserting before a same-engine connection in config order keeps the right position in
that engine's subsequence (`[S1, C1, S2]`, S3 before S2, gives S1, S3, S2), and "last" appends.

## Unchanged

Engine and text filters, label prefix/suffix detection, environment order, Seek.

## Tests

- `tree-model.test.ts`: rows sorted on and off; manual order kept within an engine; flat and Ungrouped lists;
  `connectionGroup` narrowed to the engine; `envConnections` follows the setting.
- `row-menu.test.ts`: Move up/down limits within the engine block.
- Sidecar `StoreAndTreeTests`: the setting defaults true and round-trips.
- Settings dialog browser test: the checkbox saves.
