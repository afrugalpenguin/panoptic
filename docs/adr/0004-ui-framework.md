# 0004. UI framework: Svelte 5, with hand-written virtualisation

- Status: Accepted
- Date: 2026-10-29

## Context

The tree and grid are the product and must hit 60 fps with 50k nodes and 100k rows. React and
Angular are familiar but heavier. The plan said to decide between Svelte 5 and plain TypeScript
from a benchmark, not a preference.

## Decision

Svelte 5 for the UI. The tree and grid keep a hand-written fixed-height virtual list (spacer, a
translated window, rows rendered by index) rather than a third-party virtual-list component.

The M0 benchmark (docs/benchmarks.md, home machine) rendered the same 50k-node tree and 100k-row
grid with the same DOM strategy in both. Both held 60 fps with zero frames over 25 ms, and mount,
expand-all and collapse-all all fit inside one frame for both. Speed did not separate them, so the
tie-breaker is the rest of the UI: connection dialogs, query tabs, panels and status bar are
substantially less code in Svelte, with no measured cost on the hot paths.

## Consequences

- A Svelte compile step and about 15 kB gzipped runtime join the bundle.
- If the work laptop benchmark shows Svelte losing frames where plain TS does not, the tree and
  grid can drop to plain TS behind the same component boundary without touching the rest of the UI.
- The plain-TS renderer stays in `src/bench` until the work laptop numbers are in.
