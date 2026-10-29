# Benchmarks

Budgets from the plan: window open under 500 ms, any node expanded under 300 ms, 100k-row grid
scrolling at 60 fps. Every number records the machine and date. Reproduce with
`scripts\bench.ps1` (see its help); it defaults to the installed copy, so the same script works on
the work laptop.

## Machines

| Name | Hardware | Notes |
| --- | --- | --- |
| Home (MAVERICK) | AMD Ryzen 9 7900X, 31 GB, Windows 11 build 26300, 60 Hz display | Dev machine |
| Work laptop | TBD | Intune-managed, Defender for Endpoint |

## Cold start

`.\scripts\bench.ps1 -Suite startup -Runs 10`. "Launch" is when the script calls Start-Process;
"first paint" is the webview's first contentful paint; "sidecar ready" is when the UI gets its
first `ping` response.

### Home, 2026-10-29, v0.1.0 (repo release build, AOT sidecar)

| Metric | Run 1 (coldest) | Median of 10 | Max |
| --- | --- | --- | --- |
| Launch to first paint (ms) | 454 | 396 | 454 |
| Launch to sidecar ready (ms) | 359 | 279 | 359 |
| Sidecar process start to ready (ms, Native AOT) | 21.9 | 20 | 24.9 |

Inside the 500 ms budget, but WebView2 start-up dominates: Rust `main()` to first paint averages
377 ms, while the sidecar is ready about 100 ms before the first paint. The .NET cold-start risk
in the plan is retired (Native AOT, 2.5 MB, about 20 ms). The webview is now the thing to watch on
the slower work laptop.

### Work laptop

TBD.

## Tree and grid frame times

`.\scripts\bench.ps1 -Suite ui`. Synthetic 50,228-node tree (env > connection > database > folder >
object) and 100,000-row x 12-column grid. Both renderers share data, DOM structure (spacer plus a
translated window of recycled rows) and CSS; only the rendering layer differs. Scroll is
programmatic, top to bottom over 5 s, one step per frame. Medians of 3 interleaved rounds.

### Home, 2026-10-29, v0.1.0 (60 Hz, DPR 1, 1280x800)

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
| | Work laptop | TBD: does SmartScreen allow it, does Defender for Endpoint quarantine it, can a local exclusion be added? |

## Sidecar publish mode (M1)

Home, 2026-10-29. Once SqlClient, the Cosmos SDK and Azure.Identity were added, a stdio smoke test
(configure dev SQL and Cosmos, walk the tree) gave:

| Mode | Start-up | Size | Result |
| --- | --- | --- | --- |
| Native AOT | 18 ms | 32 MB | **Broken**: SqlClient "type initializer threw", Cosmos "configuration system failed to initialize" |
| ReadyToRun, self-contained single file | 58 ms | 134 MB | Works. SQL expands 1 to 16 ms; Cosmos expands 6 to 47 ms after a one-off 2.1 s first call (SDK account metadata) |

ReadyToRun is the release mode. 58 ms still runs in parallel with WebView2 start-up, so it does not
move first paint.
