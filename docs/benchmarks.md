# Benchmarks

Budgets from the plan: window open under 500 ms, any node expanded under 300 ms, 100k-row grid
scrolling at 60 fps. Every number records the machine and date. Reproduce with
`scripts\bench.ps1` (see its help); it defaults to the installed copy, so the same script works on
the work laptop. Its suites: `startup` (window open), `expand` (the 300 ms budget, against the local
Docker databases) and `ui` (the shipped tree and grid at scale).

## Machines

| Name | Hardware | Notes |
| --- | --- | --- |
| Home | AMD Ryzen 9 7900X, 31 GB, Windows 11 build 26300, 60 Hz display | Dev machine |
| Work laptop | TBD | Intune-managed, Defender for Endpoint |

## Cold start

`.\scripts\bench.ps1 -Suite startup -Runs 10`. "Launch" is when the script calls Start-Process;
"first paint" is the webview's first contentful paint; "sidecar ready" is when the UI gets its
first `ping` response; "tree rendered" is when the explorer has painted the environments and
connections it loaded after that (config only, no server calls).

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

Scrolling holds 60 fps in both. Expanding one folder costs more than opening the whole tree: the
model rebuilds every row on each change (#195), and an expand changes twice (the loading row, then
the children), so in a 50k-row tree one click spends 134 ms of the 300 ms budget before any server
time.

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
