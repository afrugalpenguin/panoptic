# State of Panoptic - 2026-10-31

Reviewed: `main` at `2994ed6`. This is a review only: no source files were changed. Method: six independent deep dives (architecture, correctness, security, UX, design, performance), each run against the real code and, where possible, the real app on the synthetic dev-seeded store and the local Docker databases. Key claims were then re-checked by hand. Claims re-checked by the orchestrator are marked **(re-checked)**. Every other finding comes from the area reviewer, with the evidence it reported.

All six sections are complete, with these gaps:
- **Read-only bypasses:** run live on SQL Server only. Postgres relies on the passing integration tests.
- **Entra sign-in:** not exercised (no tenant).
- **What's new and the dialogs:** contrast computed from token values, not from rendered pixels.
- **Large estates:** 30+ environments and 50k-node estates were not measured in the shipped tree.

No real environment, host, tenant or object names appear here. Examples use Fabrikam-style placeholders.

## Verdict

The engineering core is better than most projects at this stage:
- build, typecheck, clippy and 774 tests (439 vitest, 335 dotnet) are clean
- the sidecar talks to engines only through one contract
- secrets are DPAPI-protected and never return to the webview
- startup is inside budget at 414 ms to first paint

The product is less trustworthy than it looks, though.

**The read-only guard.** It is the feature that makes it safe to point this at production, and it lets a write through with nothing more than `COMMIT;` at the start of a batch. The README describes it more strongly than the code delivers.

**The dev loop has been blind for SQL Server.** Every SQL Server expand in `pnpm dev` fails because the dev sidecar ships without its native DLL (#167). Because the UI drops inner exceptions, the error never said why.

**The fast path to one environment breaks at the hand-off.** Seek finds the environment, then drops keyboard focus, and `Ctrl+P` stops working once any tab is open.

**Cosmos.** The first expand takes 2.25 s against a 300 ms budget, and there is no warm-up of any kind.

**Engine knowledge in the UI.** The plugin boundary holds in the sidecar but not in the UI: engine names, auth options and engine error codes are hard-coded in about eight UI files.

None of this is structural rot. All of it is fixable in weeks. But the next block of work should go on making the existing promises true before adding surface.

## Top 10 issues by impact

| # | Issue | Severity | Evidence | Fix |
|---|---|---|---|---|
| 1 | **Read-only guard lets writes through after a `COMMIT`, `ROLLBACK` or `EXEC('COMMIT')` in the same batch** | High | Guard: `SqlBackend.cs:157-212`. The check is per batch, not per statement (`:237-245`). Live on Docker SQL Server, scratch table of 3 rows **(re-checked)**:<br>- control `BEGIN TRAN; DELETE; ROLLBACK` leaves 3 rows<br>- `BEGIN TRAN; COMMIT; DELETE` leaves 0<br>- `ROLLBACK; DELETE; BEGIN TRAN` leaves 0 with `@@TRANCOUNT` back at 1<br>- `EXEC('COMMIT'); DELETE` raises error 266 but leaves 0<br>`README.md:47-49` says a COMMIT "stops the run". `plan.md:64` says read-only "disables every write action". | In read-only environments, refuse to run text containing transaction-control statements or dynamic SQL before sending it, using the batch splitter's tokenizer. Rewrite the README to say it is a rollback guard, and recommend a read-only login for real protection. |
| 2 | **Dev sidecar has no native DLLs, so every SQL Server expand fails in `pnpm dev`** (#167) | High | `build-sidecar.ps1`: `fdd` mode omits `IncludeNativeLibrariesForSelfExtract` and copies only the exe. `artifacts\fdd` holds `Microsoft.Data.SqlClient.SNI.dll` and `msalruntime.dll`; `binaries\` holds only the exe. Same exe, same `connection.test`: alone gives `ok:false` "type initializer for TdsParser", and with the SNI DLL beside it gives `ok:true` in 162 ms **(re-checked)**. | Bundle or copy the native DLLs in `fdd` mode. Add a CI smoke test that runs `connection.test` with the dev-built exe. Fix in progress on `fix/dev-sidecar-native-dlls`. |
| 3 | **A saved password follows an edited connection to a new host** | Medium (security), ranked high for blast radius | `Methods.cs:95` `args.Secret ?? store.GetSecret(args.Connection.Id)` takes the endpoint from the client but the secret from the store **(re-checked)**. Same pattern on save (`ConfigStore.cs:134-138`). `ConnectionDialog.svelte:110-111`: a blank password on edit keeps the stored one. | Reuse a stored secret only when kind, endpoint, user and auth match the stored connection. Clear the password field when any of them change. |
| 4 | **A store that decrypts but has `"connections": null` crashes the sidecar on every start** | High | `ConfigStore.cs:207` validates only `Environments` and `Secrets`. The constructor's `Orphans()` (`:23`, `:174`) runs outside the recovery block, so the file is never moved aside **(re-checked)**. The user sees only "database engine exited 5 times in a row" (`lib.rs:178`), because stderr goes to `eprintln!` (`lib.rs:217-218`). | Validate the whole shape inside the recovery try block. Show the sidecar's last stderr lines in the UI when it gives up. |
| 5 | **Integration tests are not required checks, and release does not wait for CI** | High (process) | Ruleset: required checks are `ui`, `sidecar`, `shell` and `fragment`, with `strict:false` **(re-checked via `gh api`)**. `sidecar-sql` and `sidecar-pg` are not required. `release.yml:9-15` runs on every push to main with no `needs`. | Make `sidecar-sql` and `sidecar-pg` required and turn `strict` on. This keeps "PR CI is the only gate" and fast releases, while making that gate real. |
| 6 | **No background warm-up. The first Cosmos expand takes 2.25 s against a 300 ms budget** | High (perf) | Median 2249.7 ms over 7 in-app runs, the same under JIT and R2R; a raw GET to the emulator takes 8 ms. No "warm" anywhere in the code or the history of any branch **(re-checked)**. `IBackend.cs:11-42` has no warm-up member. | Add a no-op-by-default `WarmUpAsync` to `IBackend`, called after ping for the connections in recently used environments. This also hides the ~100 ms of SQL and Postgres JIT on first expand. |
| 7 | **Result sets are unbounded** | High (perf) | `store.svelte.ts:428` pushes every row **(re-checked)**. `QueryService.cs` has no cap. 1M rows: renderer 1,197 MB, JS heap 545 MB, app total 1.59 GB. | Add a per-set row cap setting with "fetch more" or "save to file", and stop the reader on the server side. |
| 8 | **Seek's hand-off breaks the "one environment fast" path** | High (UX) | After Enter in Seek, focus drops to `body` (`App.svelte:516-524`; the Landing unmounts at `:681`). `Ctrl+P` with any tab open clears the selection and returns (`App.svelte:583-584`) **(re-checked)**. | Focus the explorer on the found environment after Seek. Make Seek an overlay available from anywhere. |
| 9 | **The query tab's database picker shows a database the tab is not using** | High (UX, matters on read-only production) | A tab opened on a connection has no database: `databaseOf` returns `undefined` (`store.svelte.ts:211-212`), so the `<select value={database}>` (`QueryView.svelte:115`) shows its first option **(re-checked)**. Live: the picker read "inventory" while `select current_database()` returned "postgres" (UX shot 28). | Show the resolved default database, or add an explicit "(default)" option. |
| 10 | **The release job exposes the updater signing key to tag-pinned third-party actions** | Medium (security) | `release.yml` uses `tauri-action@v1`, `rust-cache@v2`, `rust-toolchain@stable` and `pnpm/action-setup@v6`, with `TAURI_SIGNING_PRIVATE_KEY` and job-wide `contents: write`. | Pin every action to a commit SHA. Dependabot already tracks actions. |

The next five, in brief:
- Keyboard shortcuts fire behind open dialogs (`App.svelte:561-568` runs the node shortcut before the dialog guard, **re-checked**).
- `Ctrl+Shift+N` opens a query tab because `shortcutAction` ignores Shift (`node-menu.ts:32-35`, **re-checked**).
- Footer buttons are dead to Enter and Space (`Tree.svelte:197-219`).
- Raw .NET errors are shown with the inner exception dropped (`TreeService.cs:39`, `NodeErrors.cs:9-10`).
- The explorer filter input collapses to 18 px between 400 and 480 px of panel width.

## Security findings

Threat model: a developer's Windows machine holding production database credentials. Nothing Critical, no injection path found.

| Severity | Finding | One-line exploit scenario | Evidence | Fix |
|---|---|---|---|---|
| High | Read-only guard bypass (top issue 1) | A pasted deployment script with `COMMIT` mid-batch writes to a production database marked read-only. | Above | Above |
| Medium | Stored secret follows an edited endpoint (top issue 3) | The user edits a production SQL-login or Postgres connection to a lookalike host, or turns on Trust server certificate, and clicks Test: the password is sent there with no prompt. Npgsql has no `RequireAuth`, so a host asking for cleartext auth receives it as is. | `Methods.cs:95`, `ConfigStore.cs:134-138`, `PostgresBackend.cs:567,600` | Above |
| Medium | Signing key in a job with tag-pinned actions (top issue 10) | A moved upstream tag exfiltrates `TAURI_SIGNING_PRIVATE_KEY`, and a signed malicious update reaches every install. | `release.yml:32-87` | SHA-pin |
| Medium | Install docs advise a Defender exclusion on a user-writable folder | Any process running as the user can drop or replace `panoptic-sidecar.exe` under `%LOCALAPPDATA%\Panoptic`, unscanned, and read the store through it. | `docs\install.md:26-29` | Remove the advice and treat ADR 0014 signing as the fix. |
| Low | CSV export formula injection | A Cosmos document or row containing `=HYPERLINK(...)` executes when the export is opened in Excel. | `export.ts:5-9` | Prefix cells starting with `= + - @` with `'`. |
| Low | Trust server certificate on a non-loopback host gives no warning, even with Entra | An interceptor captures a Postgres Entra token and replays it against any Azure Database for PostgreSQL server for about an hour. | `SqlBackend.cs:526`, `PostgresBackend.cs:567,585`. Cosmos is already limited to loopback. | Warn, or refuse trust with Entra on non-loopback hosts. |
| Low | Catalog snapshots of deleted connections stay on disk | Schema metadata of a removed production connection persists in `PANOPTIC_CATALOG`. | `CatalogService.cs:49` only clears memory; `CatalogCache` has no delete | Delete the cache file with the connection. |
| Low | No NuGet `packages.lock.json`; release does not build `--locked` | A transitive version drifts between a PR build and the release build. | csproj files; `release.yml` | Enable `RestorePackagesWithLockFile` and `--locked-mode` in CI. |
| Low | CI workflows lack `permissions` blocks; `workflow_dispatch` can sign and publish from any branch | Defence in depth only: the repo default token is read (verified). | `ci.yml`, `fragment.yml`, `release.yml` | Declare `permissions: contents: read`, and restrict dispatch to main. |

Verified as good:
- **The store:** DPAPI CurrentUser with entropy. `store.bin`'s ACL is SYSTEM, Administrators and the user only. No plaintext password in the store or catalog files. No secret field in `AppConfig`. The SSMS importer drops passwords.
- **Logging:** stderr only, and release builds have no console.
- **Identifier quoting:** correct. The payload `x];DROP TABLE t;--` stays one identifier. Connection strings go through the SQL and Npgsql builders. Defaults are `Encrypt=Mandatory` and Postgres `VerifyFull`.
- **The sidecar** spawns with no arguments.
- **Tauri:** no shell permission. fs write is scoped to the save dialog's path, the opener allows https only, the CSP is `default-src 'self'`, and devtools are off.
- **Updater:** pubkey pinned, HTTPS endpoint, `.sig` required, releases stay draft until every asset is attached.
- **Network:** no CDN, web fonts or telemetry, and update checks can be set to Never.
- **Audits:** `pnpm audit` 1 low (no patch available), `dotnet list package --vulnerable` none, `cargo audit` 0 vulnerabilities.

## UX and design findings by screen

### First run
- **No guidance, and the one-time action is dimmed** (Medium). On an empty store, Seek is focused over an empty index, New query comes first, and Import is dimmed (`Landing.svelte:112,231`). Fix: with zero connections, lead with Import and New connection, undimmed, with one line each.
- **Docs disagree on the add-connection flow** (Low). `docs\landing.md` says New connection asks for an environment first; `explorer-ux.md` and `App.svelte:334-337` default to None.

### Landing
- **Wordmark clipped to "noptic"** at 1280x800 (Low, `Landing.svelte:263-273`).
- **Seek's environment order differs from the tree's** (Low, `seek.ts:71-76`).
- **"Pick up where you left off" and "Reopen last session" duplicate each other** (Low).

### Add connection
- **Enter does not save** (Medium, `Dialog.svelte:36`).
- **Focus goes to `body` on close, and the new connection is not selected** (Medium). `Dialog.svelte` never restores focus anywhere.
- **The first focused field is the optional Environment picker, not Server** (Low, `Dialog.svelte:25`).
- See also security finding: the password is kept when the endpoint changes.

### Explorer
- **Footer buttons do not respond to Enter or Space** (High). The footer sits inside the tree's key handler, which takes Enter and Space with `preventDefault` (`Tree.svelte:197-219,370-372`).
- **The filter input collapses to 18 px with 8 engines at a 400 to 480 px panel** (High, design). The spec asks for at least 80 px (`explorer-ux.md:27`). `.filter {min-width:0}` (`Explorer.svelte:176-180`) loses to the toggles at `EngineFilter.svelte:178-186`, whose comment says the opposite.
- **Dimmed-prefix hostnames break when a local instance is an IP or URL** (Medium). `isLocal` matches only `^localhost` (`labels.ts:21`, **re-checked**), so `127.0.0.1` and `https://localhost` endpoints erase the shared suffix for the whole engine.
- **The tree shows endpoints while Seek and tabs show display names, and the filter cannot match names** (Medium). Filtering for a connection's display name gives "0 of 20".
- **Raw .NET errors, inner exception dropped** (Medium). This is what hid #167.
- **No `aria-activedescendant`, and a click leaves the focus outline on the old row** (Medium, `Tree.svelte:335`).
- **The detail pane is raw metadata, e.g. "read only true", with no actions** (Low).
- **The splitter is mouse-only** (Low, `App.svelte:671`).
- **Design: the dimmed prefix is 3.05:1 in dark**, below AA (`--tree-dim` `#6a6a6a` on `#1d1f23`, `app.css:29,56`). `#858b93` gives 4.80:1.
- **Design: two engine colour maps disagree.** `kinds.ts:12-15` makes Cosmos teal, per the spec; `Icon.svelte:4-6` makes it purple. So the same connection is teal in the tree and purple in the detail pane. Postgres and procedures share the letter "P". `Icon.svelte` has no Synapse.

### Seek
- **Focus lost after Enter; `Ctrl+P` dead with tabs open** (High, top issue 8).
- **No feedback on a miss, and the placeholder over-promises** (Medium). Seek indexes only environments, connections and recently opened objects, but says "anything" (`SeekBox.svelte:99`).
- **No READ ONLY pill or engine badge on results**, unlike the `d-seek-typing` mockup (Low).
- **Design: the Seek box's cyan border is also its focus indicator, at 2.03:1 on white** (Medium, `SeekBox.svelte:141-143,160`).

### Query editor
- **The database picker shows the wrong database** (High, top issue 9).
- **`Ctrl+Shift+N` opens a query tab instead of New connection** (High, `node-menu.ts:32-35`).
- **Shortcuts fire behind open dialogs, confirms and menus** (Medium). `Ctrl+N` inside the New environment dialog opened a tab behind it (`App.svelte:561-568`). `confirming` and `menu` are never checked.
- **The connection picker on an unconnected tab cannot be reached by keyboard**, because Shift+Tab stays inside Monaco (Medium).
- **The toolbar repeats the name: "conn / conn"** (Low).
- **Design: Monaco uses the stock `vs` / `vs-dark` themes** (`QueryEditor.svelte:66,133`), so palette changes will not reach the editor. The dark Run button is `#fff` on `#4c8dff`, at 3.20:1.
- **IntelliSense meets the spec.** Completions, hover and lint run in a web worker (`worker.ts:171-200`), and lint is debounced 500 ms. IPC captured over about 40 keystrokes showed zero sidecar calls; a positive control did log `tree.children`. Deviation: it is a plain Vite worker, not Monaco's language-worker plumbing. Update `query-editor.md`.

### What's new
- **Light theme: amber and cyan used as text** (High, design). The version number is 1.62:1, the Changed tag 1.51:1 and the Fixed tag 1.81:1 (`WhatsNewView.svelte:97,166-174`). Computed from tokens; this tab is not rendered in the preview.
- **Focus goes to `body` on open; the masthead copy "Every release." reads oddly; some items start lower case** (Low).

### Cross-cutting design
- **Tokens:** the foundation is right. Role-named tokens in `app.css` have real light and dark values. But there are 57 hard-coded colour literals in shipping code:
  - `Icon.svelte`: 24
  - `import-plan.ts`: 15
  - `EnvironmentDialog.svelte`: 7. Its environment palette is duplicated in `import-plan.ts`, with different members.
  - `kinds.ts`: 5
  - shadows and `#fff` elsewhere

  `--brand-amber` and `--brand-cyan` are used as text and focus colours. Keep them for the logo, and add role tokens for those uses.
- **Typography and spacing:** 14 font sizes from 9 to 26 px with no scale, and 21 distinct px spacing values.
- **Components:**
  - One shared `Dialog`, used by all six dialogs (good).
  - 13 local ghost-button resets.
  - 3 link-style buttons.
  - 3 identical `@keyframes spin`.
  - 2 identical kbd chip styles.
  - 6 badge styles.
  - Icons drawn twice in different files: new connection, import, folder.

  Extract `Button`, `Spinner`, `Kbd` and `Badge`.
- **Previews:** `preview.html` and `bench.html` link legacy `styles.css`, which adds 24 px of padding the real app does not have. Every preview screenshot, including the README images, carries it. `docs\images\readme\query.png` still shows the superseded explorer header.
- **Narrow width works:** nothing scrolls sideways at 220 px, and the short summary forms render correctly.

## Correctness and reliability

Test results (`main` at `2994ed6`, Docker databases seeded):

| Suite | Result |
|---|---|
| `svelte-check` | 252 files, 0 errors, 0 warnings |
| vitest | 34 files, 439 passed |
| `dotnet test`, no database env vars | 335 total: 292 passed, 43 skipped, each with a stated reason |
| `dotnet test` with SQL, Postgres and Cosmos env vars | 335 passed |

Integration tests skip loudly (`IntegrationFacts.cs`), and CI fails closed if they skip. Cosmos never runs in CI.

Other findings beyond the top 10:
- **Store resilience is good.** Empty, random, truncated and wrong-type stores are all moved aside to `.corrupt-<time>`, never overwritten. Writes are atomic. The gap is shape validation (top issue 4). A locked `store.bin` gives an unhandled `IOException` (`ConfigStore.cs:201`); the data is kept, but the user is not told why.
- **Settings are validated on save but not on load** (`ConfigStore.cs:48-57`). One bad stored value makes every later settings save fail, and `App.svelte:264-268` hides the failure.
- **Silent failure points:**
  - `void onRunning()` (`App.svelte:188`) can produce unhandled rejections.
  - A failed ping is swallowed (`:205`), so a hung (not crashed) sidecar is never explained.
  - `rpc.ts:74,81` drops non-JSON lines and `id:null` errors.
  - A request timeout does not send `$/cancelRequest` (`rpc.ts:53-55`).
  - The dispatcher logs no stack traces (`JsonRpcDispatcher.cs:120-122`).
- **The IPC boundary is otherwise sound.** Errors are typed, a sidecar crash rejects every pending request, and the shell restarts it with back-off.
- **Read-only by engine:**
  - SQL Server: enforced only in the sidecar, as a client-side rollback (top issue 1). `ApplicationIntent` is never set (`SqlBackend.cs:520`), and setting it would only route to an AG secondary, not block writes. The rollback cannot undo non-transactional effects: `xp_cmdshell`, `sp_send_dbmail`, linked servers, identity and sequence increments. The code comment at `SqlBackend.cs:151-156` says so.
  - Postgres: server-enforced (`PostgresBackend.cs:238-246`) and stronger.
  - Cosmos: queries cannot write.
- **Dev tooling:** `scripts\dev-db.ps1:53` treats a successful `SELECT 1` as ready while user databases may still be recovering. That produced Msg 5011 on this run. `seed.sql:8,10` does not clean up orphaned `.mdf` files, which produced Msg 5170. There is no retry.

## Architecture and code health

- **Matches the plan:**
  - `lib.rs` is a 253-line pipe with no data logic.
  - The sidecar core reaches engines only through `IBackend` / `IQueryBackend` and `BackendRegistry`.
  - No UI file is over 821 lines.
  - Every check is clean: svelte-check, tsc, vite build, `dotnet build` with 0 warnings, `cargo check`, and `cargo clippy --all-targets` with 0 warnings.
- **The node contract leaks into the UI** (Medium):
  - Closed engine unions: `api.ts:28-29`, `query/types.ts:47`.
  - Auth options per engine in `ConnectionDialog.svelte:29-34,64-85`, duplicating `IBackend.AuthsFor`.
  - Capability checks keyed on language: `store.svelte.ts:242,287,396,444-445`.
  - SQL Server error numbers and Postgres SQLSTATEs: `store.svelte.ts:43,45`.

  ADR 0015's "a new backend is one class and one registry line" is true only in the sidecar. Fix: a `backends.describe` RPC returning auths, capabilities and badge, with errors classified in the sidecar.
- **The TS types are hand-written mirrors of the C# types,** although ADR 0005:12 says they are generated (`api.ts:3-4` TODO). They already differ: `QueryScope` optionality, `Model.cs:97` vs `types.ts:53-60`. Fix: generate them, or add a contract test.
- **`App.svelte` is the hub every feature touches:** 821 lines, 28 `$state`, 30 functions covering startup, undo, the context menu, query opening, Seek and resizing.
- **Postgres identifier quoting is written twice and the copies disagree** (`engine.ts:88-92` vs `PostgresBackend.cs:344-348`, on keywords and `$`), with no test keeping them in step.
- **Dead or test-only code:**
  - `QueryTemplates.cs`.
  - The `QueryService.cs:37-41` constructor.
  - `nodeParts` (`store.svelte.ts:52-67`), which still parses the old `env:x/conn:y` ID shape.
  - `registerKindBadge` (`kinds.ts:19`), which has no callers.
- **CI does not lock in today's clean state:** no clippy step, no `TreatWarningsAsErrors`, no ESLint, Prettier or `.editorconfig`.
- **Doc drift:**
  - ADR 0002:12 and ADR 0012:8 still say "SSMS replacement".
  - `plan.md:60` lists an `actions(nodeId)` method that does not exist.
  - `plan.md:64` overstates read-only.
  - `explorer-ux.md:91` says badges come from the backend; they are a static map in the UI.
  - `sql-server.md:77` points at `QueryService.cs` for the guard, which is in `SqlBackend.cs`.
  - The M0 boxes in `plan.md:127-133` are all unchecked.
  - At review start, a stale untracked copy of `explorer-ux.md` sat at the repo root. It has since been removed.

## Performance

Machine: Ryzen 9 7900X, 31 GB RAM, Windows 11. Release build (`tauri build --no-bundle`), JIT sidecar, synthetic store.

| Metric | Median | Budget |
|---|---|---|
| Launch to first paint (10 runs) | 414 ms (fresh profile: 875) | 500 |
| Launch to first tree row (7 runs) | 414 ms | 500 |
| First expand: SQL / Postgres / Cosmos | 182 / 165 / **2,250** ms | 300 |
| Repeat expand | 3-5 ms | |
| Idle memory, whole process tree | 420 MB working set / 218 MB private | |
| `Ctrl+N` to editor | 55 ms | 50 |
| 100k-row SELECT: first row / all rows | 42 / 448 ms | |
| Grid scroll at 100k and 1M rows, p99 | 16.8 ms, 0 late frames | 60 fps |
| 1M rows held, app total | 1.59 GB | |

The numbers match `docs\benchmarks.md` (408 ms paint recorded there). The M0 tooling (`scripts\bench.ps1`, `bench.html`) still runs, but it misses the budgets that matter:
- no tree-rendered metric (`App.svelte:226` stamps before `loadRoot`)
- no expand or sign-in suite
- the UI suite measures prototype renderers (`src\bench\main.ts:4-6`), not the shipped `Tree` and `ResultGrid`

Warm-up: not implemented, generically or for any one engine (top issue 6).

**Performance is creeping down, and needs a proper think (#190).** On the same machine, first paint has gone from 396 ms (2026-10-29) to 408 ms (landing PR) to 414 ms today, so headroom against the 500 ms budget fell from 104 to 86 ms in two days. Sidecar-ready went from 279 to 380 ms, mostly the deliberate AOT to JIT switch, and sidecar sizes grew from 98 to 100 MB (JIT) and 134 to 146 MB (R2R).

Three numbers are already over budget:
- Cosmos first expand, 7.5x over.
- First launch on a fresh profile, 875 ms.
- `Ctrl+N` to editor, 55 ms against 50.

First SQL expand uses 61% of its budget. The data points are few and the methods have varied, which is itself the problem: nothing records performance per change, so drift is only seen when someone happens to measure.

Smaller hazards:
- Each tree change rebuilds every row (`tree-model.ts:407`), and the shipped tree has never been measured at 50k nodes.
- `getValue()` copies the whole query out of Monaco on every keystroke (`QueryEditor.svelte:112`).
- Every sidecar line is JSON-encoded twice (`lib.rs:225`, `rpc.ts:73`). This is not yet visible in any measurement.
- The dev seed uses `https://localhost:8081`, which costs about 210 ms per connect versus 0.5 ms for `127.0.0.1`.

## What is good

- **The sidecar is engine-agnostic.** Its core goes through one contract, and the Rust shell holds no data logic. Keep that discipline.
- **Credentials are handled carefully end to end:** DPAPI, scoped ACLs, no secrets to the webview or logs, correct quoting, safe transport defaults.
- **Tests are real.** There are 774 of them, including live SQL Server 2022 and Postgres 17 jobs, and the gated integration tests skip loudly.
- **The heavy surfaces perform:** a virtualised tree and grid holding 60 fps at 1M rows, streaming results, lazy Monaco, and IntelliSense in a worker with no per-keystroke IPC.
- **The store recovers from corruption** without destroying data.
- **The visual foundation is sound:** role-named tokens with working light and dark themes, row heights exactly per spec, one shared `Dialog`, and implemented screens that match the chosen mockups.
- **ADRs get amended** when decisions change, rather than rotting.

## Next steps

How I weighed it:
- The goal is fast access to one environment, safely, across engines.
- The constraint is one developer, shipping on every merge.
- The evidence points to three kinds of debt:
  - **Trust:** the read-only guard, the secret following an endpoint, the store crash, unrequired integration tests.
  - **Hand-off UX:** the gap between Seek and the tree, focus, the database picker.
  - **Boundary:** engine knowledge in the UI, hand-written types.

### Option A: Stabilise and harden (about 2 weeks)
- Top issues 1 to 7 and 10.
- The keyboard and focus Highs, and inner exceptions in errors.
- Expand and tree-rendered bench suites.

**Trade-off:** almost no new visible features for two weeks. But it makes the production story honest, and it fixes the dev loop that has hidden SQL Server failures. Most items are small and independent, which suits shipping every merge.

### Option B: Finish the explorer and query editor to spec (about 3 weeks)
- Seek as a global overlay, focus hand-off, the filter collapse, names vs endpoints, the database picker.
- Design tokens for brand colours, extracted `Button` / `Spinner` / `Badge`, a Monaco theme from tokens.
- First-run guidance, and What's new contrast.

**Trade-off:** the most visible improvement for daily use. But it builds more UI on a boundary that leaks engine knowledge, and it leaves the read-only overclaim in place while making the app nicer to point at production.

### Option C: Push Postgres to parity to force the plugin boundary (about 3 to 4 weeks)
- `backends.describe` RPC; move auths, capabilities, badges and error classification into the sidecar.
- Generate TS types from C#.
- Close the Postgres gaps against the SQL Server tree.

**Trade-off:** pays down the six-month maintainability risk and proves ADR 0015. But it is the least urgent for daily use, it touches the most files, and it collides with the UX fixes in `App.svelte` and `store.svelte.ts`.

### Recommendation: Option A, with the three UX Highs on the fast path folded in

Do A, and pull the Seek focus hand-off, the database picker and the footer keys in from B. Reasons:
- The read-only guard and the secret-follows-endpoint issue are the only findings that can cause real damage to production data or credentials.
- #167 means SQL Server changes have not been exercised in dev, so the UX work in B would be verified on a broken loop.
- Requiring the integration jobs is a settings change that protects everything after it.

Then do C before adding any fourth engine or a large B push. The boundary leak is cheap to fix now, at about eight UI files, and gets more expensive with every UI feature.

## Unverified hunches

- `msalruntime.dll` is also missing from the dev sidecar, so Entra Windows sign-in (WAM) probably fails in `pnpm dev` too. No tenant was available to test.
- Monaco hover markdown is built from unescaped catalog and Cosmos property names (`engine.ts:284,302`), so a crafted name could render as a link.
- No `ClientId` is set in `Credentials.cs`, so Azure.Identity uses its default public client. The MSAL cache location and encryption are unconfirmed.
- Notifications are fire-and-forget (`Program.cs:24`), so a final `query.message` could arrive after the response and be dropped (`store.svelte.ts:407`).
- Two sidecars writing the same store: the last writer wins. There is no fsync before the rename and no backup kept.
- The Postgres statement splitter may disagree with Npgsql on some quoting edge cases.
- The grid spacer (`count * 22` px, `ResultGrid.svelte:105`) may exceed Chromium's maximum element height above about 1.5M rows.
- The shipped tree's `rows()` rebuild at 50k nodes may take more than one frame.
- The What's new "current" badge marks the newest changelog section, not the running app version.
- `bench.html` ships in releases, and `bench_finish` writes to a path taken from an env var.
- `App.svelte:147` may make a server round trip each time a query tab opens.
- Real Cosmos accounts with Entra will be slower than the emulator; Defender on a managed laptop will widen first-run numbers.
- Result-grid text renders heavier than normal weight; not investigated.

## Issue index

Raised on 2026-10-31: 78 issues, #169 to #246, all labelled `review-2026-10-31`. Milestone order is the agreed priority: security, then Option A, then Option C, then Option B. `severity: critical` marks the top ten (with #167, now fixed).

### 1. Security findings (priority P1)

| Issue | Severity | Title |
|---|---|---|
| #169 | critical | Read-only guard lets writes through after COMMIT, ROLLBACK or EXEC('COMMIT') in the same batch |
| #170 | critical | Stored password is sent to a different host when a saved connection's endpoint is edited |
| #171 | critical | Release job exposes the updater signing key to tag-pinned third-party actions |
| #172 | medium | install.md advises a Defender exclusion on a user-writable folder |
| #173 | low | CSV export allows spreadsheet formula injection |
| #174 | low | No warning when Trust server certificate is on for a non-loopback host, including with Entra |
| #175 | low | Catalog snapshots of deleted connections are never deleted from disk |
| #176 | low | No NuGet lock file, and the release build is not --locked |
| #177 | low | Workflow hardening: permissions blocks, dispatch branch, latest.json check |
| #178 | unverified | Investigate: Monaco hover markdown built from unescaped catalog and Cosmos property names |
| #179 | unverified | Investigate: Entra client id and MSAL token cache location and protection |
| #180 | unverified | Investigate: can driver error messages carry secrets into the UI or Problems tab? |
| #181 | unverified | Investigate: local SSMS import parses DTDs with XDocument.Load |
| #182 | unverified | Investigate: bench.html ships in releases and bench_finish writes to an env-var path |

### 2. Stabilise and harden, Option A (priority P2)

| Issue | Severity | Title |
|---|---|---|
| #167 | critical | Dev sidecar (fdd) misses native DLLs (fixed) |
| #183 | critical | Sidecar crashes on every start when a store has connections": null" |
| #184 | critical | Make integration tests required checks so main cannot ship untested |
| #185 | critical | No background engine warm-up: first Cosmos expand takes 2.25 s against a 300 ms budget |
| #186 | critical | Query result sets are unbounded: 1M rows push the app to 1.6 GB |
| #187 | critical | Seek hand-off: focus lost after Enter, and Ctrl+P does nothing once a tab is open |
| #188 | critical | Query tab database picker shows a database the tab is not using |
| #189 | high | Explorer footer buttons do not respond to Enter or Space |
| #190 | high | Performance is creeping down toward the budgets, and is over on some |
| #191 | medium | Sidecar start-up failures reach the user only as 'exited 5 times' |
| #192 | medium | Errors show raw .NET text and drop the inner exception |
| #193 | medium | dev-db.ps1 seeds before SQL Server user databases are online and fails on orphaned files |
| #194 | medium | Bench tooling misses the budgets that matter (tree rendered, expand, sign-in) |
| #195 | medium | The shipped tree rebuilds every row on each change and has never been benchmarked at scale |
| #196 | low | Settings are validated on save but not on load |
| #197 | medium | Silent failure points across the UI and RPC layer |
| #198 | low | CI does not lock in today's clean lint state |
| #199 | low | Docs-only CI skip treats changes/*.md fragments as docs |
| #200 | low | Every sidecar line is JSON-encoded twice across the IPC boundary |
| #201 | low | Query editor copies the full text out of Monaco on every keystroke |
| #202 | low | Dev seed uses https://localhost:8081 for Cosmos, costing about 210 ms per connect |

### 3. Plugin boundary, Option C (priority P3)

| Issue | Severity | Title |
|---|---|---|
| #203 | medium | Engine knowledge leaks into the UI: add a backends.describe RPC |
| #204 | medium | TypeScript API types are hand-written mirrors of the C# types and have drifted |
| #205 | medium | App.svelte has become the hub every feature touches |
| #206 | low | Postgres identifier quoting is implemented twice and the copies disagree |
| #207 | low | Remove test-only shims and dead code |
| #208 | medium | Two engine badge and colour registries disagree |
| #209 | low | Dependency hygiene: mixed version ranges, split Tauri groups, unexplained Newtonsoft |
| #210 | low | Docs have drifted from the code |

### 4. Explorer and editor to spec, Option B (priority P4)

| Issue | Severity | Title |
|---|---|---|
| #211 | high | Ctrl+Shift+N opens a query tab instead of New connection |
| #212 | medium | Keyboard shortcuts fire behind open dialogs, confirms and menus |
| #213 | medium | Dimmed hostname prefix breaks when a local instance is an IP or URL |
| #214 | medium | Tree shows endpoints while Seek and tabs show names, and the filter cannot match names |
| #215 | medium | Seek gives no feedback on a miss, and its placeholder over-promises |
| #216 | medium | Focus is not restored after dialogs, menus and What's new close |
| #217 | medium | Enter does not save the connection dialog |
| #218 | medium | The connection picker on an unconnected query tab cannot be reached by keyboard |
| #219 | medium | Tree accessibility: no aria-activedescendant, stale focus outline, empty ArrowDown |
| #220 | medium | First run gives no guidance, and Import is the dimmed action |
| #221 | low | Landing wordmark is clipped to 'noptic' |
| #222 | low | Seek orders environments differently from the tree |
| #223 | low | Landing shows the same place twice: 'Pick up where you left off' and 'Reopen last session' |
| #224 | low | Connection dialog focuses the optional Environment picker instead of Server |
| #225 | low | Detail pane shows raw metadata and no actions |
| #226 | low | Explorer splitter can only be moved with the mouse |
| #227 | low | Seek results lack the READ ONLY pill and engine badge |
| #228 | low | Seek host matches only show hosts in the top environment |
| #229 | low | Query toolbar repeats the connection name |
| #230 | low | What's new: focus lands on body, odd masthead copy, inconsistent capitalisation |
| #231 | high | Explorer filter input collapses to 18 px between 400 and 480 px panel widths |
| #232 | high | Light theme: brand amber and cyan used as text and focus colours fail contrast |
| #233 | medium | Dimmed hostname prefix is below AA contrast in the dark theme |
| #234 | medium | White text on the blue Run and update buttons is 3.20:1 in dark |
| #235 | medium | Legacy styles.css leaks into the preview, bench page and README images |
| #236 | medium | 57 hard-coded colour literals in shipping code, and Monaco uses stock themes |
| #237 | low | Typography and spacing have no scale; some tokens are named by hue |
| #238 | low | Extract shared Button, Spinner, Kbd and Badge components; de-duplicate icons |
| #239 | low | Other text below AA contrast: READ ONLY pill, filter placeholder, object-type glyphs |

### No milestone: unverified hunches

| Issue | Severity | Title |
|---|---|---|
| #240 | unverified | Investigate: final query.message may arrive after the response and be dropped |
| #241 | unverified | Investigate: concurrent sidecars, fsync and backups for store.bin |
| #242 | unverified | Investigate: Postgres statement splitter vs Npgsql quoting edge cases |
| #243 | unverified | Investigate: result grid spacer may exceed the browser's maximum element height |
| #244 | unverified | Investigate: App.svelte:147 may make a server round trip per query tab open |
| #245 | unverified | Investigate: result grid text renders heavier than normal weight |
| #246 | unverified | Investigate: What's new 'current' badge marks the newest section, not the running version |


## Appendix: commands run

Orchestrator:

| Command | Result |
|---|---|
| `docker version` | Daemon down; started Docker Desktop, then 29.8.0 |
| `scripts\dev-db.ps1` (run 1) | SQL seed failed: Msg 5011 / 5069 right after the readiness check |
| `scripts\dev-db.ps1` (run 2) | Msg 5170 / 1802: orphaned `Orders.mdf` and `Orders_log.ldf` in the volume, unregistered in `sys.databases` |
| Moved the orphan files to `*.orphan` in the container; `scripts\dev-db.ps1` (run 3) | SQL, Postgres and Cosmos seeded |
| `scripts\dev-seeded.ps1 -NoLaunch` | Reused the existing synthetic store |
| sqlcmd guard simulation on scratch table `dbo.ReviewProbe` (created, then dropped) | Control kept 3 rows; `COMMIT;DELETE`, `ROLLBACK;DELETE;BEGIN TRAN` and `EXEC('COMMIT');DELETE` each left 0 |
| Sidecar `connection.test` via stdio, dev exe alone vs with the SNI DLL | `ok:false` TdsParser vs `ok:true` 162 ms |
| Same, Cosmos emulator, exe alone vs full `fdd` folder | Both ok, about 2.3 s |
| `git log` on `build-sidecar.ps1` and the csproj | `fdd` line unchanged since #7 |
| `gh api .../rulesets/26157437` | Required: ui, sidecar, shell, fragment; `strict:false` |
| `gh issue create` | #167, then #169 to #246 via a script; 18 labels and 4 milestones created |

Area reviewers:

| Command | Result |
|---|---|
| `pnpm --filter @panoptic/desktop check` | 252 files, 0 errors, 0 warnings |
| `pnpm exec tsc --noEmit -p .` (apps\desktop) | Exit 0 (TS 6.0.3). `npx tsc` from the repo root fails because TS is installed only in apps\desktop |
| `vite build --outDir <scratch>` | OK in 1.36 s; main 157 kB, Monaco chunk 3.3 MB (lazy) |
| `dotnet build --artifacts-path <scratch>` | 0 warnings, 0 errors |
| `cargo check`, `cargo clippy --all-targets` (scratch target dir) | 0 warnings |
| `pnpm --filter @panoptic/desktop test` | 34 files, 439 passed |
| `dotnet test apps\sidecar` without and with DB env vars | 292 passed / 43 skipped, then 335 passed |
| Store corruption fixtures via `PANOPTIC_STORE` | Empty, random, truncated and wrong-type stores recovered; `connections:null` crashes |
| `pnpm audit` | 1 low (deepmerge via vite-plugin-svelte, no patch) |
| `dotnet list apps\sidecar package --vulnerable --include-transitive` | None |
| `cargo audit` | 515 crates, 0 vulnerabilities, 5 allowed warnings |
| `pnpm dev` on the seeded store with an isolated WebView2 profile, driven over CDP with Playwright (22 scripts) | UX findings and screenshots; IPC capture during typing showed 0 sidecar calls |
| Second launch on an empty scratch store | First-run findings |
| `npx vite --port 5181` plus Playwright on `preview.html` (26 loads, 2 themes) | 0 console errors; 318 contrast pairs, 15 under threshold; filter width sweep |
| `pnpm --filter @panoptic/desktop tauri build --no-bundle --config <override>` | Exit 0, 38 s; `git status` unchanged |
| `scripts\bench.ps1 -Suite startup -Runs 10`, `-Suite ui` | Startup medians above; UI suite on prototypes |
| CDP timing runs (7), idle runs (5), grid runs (3 + 1), sidecar JIT vs R2R (7 + 7), query stream bench | Numbers in the Performance section |
| `curl.exe` to the emulator via `localhost` vs `127.0.0.1` | About 210 ms vs 0.5 ms connect |
