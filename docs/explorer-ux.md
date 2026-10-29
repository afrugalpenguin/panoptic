# Explorer UX spec

Decided 29 Oct 2026. Mockups: Panoptic explorer mockups canvas (artboards B and L1).

## Principles

- Environment is the primary axis. Every kind (SQL, Cosmos, Synapse, Postgres) sits inside its environment group. There is no kind-first grouping.
- One tree, one row component. No per-kind row renderers. Backends supply nodes; the tree draws them.
- Everything the row needs is precomputed when the tree model changes. Render reads fields, it never computes labels, prefixes or icon visibility.
- Fixed row heights per level so the virtualiser can multiply. Header 26px, connection 24px, folder and leaf 22px.
- Settings changes re-render the tree once. No restart, no sidecar call.

## Layout

Toolbar (40px): `EXPLORER` label left, icon buttons right (Import, New environment, New connection, Settings). Icons replace the current text buttons.

Kind filter row (32px, below toolbar): one chip per kind present in the tree plus `All`. Chip shows kind badge, kind name and connection count. Clicking a chip filters the tree to that kind; `All` clears. The row is not rendered when only one kind exists. Chips are derived from the loaded connections, never a hard-coded list.

Tree below, virtualised, env groups separated by a 4px gap.

## Environment group header (26px)

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

No layout mode setting. L2 (kind tabs) and L3 (stacked sections) are rejected.

## Out of scope for this change

Display-name aliases, pipeline ordering with an Other divider, region chips. All on the canvas, all rejected or deferred.
