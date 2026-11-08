# Benchmarks

Every number records the machine and date. Reproduce with `scripts\bench.ps1` (see its help); it
defaults to the installed copy, so the same script works on the work laptop. Its suites: `startup`
(window open and idle memory), `expand` (the 300 ms budget, against the local Docker databases) and
`ui` (the shipped tree and grid at scale). `scripts\check-sizes.ps1` measures the build sizes.

## Budgets

Timings and memory are on Home with a release build; the work laptop is slower, so a number close
to its budget here is a warning there. Only the sizes are checked automatically: the `sizes` CI job
runs `scripts\check-sizes.ps1` on every pull request that changes code, and fails when one is over.
Sizes are the same on any machine for the same commit; timings on shared runners are too noisy to
gate on, so the job reports the sidecar's start-up time for information only.

| Budget | Limit | Home, 2026-11-08 | How it is measured |
| --- | --- | --- | --- |
| Window open: launch to first paint | 500 ms | 390 ms median, 734 ms run 1 | `bench.ps1 -Suite startup` |
| First launch on a fresh WebView2 profile, to first paint | 500 ms | 875 ms (2026-10-31), over | `startup` run 1 after deleting the bench profile |
| Node expanded, cold or warm, every engine | 300 ms | SQL 161, Postgres 158, Cosmos 2,250 ms (cold medians), Cosmos over (#185) | `bench.ps1 -Suite expand` |
| Ctrl+N to an editor with focus | 50 ms | 55 ms (2026-10-31), over | By hand for now; no suite yet |
| Tree (50k nodes) and grid (100k rows) scrolling | 60 fps: no frame over 25 ms | 120 fps, no frame over 25 ms | `bench.ps1 -Suite ui` |
| Idle memory, whole process tree, sum of working sets | 450 MB | 416 MB median | `bench.ps1 -Suite startup`, 5 s after the tree rendered |
| Sidecar idle working set | 60 MB | 39 MB median | The same run, Sidecar row |
| Sidecar on disk (jit, self-contained single file) | 112 MB | 101.4 MB | `check-sizes.ps1`, CI |
| Frontend JS, all chunks and workers | 4,250 KB raw, 1,125 KB gzipped | 3,855 KB raw, 1,019 KB gzipped | `check-sizes.ps1`, CI |
| Frontend JS loaded at start (index.html's entry and preloads) | 300 KB | 249 KB | `check-sizes.ps1`, CI |
| Frontend CSS | 210 KB raw, 40 KB gzipped | 183 KB raw, 31 KB gzipped | `check-sizes.ps1`, CI |

Why these limits:

- **500 ms, 300 ms and 60 fps** are the M0 plan's budgets. Ctrl+N's 50 ms is from the 2026-10-31
  review: a new tab should feel instant, and 50 ms is about where a delay after a key press becomes
  noticeable.
- **Idle memory, 450 MB:** today plus about 10%. WebView2 is about four fifths of it (browser,
  renderer, GPU and utility processes) and the shell and sidecar the rest, so the budget mostly
  guards against the UI keeping more alive at start (eagerly loaded editors, caches) and the
  sidecar loading what it does not need yet. The sum of working sets counts pages shared between
  processes once per process, so it is above what the system loses; it is the number Task Manager
  users see, and it is stable from run to run (about 2%). The idle bench stops before the settings,
  update check and What's new load (as every bench does), so the app's own idle is a few MB above it.
- **Sidecar idle, 60 MB:** today plus about 50%, because engine drivers load on first use: after the
  first expands the sidecar grows to about 81 MB (#190). That growth is not budgeted until the
  memory work has explained it.
- **Sizes:** today plus about 10% (20% for the small start-up JS), so a dependency bump passes and a
  new runtime, SDK or bundled library has to raise its budget on purpose, in the same pull request,
  here and in `scripts\check-sizes.ps1`. A ReadyToRun sidecar (+36 MB) or a second copy of Monaco
  would fail. The start-up JS is what the webview parses before first paint, so it matters most.

### Baseline: Home, 2026-11-08

Release build of main at 63665cc, Ryzen 9 7900X, 120 Hz display (so frame-bound numbers resolve to
8.3 ms, not 16.7), dev-seeded store, Docker dev databases. The starting point for the performance
round (#190, docs/plans/2026-11-08-performance.md).

| Metric | Value | Budget |
| --- | --- | --- |
| Launch to first paint, median of 10 / run 1 | 390 / 734 ms | 500 |
| Launch to sidecar ready, median / run 1 | 367.5 / 962 ms | |
| Launch to tree rendered, median / run 1 | 398 / 990 ms | |
| Sidecar process start to ready (JIT) | 96 ms | |
| First launch on a fresh WebView2 profile | 875 ms (2026-10-31) | 500, over |
| First expand: SQL / Postgres / Cosmos (cold median) | 161 / 158 / 2,250 ms | 300; Cosmos 7.5x over (#185) |
| Later expands | 16 to 75 ms | 300 |
| Ctrl+N to editor | 55 ms (2026-10-31) | 50, over |
| Idle memory, whole process tree | 420 MB (2026-10-31) | 450 |
| Tree and grid scrolling, 50k nodes / 100k rows | 120 fps, no frame over 25 ms | 60 fps |

Idle memory by process, from the first run with the memory measurement: Home, 2026-11-08, repo
release build of 76a9430 plus this tooling, a copy of the dev-seeded store, `-Suite startup -Runs 10`,
5 s after the tree rendered. Same run: first paint 413.5 ms median (431 run 1), tree rendered 422
ms, with other builds running on the machine. The whole tree ranged from 414 to 422 MB over the 10
runs.

| Process | Count | Working set, run 1 (MB) | Working set, median (MB) | Private bytes, median (MB) |
| --- | --- | --- | --- | --- |
| Shell | 1 | 27.9 | 28.0 | 7.3 |
| Sidecar | 1 | 38.9 | 38.8 | 10.6 |
| WebView2 browser | 1 | 114.9 | 115.4 | 32.9 |
| WebView2 renderer | 1 | 78.8 | 76.2 | 33.3 |
| WebView2 GPU | 1 | 76.7 | 77.0 | 93.6 |
| WebView2 utility | 2 | 59.1 | 59.1 | 18.6 |
| conhost.exe (console host) | 1 | 7.5 | 7.5 | 1.2 |
| WebView2 crashpad-handler | 1 | 12.9 | 12.9 | 2.6 |
| Total | 9 | 416.7 | 416.1 | 200.7 |

Build sizes the same day (`check-sizes.ps1`): sidecar 101.4 MB; frontend JS 3,855 KB (1,019 KB
gzipped), of which 249 KB loads at start; CSS 183 KB (31 KB gzipped). Sidecar process start to ping
response, 10 starts: 66.7 ms median (52 ms by the sidecar's own clock).

## Machines

| Name | Hardware | Notes |
| --- | --- | --- |
| Home | AMD Ryzen 9 7900X, 31 GB, Windows 11 build 26300, 60 Hz display | Dev machine |
| Work laptop | TBD | Intune-managed, Defender for Endpoint |

## Cold start

`.\scripts\bench.ps1 -Suite startup -Runs 10`. "Launch" is when the script calls Start-Process;
"first paint" is the webview's first contentful paint; "sidecar ready" is when the UI gets its
first `ping` response; "tree rendered" is when the explorer has painted the environments and
connections it loaded after that (config only, no server calls). Since 2026-11-08 each run then
stays open for `-IdleSec` (5 s), the script measures the memory of the whole process tree (shell,
sidecar and the app's WebView2 processes), and closes the window.

Every run reads a temp copy of its store (`-Store`, by default the user's own) and uses its own
WebView2 profile, kept between benches. So a bench never writes to a real store, never meets the
single-instance lock (the shell skips it for a run on its own store, #241), and never shares the
browser process of a Panoptic that is already open: before 2026-11-08 a bench on the user's own store
focused the open app and exited. Run 1 on a new bench profile pays for creating it, as a first launch
after install does.

### JIT sidecar, both machines

Medians of a `-Suite startup -Runs 10` run. Home is a repo release build (`pnpm tauri build
--no-bundle`) of main at 758c1df plus the #194 bench changes, on the user's own store.

| Machine | Date | Version | Launch to first paint (median ms) | Launch to sidecar ready (median ms) | Launch to tree rendered (median ms) | Sidecar start to ready (median ms) | Run 1 paint / tree (ms) |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Home | 2026-11-07 | main 758c1df | 361.5 | 324.5 | 355.5 | 83.8 | 406 / 374 |
| Work laptop | TODO | TODO | TODO | TODO | TODO | TODO | TODO |

Inside the 500 ms budget; the tree is on screen about 30 ms after the sidecar answers. The
2026-10-31 review measured a first launch on a fresh profile (new WebView2 data folder) at 875 ms to
first paint on Home, over budget: a first launch after install pays for creating the profile.

### Landing and Seek vs main: Home, 2026-10-31 (repo release builds, JIT sidecar)

Release builds (`pnpm tauri build --no-bundle`) of `feature/landing` and of main at the same commit it
branched from, 10 runs each, one after the other. The branch ran first, so its run 1 includes the
cold start of a newly written exe; the medians are the comparison.

| Build | Launch to first paint (median ms) | Launch to sidecar ready (median ms) | Sidecar start to ready (median ms) | Run 1 paint / ready (ms) |
| --- | --- | --- | --- | --- |
| feature/landing | 408 | 365 | 94.9 | 874 / 1086 |
| main | 409 | 370 | 96.1 | 644 / 966 |

The landing costs nothing measurable at start and stays inside the 500 ms window-open budget.

### Superseded: Home, 2026-10-29, v0.1.0 (repo release build, AOT sidecar)

These numbers were measured on the Native AOT sidecar, which no longer ships: since M1 the sidecar
is a self-contained JIT build (ADR 0001, and the last two sections of this page). They no longer
describe a release; kept for history until the JIT run above replaces them.

| Metric | Run 1 (coldest) | Median of 10 | Max |
| --- | --- | --- | --- |
| Launch to first paint (ms) | 454 | 396 | 454 |
| Launch to sidecar ready (ms) | 359 | 279 | 359 |
| Sidecar process start to ready (ms, Native AOT) | 21.9 | 20 | 24.9 |

Inside the 500 ms budget, but WebView2 start-up dominates: Rust `main()` to first paint averages
377 ms, while the sidecar is ready about 100 ms before the first paint. The .NET cold-start risk
in the plan is retired (Native AOT, 2.5 MB, about 20 ms). The webview is now the thing to watch on
the slower work laptop.

## Expand

`.\scripts\bench.ps1 -Suite expand -Runs 5` after `scripts\dev-db.ps1` and
`scripts\dev-seeded.ps1 -NoLaunch`. Each run is a new process on the seeded store. For each
connection to this machine (local SQL Server, PostgreSQL and the Cosmos emulator) it expands the
connection, then the first expandable child at each level down to a folder, timing each from the
click (`TreeModel.expand`) to the tree having painted. "Cold" is the first expand in the process, so
a connection's includes connecting; "warm" refreshes the same node straight after. 33 ms is two
frames, the floor of the measurement.

### Home, 2026-11-07 (repo release build of main 758c1df plus #194)

The SQL Server seed failed (#193), so the SQL walk went into `master`, not `Orders`.

| Engine | Expand | Cold median (ms) | Cold max (ms) | Warm median (ms) | Children | Within 300 ms |
| --- | --- | --- | --- | --- | --- | --- |
| sql | connection: local-sql | 180.2 | 193.3 | 33.3 | 4 | yes |
| sql | database: local-sql > master | 33.3 | 33.4 | 33.3 | 4 | yes |
| sql | folder: local-sql > master > Tables | 33.3 | 66.8 | 33.4 | 0 | yes |
| postgres | connection: local-pg | 166.4 | 199.6 | 33.2 | 3 | yes |
| postgres | database: local-pg > inventory | 33.3 | 33.3 | 33.3 | 6 | yes |
| postgres | folder: local-pg > inventory > Tables | 50 | 66.7 | 33.3 | 2 | yes |
| cosmos | connection: local-cosmos | 2250.1 | 2266.7 | 33.1 | 2 | no |
| cosmos | database: local-cosmos > audit | 33.3 | 33.5 | 33.4 | 1 | yes |
| cosmos | container: local-cosmos > audit > changes | 83.4 | 100 | 33.3 | 7 | yes |

Everything is inside the budget except the first Cosmos call, the SDK warm-up of about 2.2 s noted
since M1 (#185). Local servers hide network latency: the work laptop against Azure is the number
that matters.

## Entra sign-in

TODO: not yet measured. The M0 plan asks for sign-in time; `bench.ps1` has no suite for it, so
record how each number was taken.

| Machine | Date | Version | Path (WAM silent, WAM prompt, device code) | Expand of an Entra connection to children shown (ms) |
| --- | --- | --- | --- | --- |
| Home | TODO | TODO | TODO | TODO |
| Work laptop | TODO | TODO | TODO | TODO |

## Tree and grid frame times

`.\scripts\bench.ps1 -Suite ui`. Synthetic 50,228-node tree (env > connection > database > folder >
object) and 100,000-row x 12-column grid. Scroll is programmatic, top to bottom over 5 s, one step
per frame. Medians of 3 rounds.

Since 2026-11-07 the suite measures the shipped explorer `Tree`, driven through `TreeModel` with the
synthetic tree as its loader, and the shipped `ResultGrid` over a complete result set. Mount is with
every environment open (Expand all); "open all" opens every node and renders the 50k rows once;
"expand one folder" expands a single folder through the model, as a click does, inside that open
tree.

### Home, 2026-11-07, shipped components (repo release build of main 758c1df plus #194; 60 Hz, DPR 1, 1280x800)

| Metric | Shipped Tree and ResultGrid |
| --- | --- |
| Tree mount, environments open (ms) | 31.4 |
| Tree open all, 50,228 rows rebuilt and rendered (ms) | 77.6 |
| Expand one folder in the open tree (ms) | 134.2 |
| Tree scroll frame ms p50/p95/p99/max | 16.7 / 16.8 / 16.9 / 17.1 |
| Tree scroll frames >25 / >33 ms | 0 / 0 of 300 |
| Tree collapse all (ms) | 33.3 |
| Grid mount, 100,000 rows (ms) | 33.2 |
| Grid scroll frame ms p50/p95/p99/max | 16.7 / 16.9 / 16.9 / 16.9 |
| Grid scroll frames >25 / >33 ms | 0 / 0 of 300 |

Scrolling holds 60 fps in both. The expand-one-folder number is the bench, not the app: the suite
held the rows in a deep `$state` proxy, which App.svelte does not (its rows are `$state.raw`), so
every change paid about 100 ms of proxy reads the app never pays. Fixed on 2026-11-08 (#195; see
"Tree row rebuild" below); the `ui` suite has not been re-run since, so this row is not current.

### Tree row rebuild: Home, 2026-11-08 (#195)

Every tree change rebuilds the whole row list: `TreeModel.rows()` from `onChange` in App.svelte. Timed
on main at 3233552 in the vitest projects (not a release build), over the same 50,228-node tree with
every node open, medians of 15 to 21 changes after a warm-up; the range is across runs (five in
Node, three in Chromium, one with the proxy). Guarded by `src/app/tree-model.perf.test.ts`, which
fails when the fastest round is over one 60 Hz frame (16 ms) locally or three on CI, and
`src/app/tree-scale.browser.test.ts`, which fails over three frames everywhere (the browser cannot
see the CI variable; a CI runner took 22 ms). They assert the fastest round because the median,
with the other test files running beside them, went past 16 ms locally.

| Step | Where | Median (ms) |
| --- | --- | --- |
| `rows()` after expanding or collapsing one folder | Node 24 (unit project) | 8.9 to 10.3 |
| `rows()` after setting the text filter | Node 24 (unit project) | 6.1 to 8.1 |
| `rows()` after hiding an engine | Node 24 (unit project) | 6.2 to 7.9 |
| Expand or collapse one folder, model change to the shipped `Tree` updated in the DOM | Headless Chromium (browser project) | 10.1 to 10.3 |
| The same, with the rows in a deep `$state` proxy as the `ui` suite had them | Headless Chromium (browser project) | 103.2 |

A change at 50k open rows fits in one frame, with about 6 ms to spare, so the rebuild stays a full
rebuild: incremental row updates would add state to keep in step for a tree that is rarely this
large. Two cheaper rebuilds were tried (no copy of each row, one `Date.now()` per rebuild) and were
inside the run-to-run noise, so they were not kept. The tests above are the guard; the work laptop
is slower, so re-check there before relying on the margin.

### Result grid height: Home, 2026-11-08 (#243)

The grid's scroll space is 26 + 22 px a row. Chromium clamps an element at 33,554,428 px, so in the
browser project at 1,600,000 and 2,000,000 rows the grid scrolls only to row 1,525,212 and the rest
cannot be reached. The row limit stops a set at 1,000,000 rows (22,000,026 px), and it cannot be
raised past that: the Settings field's maximum is 1,000,000, the sidecar refuses a higher value
when saved (ConfigStore) and resets one read from the store to the default. So no result can reach
the clamp, and the grid keeps its unscaled scroll space. `src/query/grid-scale.browser.test.ts` scrolls to the last row of a
1,000,000-row set; it fails (stops at 1,525,212) if fed 2,000,000.

### Sidecar line decoding: Home, 2026-11-08 (#200)

Each sidecar stdout line reaches the webview as a JSON string inside the event, then `rpc.ts` parses
it. Headless Chromium, 2,000 result batches as the sidecar sends them (500 rows x 12 columns of the
bench grid, 85.7 KB a line, 97.5 KB with the event around it), three runs:

| Step | Per batch (ms) | 1M rows (ms) |
| --- | --- | --- |
| Outer decode, event to the line string (the cost of encoding twice) | 0.09 | 175 to 181 |
| Inner parse, line to rows | 2.4 to 2.6 | 4,813 to 5,129 |

The probe keeps all 170 MB of lines alive, so its parse times are above the app's (1M rows stream
in 2.35 s end to end); the ratio is the finding. The second encoding adds under 4% to the parse, a tenth of a millisecond per batch, never close to
a frame. Not worth a Tauri `Channel` with raw payloads yet; the rows parse is the cost to look at
first.

### ADR 0004 prototypes: Home, 2026-10-29, v0.1.0 (60 Hz, DPR 1, 1280x800)

The M0 comparison of two prototype renderers, plain TypeScript and Svelte 5, which shared data, DOM
structure (spacer plus a translated window of recycled rows) and CSS so only the rendering layer
differed. The prototypes have since been removed; these numbers are kept for ADR 0004.

| Metric | plain-ts | svelte-5 |
| --- | --- | --- |
| Tree mount (ms) | 31.1 | 30.5 |
| Tree expand all, 50k rows (ms) | 33.5 | 33.3 |
| Tree collapse all (ms) | 33 | 32.7 |
| Tree scroll frame ms p50/p95/p99/max | 16.7 / 16.8 / 16.8 / 16.8 | 16.7 / 16.7 / 16.8 / 16.8 |
| Tree scroll frames >25 / >33 ms | 0 / 0 of 300 | 0 / 0 of 300 |
| Grid mount, 100k rows (ms) | 33.4 | 33.2 |
| Grid scroll frame ms p50/p95/p99/max | 16.7 / 16.8 / 16.8 / 16.8 | 16.7 / 16.8 / 16.8 / 16.9 |
| Grid scroll frames >25 / >33 ms | 0 / 0 of 300 | 0 / 0 of 300 |

Both hold 60 fps with no late frames. Mount and expand times sit at the two-frame floor of the
measurement, so the actual work fits inside one frame for both. On this machine the two are
indistinguishable; see ADR 0004.

### Work laptop

TBD.

## Install and Defender

| Date | Machine | Result |
| --- | --- | --- |
| 2026-10-29 | Home | Unsigned NSIS install of v0.1.0: Defender quarantined `panoptic.exe` as `Trojan:Win32/Bearfoos.A!ml` as the installer wrote it. Static scans of the exe, sidecar and installer were clean, and the same exe copied or run from the repo was not flagged, so the trigger is the install behaviour. A folder exclusion for `%LOCALAPPDATA%\Panoptic` fixed it; the GitHub v0.1.0 release then installed and ran. |
| 2026-10-29 | Work laptop (managed) | v0.2.0 NSIS install: no SmartScreen prompt, installed and ran without an exclusion. First launch showed "Not Responding" briefly (sidecar spawned on the UI thread; fixed in #15). Some time later Defender quarantined `panoptic.exe` as `Trojan:Win32/Bearfoos.A!ml`, the same false positive as at home but delayed, consistent with a cloud verdict on an unknown unsigned file. Conclusion: unsigned builds cannot be used on managed machines; every release is a new unknown hash. |
| 2026-10-29 | Work laptop (managed) | With a local Defender folder exclusion for `%LOCALAPPDATA%\Panoptic`, the installed copy survived and **auto-updated in place** to the next automatic release ("Restart to update"). The update pipeline works end to end. |

## Sidecar publish mode (M1)

Home, 2026-10-29. Once SqlClient, the Cosmos SDK and Azure.Identity were added, a stdio smoke test
(configure dev SQL and Cosmos, walk the tree) gave:

| Mode | Start-up | Size | Result |
| --- | --- | --- | --- |
| Native AOT | 18 ms | 32 MB | **Broken**: SqlClient "type initializer threw", Cosmos "configuration system failed to initialize" |
| ReadyToRun, self-contained single file | 58 ms | 134 MB | Works. SQL expands 1 to 16 ms; Cosmos expands 6 to 47 ms after a one-off 2.1 s first call (SDK account metadata) |

ReadyToRun is the release mode. 58 ms still runs in parallel with WebView2 start-up, so it does not
move first paint.

## ReadyToRun or not (release speed)

Home, 2026-10-29. Self-contained single-file sidecar, five starts each (first is cold, with bundle extraction):

| Mode | Publish (home) | Size | First response (cold, warm) | First SQL query | First Cosmos call |
| --- | --- | --- | --- | --- | --- |
| ReadyToRun | 17 s (~73 s in CI) | 134 MB | 478 ms, ~58 ms | ~117 ms | ~2.1 s |
| JIT (shipped) | 2 s | 98 MB | 417 ms, ~68 ms | ~207 ms | ~2.2 s |
| JIT, compressed single file | 4 s | 45 MB | 187 ms, ~106 ms | ~280 ms | ~2.2 s |

JIT ships: the first query of a session costs about 90 ms more but stays inside the 300 ms expand budget,
and each release saves over a minute. The ~2 s first Cosmos call is SDK warm-up and the same in every mode.
