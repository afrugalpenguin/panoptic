# Connections without an environment: implementation plan

> Execute task by task with superpowers:executing-plans, one commit per task, tests first for every pure module.

**Goal:** A connection's environment becomes optional. Connections are the primary object; environments are optional grouping, and an environment may have no connections. Issue #136.

**Architecture:** The sidecar store gains a top-level list of ungrouped connections next to the environments, and connection node ids lose their environment segment (`conn:<id>`), so moving a connection never changes its id: open query tabs, recent objects and expanded subtrees survive a move. The UI's pure modules (`tree-model.ts`, `seek.ts`, `usage.ts`, a new `env-picker.ts`) carry all the rules, unit tested first; Svelte components render and forward.

**Tech stack:** C# (.NET 10, xunit) sidecar, Svelte 5, TypeScript, vitest.

**Branch:** `feature/loose-connections`, from `feature/landing`. Rebase onto main once the landing PR merges. No stacked PR: open the PR against main only after that rebase.

---

## Decisions and interpretations

Taken while planning; restate them in the PR description.

1. **Store shape.** `AppConfig` becomes `(Environments, Connections)`, where `Connections` holds the ungrouped ones. A store written before this has no `connections` member and loads with an empty list. Environments keep their own `Connections` lists. `config.saveConnection` takes `environmentId: null` for ungrouped; giving another environment (or null) moves the connection, as moving between environments already did.
2. **Stable connection ids.** Every connection node is `conn:<id>` at the root of its path, whether grouped or not. Backends already work relative to a `start` index; it becomes 1. The tree model still knows each connection's parent (an environment node, or the root for ungrouped ones). Node ids are opaque to the UI, and nothing persists them except the landing's usage record, which is unreleased.
3. **Read-only is an environment property.** An ungrouped connection is never read-only. `QueryTarget.Environment` becomes nullable and the read-only guards check `Environment?.ReadOnly == true`.
4. **Deleting an environment** still deletes its connections (unchanged; the confirm says so). Ungrouping them instead is a possible follow-up.
5. **Empty environment row.** An environment with no connections cannot expand, so its "Empty - drag a connection here" row shows whenever the header is shown (a kind filter hides both).
6. **Ungrouped header** is collapsible and starts expanded. It and the connections under it get no environment colour: no bar, neutral washes. It can be selected (the detail pane says what it is) and is a drop target meaning "Remove from environment". The empty row is a drop target for its environment.
7. **Flat mode** (no real environments): ungrouped connections sit at the root with no header and a 10px connection indent instead of 30 (there is no group bar to clear); deeper rows add 20px per level as usual.
8. **Seek with loose hosts.** `SeekIndex.hosts` holds the ungrouped connections. Nothing typed: resume, environments (5 and a hint), ungrouped connections (5 and a hint, last used first, then name), recent objects (3); still 9 selectable rows at most. Typed: matching environments, then the top environment's matching hosts, then ungrouped hosts where every token is in the host's own name (best score first, then name), then recent objects from the top environment or from ungrouped hosts. With no environment matching, ungrouped hosts and their recent objects still show. Connections only scope: ungrouped hosts match on their own name only.
9. **A place's environment is looked up, not remembered.** Seek resolves each remembered place to its host's current environment (possibly none) and drops places whose host is gone. A moved connection keeps its recent objects under its new home.
10. **Landing line.** With real environments it is unchanged. With none: "Objects across all N connections. Type a table, container, proc or host.", "Objects across 1 connection. ..." when singular, and "No connections yet" at zero.
11. **Import picker.** Each group's target defaults to None. "New environment..." keeps import's current behaviour: a name field prefilled with the group's suggested name, and the environment is created only when Import runs, so cancelling creates nothing. In the connection dialog "New environment..." creates the environment at once (name field and Create) and selects it.
12. **Move to environment...** opens a small dialog with the same picker minus None and minus the connection's current environment. "Remove from environment" appears only on grouped connections.

---

### Task 0: Issue, branch, plan

Done while planning: issue #136, branch `feature/loose-connections` from `feature/landing`.
**Commit:** `docs(connections): plan for connections without an environment`.

---

### Task 1: Store holds ungrouped connections (sidecar)

**Files:** `apps/sidecar/Panoptic.Sidecar/Model.cs`, `ConfigStore.cs`, `Methods.cs` (import.scan existing set), tests in `Panoptic.Sidecar.Tests/StoreAndTreeTests.cs` (ConfigStoreTests).

**Step 1: failing tests** in `ConfigStoreTests`:
- `Connections_can_be_saved_without_an_environment_and_reload`: `SaveConnection(null, Sql("c1"), "pw")`; reload; `Config.Connections` has c1, `Environments` is empty, `GetSecret("c1") == "pw"`, `FindConnection("c1")` returns `(null, c1)`.
- `Moving_between_an_environment_and_none_keeps_one_copy`: save in dev, then null, then dev again; exactly one copy each time, in the right list.
- `An_environment_with_no_connections_is_kept`: save, reload, still there with no connections.
- `Deleting_an_ungrouped_connection_removes_it_and_its_secret`.
- `A_store_written_before_ungrouped_connections_loads_with_none`: write `{"config":{"environments":[]},"secrets":{}}` encrypted the way the corrupt-store tests write payloads; `Config.Connections` is empty, not null, and `RecoveredFrom` is null.

**Step 2:** `dotnet test apps/sidecar --filter ConfigStoreTests` fails to compile.

**Step 3: implement.**
- `AppConfig(List<EnvironmentConfig> Environments, List<ConnectionConfig>? Connections = null)` with `public List<ConnectionConfig> Connections { get; init; } = Connections ?? [];` (the `ExplorerSettings.EnvOrder` pattern).
- `SaveConnectionParams(string? EnvironmentId, ...)`.
- `ConfigStore.FindConnection` returns `(EnvironmentConfig? Environment, ConnectionConfig Connection)?`, searching environments, then the ungrouped list.
- `SaveConnection(string? environmentId, ...)`: an unknown non-null id still throws InvalidParams. Remove the id from every environment and from the ungrouped list, then insert at the old position if it stays where it was, else append to the target list.
- `DeleteConnection` also filters the ungrouped list. Every rebuilt `AppConfig` keeps the ungrouped list (`_file.Config with { Environments = envs }`).
- `Methods.cs` import.scan: the already-added set includes `store.Config.Connections`.

**Step 4:** tests pass, whole sidecar suite still green.
**Commit:** `feat(store): connections without an environment`.

---

### Task 2: Stable connection node ids and the root listing (sidecar)

**Files:** `TreeService.cs`, `Model.cs` (`QueryTarget`), `NodePath.cs` (doc comment), `Backends/SqlBackend.cs` and `Backends/PostgresBackend.cs` (read-only checks), tests in `StoreAndTreeTests.cs`, `QueryTests.cs` and any other test that sends `env:.../conn:...` ids through TreeService or QueryService. Backend unit tests that pass their own `start` stay as they are.

**Step 1: failing tests** (TreeServiceTests):
- The root lists environments, then ungrouped connection nodes; a connection node's id is `conn:c1` both at the root and under `env:dev`.
- `env:dev` children are `conn:<id>` nodes; an empty environment node has `hasChildren: false` and `connectionCount: "0"`.
- `conn:c1` children delegate to the backend with start 1 (the existing `LastCall` assertion changes from 2 to 1).
- `ResolveTarget("conn:c1/db:Sales")` works grouped and ungrouped; ungrouped has `Environment == null`; `ScopeOf(...).Connection == "conn:c1"`.
- The old shape `env:dev/conn:c1` is InvalidParams.
- An unknown `conn:gone` is OperationFailed.
- QueryTests: ids change from `env:dev/conn:sql1/...` to `conn:sql1/...`.

**Step 2:** run, fail.

**Step 3: implement.**
- `QueryTarget(EnvironmentConfig? Environment, ...)`. Backends check `target.Environment?.ReadOnly == true`; the read-only messages use the environment's name only inside those branches.
- `ChildrenAsync`: root = environment nodes, then `store.Config.Connections` as connection nodes. `env:X` (one segment) lists that environment's connections; a deeper `env:` path is InvalidParams. `conn:X/...`: `store.FindConnection` (OperationFailed when gone), backend with start 1.
- `ResolveTarget`: path[0] must be `conn`; segments from index 1. `ScopeOf`: connection id `conn:<id>`. `InvokeAsync`: environment and connection nodes use `Nodes.InvokeDefault`; deeper ones go to the backend with start 1.
- `ConnectionNode(ConnectionConfig c, bool queryable)` builds `NodePath.Root.Child("conn", c.Id)`.

**Step 4:** `dotnet test apps/sidecar` green (integration tests skip without the dev databases; note which ran).
**Commit:** `feat(tree): connection ids without the environment`.

---

### Task 3: API types (UI)

**Files:** `apps/desktop/src/app/api.ts`, `App.svelte` (initial config, `connectionOf`).

No test (types). `AppConfig { environments; connections: ConnectionConfig[] }`; `saveConnection(environmentId: string | null, ...)`. `connectionOf` also searches `config.connections` and returns no environment there. `pnpm --filter @panoptic/desktop check` clean.
**Commit:** `feat(ui): connections without an environment in the API types`.

---

### Task 4: Tree model grouping (`tree-model.ts`)

**Files:** `apps/desktop/src/app/tree-model.ts`, `tree-model.test.ts`.

New exports: `UNGROUPED = "#ungrouped"`; row types `{ type: "group"; expanded; count }` (key UNGROUPED, rowKind `header`) and `{ type: "env-empty"; parentId }` (rowKind `leaf`); `RowBase.loose` (no environment colour); `selectableRow(row)` (false for `env-empty`); `envIds()` (root children that are environments); `dropTarget(row)` (an environment id for a header or its empty row, null for the Ungrouped header, undefined otherwise).

**Step 1: failing tests** (loader: root `[env:dev, env:empty, conn:a, conn:b]`, dev has `conn:c`):
- No environments at the root: rows are `conn:a`, `conn:b` only, depth 0, rowKind connection, indent 10, `loose`, no group row; children of an expanded `conn:a` indent 30.
- Mixed: dev header (and dev's connections when expanded), the empty environment's header then its `env-empty` row (not selectable), then the group row last with `gapBefore` 4 and count 2, then `conn:a`, `conn:b`, `loose`, depth 1, indent 30.
- Toggling UNGROUPED collapses and expands the group without a load; it starts expanded.
- Kind filter: the group shows only with a loose connection of that kind; an empty environment is hidden by any kind filter.
- `envOrder` sorts environments only; the group stays last.
- `envIds()` excludes loose connections; `expandEnvironments()` opens environments and the group and never loads a loose connection's children.
- `forgetConnections()` drops loose connections' loaded children too.
- `focus(undefined, "conn:a")` collapses environments and expands the group and `conn:a`; `focus("env:dev")` collapses the group.
- Labels: loose connections take part in the prefix and suffix computation.
- `dropTarget` as above.

**Step 2:** `pnpm --filter @panoptic/desktop test tree-model` fails.

**Step 3: implement** in `rows()`: split root ids into environments (ordered) and loose connections; visit environments as now, adding an `env-empty` row after a header whose `connectionCount` is "0"; then, with loose connections, visit them flat (no environments) or push the group row and, when expanded, visit them at depth 1. `buildLabels`, `expandEnvironments`, `forgetConnections` and `focus` use `envIds()` and treat root connections as listed.

**Step 4:** tests pass, existing ones unchanged.
**Commit:** `feat(tree): ungrouped connections and empty environments`.

---

### Task 5: Tree rendering, drag and the menu

**Files:** `Tree.svelte`, new `rows/GroupHeaderRow.svelte`, `rows/LeafRow.svelte` (the empty row's text), `DetailPane.svelte`, `App.svelte` (menu, move, preload callers, hint text), new `MoveDialog.svelte`.

No unit test (components); the rules are in Task 4's and Task 6's tests.
- Tree: keyboard and mouse selection skip rows `selectableRow` rejects. Connection rows drag with type `application/x-panoptic-connection` (the connection id), effect `move`; rows with `dragText` keep their copy drag. Headers, the group row and empty rows accept that type (dragover prevents default only when `dropTarget(row) !== undefined`), highlight while hovered, and call `onMoveConnection(connectionId, envId | null)`.
- Loose groups: the group element gets class `loose`, which removes the bar and uses `--text-muted` for the washes. No hex.
- GroupHeaderRow: chevron, "Ungrouped" dimmed, count.
- Empty row: muted "Empty - drag a connection here".
- App: `moveConnection(id, envId)` saves the connection under the new environment (secret null keeps it), then `configChanged`; no-op when unchanged. Connection menu: "Move to environment..." (MoveDialog) and, when grouped, "Remove from environment". `model.preload(model.envIds())`. The tree hint becomes "No connections yet." and shows only with no environments and no connections.
- DetailPane: the group row shows "Ungrouped" and "Connections not in an environment."

**Verify:** `pnpm check`, `pnpm test`.
**Commit:** `feat(tree): drag connections between environments`.

---

### Task 6: Environment picker (`env-picker.ts`) and the connection dialog

**Files:** create `apps/desktop/src/app/env-picker.ts`, `env-picker.test.ts`, `EnvPicker.svelte`; modify `ConnectionDialog.svelte`, `MoveDialog.svelte`, `App.svelte` (`addConnection`, toolbar, landing, environment menu).

**Step 1: failing tests:**
- `pickerOptions(envs)`: None (`NO_ENV`), the environments in config order, then "New environment..." (`NEW_ENV`); `{ none: false }` drops None; `{ exclude: id }` drops that environment.
- `toEnvironmentId(value)`: NO_ENV gives null, an id gives the id.
- `newEnvironment(name, existing)`: trims; empty gives an error; a name matching an existing environment (case-insensitive) returns that one; otherwise a new `EnvironmentConfig` styled by `envStyleFor(name, existing.length)` with no connections.

**Step 2:** fail. **Step 3:** implement; `EnvPicker.svelte` renders the select and, for NEW_ENV, a name field and Create, which saves the environment, hands the new config up (`onCreated`) and selects it.

ConnectionDialog: `environmentId?: string | null`, default None; editing starts on the connection's environment or None; save passes `toEnvironmentId`. App: `addConnection(envId?)` always opens the connection dialog, never the environment dialog; the toolbar's add icon, the landing's New connection, Ctrl+Shift+N and an environment's "New connection..." (preselected) all use it.
**Step 4:** tests, `pnpm check`.
**Commit:** `feat(connections): environment picker defaulting to None`.

---

### Task 7: Import target picker

**Files:** `ImportDialog.svelte`.

Each group's select uses `pickerOptions(config.environments)`; default NO_ENV; NEW_ENV shows the name field (prefilled with the group's name), created on Import as now; NO_ENV saves with no environment. The intro becomes: "Groups marked suggested come from your server naming pattern; put them in an environment or leave them ungrouped."
**Verify:** `pnpm check`, `pnpm test`.
**Commit:** `feat(import): target environment defaults to None`.

---

### Task 8: Seek and usage

**Files:** `seek.ts`, `seek.test.ts`, `usage.ts`, `usage.test.ts`, `SeekBox.svelte`, `Landing.svelte`, `App.svelte` (`seekEnvs`, `placeFor`, `reopen`, `seekQuery`, `connectTab`).

**Step 1: failing tests.**
usage: `recordUse` with no `envId` records `last` and the recent object and leaves `envs` alone.
seek:
- `liveUsage(index)`: a place whose host is gone is dropped; a place whose host moved gets the host's current `envId` (or none).
- Nothing typed, flat: resume, up to 5 hosts and a hosts hint, then recent; 9 selectable at most; no environment rows.
- Nothing typed, mixed: environments, then ungrouped hosts, then recent.
- Typed "orders" with an ungrouped `orders-sql`: a host row with no environment. Typed "prod" does not match an ungrouped `uk-sql` (environment names never count for ungrouped hosts).
- Typed with no environment matching still returns matching ungrouped hosts.
- Connections scope: an ungrouped host matches only on its own name.
- `seekSummary(envCount, connectionCount)`: the landing line in all four cases.

**Step 2:** fail. **Step 3:** implement. `SeekHost.envId?`; host rows `env?`; `more` rows carry `group: "envs" | "hosts"`; `SeekIndex.hosts`. SeekBox shows no environment for an ungrouped host, and a place path without an environment segment. Landing takes `connectionCount` and uses `seekSummary`. App builds `hosts` from the root's connections; `placeFor` needs only a host; `reopen` uses the live place's environment; an ungrouped host's look is no colour and not read-only.
**Step 4:** tests, `pnpm check`.
**Commit:** `feat(landing): Seek and usage for connections without an environment`.

---

### Task 9: Preview states

**Files:** `apps/desktop/src/preview/main.ts`, new `apps/desktop/src/preview/Preview.svelte`.

`?state=flat|mixed|empty-env` (default: the landing alone, as today) mounts the real `Tree` beside the `Landing`, with a `TreeModel` fed by a synthetic loader: flat (four ungrouped connections, no environments), mixed (two environments and two ungrouped), empty-env (one environment with no connections and two ungrouped). Synthetic names only; ids use the `conn:` shape.
**Verify:** `npx vite` in apps/desktop, capture each state with headless Chrome into `docs/images/landing/flat.png`, `mixed.png`, `empty-environment.png`.
**Commits:** `chore(landing): preview states for ungrouped connections`, then `docs(landing): screenshots of ungrouped connections`.

---

### Task 10: Docs and fragment

**Files:** `docs/explorer-ux.md` (principles: connections first, environments optional; grouping rules; the Ungrouped header; the empty row; drag, Move to environment..., Remove from environment), `docs/landing.md` (New connection opens the dialog directly; the landing line; Seek with ungrouped hosts; stale usage by host), `changes/loose-connections.md`:

```
Added: connections no longer need an environment. New connection asks for one but defaults to None, and can create one on the spot; import does the same. Ungrouped connections fill the tree when you have no environments, or sit under Ungrouped at the bottom when you do. Drag a connection onto an environment, or use Move to environment and Remove from environment, to regroup it. An environment can now be empty.
```
**Verify:** grep the diff for "sidecar" in user-facing text, hex in components, and dashes other than hyphens.
**Commit:** `docs(connections): grouping rules, empty environments and drag`.

---

### Task 11: Verify and hand over

`pnpm test` at the root (svelte-check, vitest, dotnet test). Push the branch. The PR waits until the landing PR merges and this branch is rebased onto main (no stacked PRs); then PR with `Closes #136`, label enhancement, assignee me, the interpretations above and the screenshots, and check the PR head SHA matches local and CI ran on it.
