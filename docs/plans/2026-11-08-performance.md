# Performance tuning (#190)

#190 asks for a proper look at performance rather than one number at a time. This round has five workstreams, one PR each, all based on main.

## Baseline: Home, 2026-11-08

Release build of main at 63665cc, Ryzen 9 7900X, 120 Hz display (so frame-bound numbers resolve to 8.3 ms, not 16.7), dev-seeded store, Docker dev databases.

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
| Idle memory, whole process tree | 420 MB (2026-10-31) | none |
| Tree and grid scrolling, 50k nodes / 100k rows | 120 fps, no frame over 25 ms | 60 fps |

## Workstreams

1. **Guardrails** (`chore/perf-guardrails`). This PR also adds this plan.
   - Make the startup bench safe with the single-instance lock: a bench run must never focus the user's installed app and exit.
   - Add idle memory (whole process tree) and sidecar size to the bench output.
   - Add a CI job that records sizes and timings in the job summary on every PR. It fails only on budgets that are deterministic (sidecar publish size, frontend bundle size), because timings on shared runners are too noisy to gate on.
   - Write the budgets into docs/benchmarks.md, including the missing ones.
2. **Cosmos first expand** (#185). Find where the 2.25 s goes before choosing a fix: SDK and JIT start-up, account and address resolution, TLS to the emulator, serializer start-up. Then cut what can be cut, and warm the rest in the background once the sidecar is ready (generic per engine, through IBackend), or when a connection is selected. Target: under 300 ms cold against the emulator, with the network share stated separately.
3. **Start-up and first paint**. Trace the critical path from launch to tree rendered (Rust main, webview creation, sidecar spawn, ping, config, preload, first paint) and shorten it: start work in parallel, and defer what is not needed for the first screen. Look at why a fresh WebView2 profile costs 875 ms and whether the installer or first run can pre-create it. Connection metadata stays in the encrypted store: any plaintext cache of names or hosts is a decision for the user, not this PR.
4. **Interaction latency**. Ctrl+N to editor under 50 ms (preload Monaco and its worker when idle after first paint), query tab open, and the cost of parsing result rows (#200 measured the row parse as the real cost: about 2.5 ms per 500-row batch).
5. **Memory**. Break down the idle 420 MB by process (shell, WebView2 browser, renderer, GPU, utility, sidecar) and the sidecar's growth after the first expands. Trim what is safe: GC settings, lazy-loading engine assemblies, WebView2 memory target when hidden or minimised, unused WebView2 features. Then propose a budget.

## Rules for measuring

- Measure release builds (`pnpm tauri build --no-bundle`), never dev builds.
- Compare A/B on the same machine in the same sitting: baseline and change, interleaved, at least 10 runs for startup and 5 for expand.
- Report medians and run 1 (cold).
- Several workstreams run at once on one machine. A timing run holds the lock directory `%TEMP%\panoptic-bench.lock`: create it with `mkdir`, wait while it exists, and remove it when done. Even so, other builds may be running, which is why A/B runs are interleaved.
- Numbers go in each PR body. docs/benchmarks.md is updated by the guardrails PR, and once all five land, by one docs PR, to avoid conflicts.
