# Panoptic - Build Plan

Oct 29, 2026 · @Mac

## What it is

A native, instant-start workbench whose core is one object explorer that holds every environment at once: dev, UAT, prod, client sandboxes, SQL Server and Cosmos side by side, same node shape all the way down. Everything else (query editor, results grid, agent handoff) hangs off a selected node. The target feel is SSMS's tree with Zed's responsiveness: window open in under 500 ms, any node expanded in under 300 ms, 100k-row grid scrolling at 60 fps.

Panoptic is a platform-agnostic SSMS replacement: the tree, query pane and grid that SSMS gives you for SQL Server, for every engine and every environment at once, at native speed. It earns its place by doing that well, not by adding features SSMS lacks.

**Non-goals for v1**

- Any SQL Server admin surface: Agent, security, backup/restore, maintenance plans. Deep link to SSMS for those.
- A general-purpose code editor. Monaco is embedded for the query pane only.
- Write-heavy data editing. Read, query and export; inline edits can come later behind a safe-mode gate.
- Personal data of any kind: server names, tenants, credentials, connection details. The core stays generic, and personal data never touches this repository.
- Mac and Linux builds. The stack supports them for free, but Windows is the only tested target until v1 ships.
- Cross-environment diff (pick the same object in two environments and compare them). A good idea, but not core: a possible plugin once SSMS is no longer needed, and nothing before v1 depends on it.

**Name**

Panoptic: seeing everything from one position. The Ctrl+P palette inside it is called Seek, after the index seek, because it finds one object across every environment in a keystroke.

## Decisions already made

| Decision | Choice | Why |
| --- | --- | --- |
| Stack | Tauri 2 shell, TypeScript UI with Monaco, .NET 10 sidecar for data access | Microsoft.Data.SqlClient and the Cosmos .NET SDK are the only mature drivers with Entra auth. The TS UI reuses Angular-era skills. Tauri gives Mac later with no rework. |
| v1 scope | SQL Server, Cosmos and Synapse under one tree; other engines later | The multi-backend tree is the only part no vendor sells. Proving the node model on two very different backends early stops it becoming SQL-shaped. Synapse SQL pools speak TDS, so they reuse the SQL Server backend with their own catalog differences (external tables, no keys on serverless). |
| Repo | Personal GitHub (afrugalpenguin), open source, MIT | Generic tool, portfolio piece. Personal data never touches this repository. |
| UI framework | Svelte 5 with a hand-written virtualised tree and grid | Decided in M0 (ADR 0004): plain TS and Svelte tied at 60 fps on the benchmark, so Svelte wins on productivity for the rest of the UI. |
| Sidecar protocol | JSON-RPC 2.0 over stdio, Tauri sidecar lifecycle | No ports, no CORS, no firewall prompts on the work laptop. Streaming result sets as batched notifications. |
| Query editor | Monaco | Already does T-SQL highlighting; Cosmos SQL grammar added as a custom language. |
| Auth | Entra (MSAL.NET) first, SQL auth second, key-based Cosmos third | Matches how the target Azure SQL and Cosmos are actually reached. Tokens cached per connection by the sidecar, never written to disk unencrypted. |
| Connection store | Encrypted local file, OS keychain for secrets | Export and import as a single file so the dotfiles repo can carry it. |
| Telemetry | None | Fail-closed on anything that phones home. |
| Distribution | Per-user NSIS installer on GitHub Releases, Tauri updater plugin checks on launch | The work laptop is the real test bed; it must pick up every build without manual installs. The update check is the one outbound call and goes only to GitHub Releases. |
| Code signing | Unsigned (Authenticode) in M0, updater payloads signed with a Tauri updater key | Prove SmartScreen and Intune behaviour first; buy a certificate or Azure Trusted Signing only if install is blocked or before v1. |
| Cross-environment diff | Not in v1 and not core; later, as a plugin | Panoptic is an SSMS replacement, not a comparison tool. The node contract makes a diff plugin cheap to add later, so nothing is lost by waiting. |

## Prior art

Nothing ships the full combination of native speed, an environment-first tree, and SQL Server and Cosmos at equal depth. The nearest is DBeaver's paid editions, which put SQL Server and Cosmos NoSQL in one navigator, but Cosmos there is read-only with a SELECT, FROM, WHERE subset and no indexing policies, procs or triggers in the tree, and the whole thing is an Eclipse Java app. Not an option here on cost or speed.

| Tool | Multi-connection tree | SQL Server | Cosmos | Native and fast |
| --- | --- | --- | --- | --- |
| SSMS | Yes, the benchmark | Full | No | No |
| mssql extension (VS Code) | Connection groups | Good, read and query | No | No, Electron |
| TablePlus | No, tab per connection | Good | No | Yes |
| DataGrip | Yes | Good | Third-party JDBC driver only | No, JVM |
| DBeaver paid | Yes | Good | Read-only, shallow | No, Eclipse |
| CosmosDbExplorer | Named DEV/QA/PROD connections | No | Full CRUD | Yes, WPF |

The differentiators to lead with are speed and Cosmos as a first-class citizen. The multi-environment tree is necessary but not unique.

Sources: [DBeaver Cosmos NoSQL driver](https://dbeaver.com/docs/dbeaver/Database-driver-Azure-CosmosDB-for-NoSQL/), [DataGrip Cosmos thread](https://intellij-support.jetbrains.com/hc/en-us/community/posts/360000404120/comments/360000749800), [CosmosDbExplorer](https://github.com/sachabruttin/CosmosDbExplorer), [TablePlus sidebar](https://docs.tableplus.com/gui-tools/the-interface/left-sidebar), [mssql extension v1.46](https://devblogs.microsoft.com/azure-sql/?p=7650).

## The tree

The tree is environment-first, and every backend presents the same node contract, so the UI never knows whether it is drawing SQL Server or Cosmos. A node is `{ id, kind, label, icon, hasChildren, actions[], meta }`; a backend provides `children(nodeId)`, `actions(nodeId)` and `invoke(nodeId, actionId)`.

**Hierarchy**

1. Environment (dev, UAT, prod, a client sandbox): a colour band and a name, user-defined, with an optional read-only flag that disables every write action beneath it.
2. Connection: a SQL Server instance, a Cosmos account or a Synapse SQL endpoint (dedicated or serverless). Several per environment.
3. SQL Server: Databases, then per database Tables, Views, Programmability (procs, functions, types), Synonyms, Security (read-only listing only). Synapse: as SQL Server, plus External tables. Cosmos: Databases, then per database Containers, then per container Items (sampled), Indexing policy, Stored procedures, Triggers, UDFs, Partition key and throughput as leaf properties.
4. Leaf objects: Table has Columns, Keys, Indexes, Constraints, Triggers; Proc and View have a Definition leaf that opens in Monaco read-only.

**Behaviours that make it fast**

- Lazy load everything below Connection. A node fetches its children on first expand, caches them, and shows a stale marker after a configurable age rather than refetching on every expand.
- One catalog query per expand, never one per child. SQL Server children come from `sys.objects` joined to `sys.schemas` with a single round trip; Cosmos from `ReadContainerAsync` and the SDK's feed iterators.
- Virtualised rendering. The tree only draws visible rows; 50k nodes must not cost more than drawing the roughly 500 rows on screen.
- Filter as you type, scoped to the selected subtree, matching on name, schema and object type. Filters are saveable and apply per environment or globally, like the mssql extension's saved filters but across every connection at once.
- Keyboard first. Arrow keys, type-to-jump, Enter to open the default action, and Seek (Ctrl+P), the palette that searches every loaded node across every environment.
- Right-click actions come from the backend, not the UI: Select top 1000, Script as CREATE, Open definition, Copy name, Send to agent. The list grows without touching the tree component.

## Architecture

&#91;embedded content: architecture · Tauri shell, .NET sidecar, three external systems\]

The two accented boxes are the whole design: the tree draws nodes, the node contract supplies them, and everything backend-specific sits behind that one interface in the sidecar.

The UI holds no connection strings, tokens or SQL. It asks the sidecar for nodes, actions and result batches over JSON-RPC and renders what comes back. The sidecar owns connections, auth and the catalog queries. A crashed sidecar is restarted by Tauri and the UI shows every connection as disconnected until it answers `ping` again.

Result sets stream as notifications of 500-row batches so the grid paints the first rows before the query finishes; the UI can cancel mid-stream and the sidecar cancels the command. The shared node model package is generated from the sidecar's C# records at build time so the two sides cannot drift.

## Milestones

&#91;embedded content: milestones · M0 to M4, v1 at the end of March 2027\]

Each milestone has one definition of done, and the next one does not start until it is met on the work laptop, not just at home.

- **M0 Measure.** Numbers in `docs/benchmarks.md` for cold start, tree and grid frame times, Entra sign-in, and a per-user installer on the work laptop that auto-updates from GitHub Releases. ADRs written for the UI framework choice.
- **M1 Tree.** Two SQL Server connections and one Cosmos account under one environment node, lazy-loaded through the node contract, every expand under 300 ms, nothing else on screen. If this is not enjoyable to click around, stop here.
- **M2 Query and grid.** Monaco query pane bound to the selected connection, streamed results, cancel, CSV and JSON export, Cosmos SQL as a Monaco language. Select top 1000 on any table or container.
- **M3 Filters, actions.** Type-to-filter scoped to a subtree, saved filters, the Ctrl+P palette across every loaded node, Script as CREATE, Open definition, Copy name, read-only environment flag that disables writes.
- **M4 Agent, packaging.** Send to agent (schema plus sample rows to Claude Code or Copilot CLI via a configurable command), connection export and import, Authenticode-signed installer, README with screenshots, v1 tag. (Auto-update moved to M0.)

## Risks and the cheap tests that retire them

| Risk | Why it matters | Test (M0, before any real code) |
| --- | --- | --- |
| Sidecar start-up time blows the 500 ms budget | .NET cold start plus MSAL init could be 1 to 2 s on the work laptop | Measure a hello-world .NET 10 sidecar started by Tauri, with and without ReadyToRun and trimming. Show the window first and connect the sidecar in the background if needed. |
| Tauri webview on Windows is slow or inconsistent | WebView2 is Chromium, so this is the Electron question again | Render a 50k-row virtualised tree and a 100k-row grid in a bare Tauri window and measure frame times with the devtools profiler. |
| Entra auth from a sidecar on an Intune-managed laptop | Broker-based sign-in may need WAM, which may be blocked or need elevation | Run MSAL.NET with the WAM broker from a console app on the work laptop. If it fails, device-code flow is the fallback and is still fine for a dev tool. |
| Cosmos object listing is slower than SQL | Each container needs separate calls for policy, procs, triggers | Time `GetContainerQueryIterator` plus per-container reads on a real account; cache aggressively and expand lazily. |
| Scope creep toward rebuilding SSMS | Every right-click menu item is a day | Every action must come from the backend's `actions()` list and have a deep link fallback. Anything admin-shaped is refused by the non-goals. |
| It joins the pile of unfinished tools | Honest risk given the project count | M1 is a tree that shows two SQL servers and one Cosmos account and expands in under a second, nothing else. If that milestone is not fun to use, stop. |
| Corporate install | Can't run on the work laptop, so never gets daily use | Tauri builds a per-user NSIS installer with no elevation (its MSI is per-machine only). Verify on the current laptop in M0; if blocked, ask for an Intune EPM rule early. |

## Repo setup and conventions

- `afrugalpenguin/panoptic`, MIT, public from the first commit. Personal git identity, global commit-msg hook stays on, no attribution trailers.
- Monorepo: `apps/desktop` (Tauri + TS), `apps/sidecar` (.NET), `packages/node-model` (shared TypeScript types for the node contract, generated from the .NET records so the two sides can't drift), `packages/backends-sql`, `packages/backends-cosmos`.
- Conventional commits, `type(scope): description`, 72-char subject. Scopes: `tree`, `grid`, `editor`, `sidecar`, `sql`, `cosmos`, `auth`, `build`.
- Feature branches and PRs from day one, even solo. CI on GitHub Actions: Windows build, sidecar unit tests, a Playwright smoke test that opens the window and expands a fixture tree.
- Fail closed: every write action is off until the connection is marked writable; every network call has a timeout; the sidecar dying puts the UI into an obvious disconnected state rather than hanging.
- Observable progress: every long operation reports through the status bar with an elapsed timer and a cancel.
- PowerShell for all scripts under `scripts/`, Windows paths in docs.
- `docs/adr/` with one ADR per row in the decisions table above, written before the code that depends on it.

## First session: what to hand Claude Code

The first session is M0 and nothing else. It produces measurements, not features, and the plan above survives or changes based on what comes back.

- [ ] Create afrugalpenguin/panoptic with the monorepo layout, licence, README stub, commit hook check, CI skeleton.
- [ ] Scaffold Tauri 2 with a TypeScript front end and a .NET 10 console sidecar wired over stdio JSON-RPC. One round trip: UI sends `ping`, sidecar answers with its start-up time.
- [ ] Measure cold start on the work laptop and the home machine: window visible, sidecar ready. Record both numbers in `docs/benchmarks.md`.
- [ ] Render a synthetic 50k-node virtualised tree and a 100k-row grid from fixture data. Record frame times. Decide Svelte versus plain TS on these numbers and write the ADR.
- [ ] Prove Entra sign-in from the sidecar on the work laptop (WAM broker, device-code fallback). Record which worked.
- [ ] Connect to one real SQL Server and one real Cosmos account read-only, list databases through the node contract, and show them under one fake environment node.
- [ ] Tag-triggered release workflow: per-user NSIS installer plus signed updater manifest on GitHub Releases. Install once on the work laptop, then confirm it updates itself to the next tag.

Prompt to paste:

```markdown
You are starting M0 of Panoptic, a native multi-environment object explorer for SQL Server and Cosmos DB. Read docs/plan.md first; it is the source of truth. M0 is a measurement milestone: scaffold Tauri 2 + TypeScript + a .NET 10 stdio JSON-RPC sidecar, then produce the benchmarks and ADRs listed under "First session" in the plan. Do not build features. Record every number in docs/benchmarks.md with the machine and date. Work on a branch, open a PR per task, conventional commits, no attribution trailers. Windows is the only target; all scripts are PowerShell. If any measurement breaks a budget in the plan, stop and say so rather than working around it.
```
