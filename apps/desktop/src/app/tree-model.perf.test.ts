import { expect, it } from "vitest";
import { generateTree } from "../bench/data";
import { openAll, treeSource } from "../bench/tree-source";
import { TreeModel } from "./tree-model";

// #195: every model change rebuilds the whole row list (App.svelte re-reads rows() in onChange). This times that
// rebuild on the shipped TreeModel over the 50k-node bench tree, after each kind of change, against one 60 Hz frame
// (16 ms). The fastest of several rounds is asserted, not the median: with the other test files running beside it the
// median of a rebuild that takes about 10 ms alone went past 16 ms locally. Asserted at one frame locally and at three
// on CI, whose runners are slower; the medians are logged and docs/benchmarks.md ("Tree row rebuild") has them alone.
const FRAME_MS = 16 * (import.meta.env.CI ? 3 : 1);
// Wall-clock cap for the whole test, not a budget (see engine.perf.test.ts, #260). Only the timing assertions decide.
const TEST_TIMEOUT_MS = 60_000;

/** Fastest and median ms of `rows()` straight after `change`, over several rounds; the change itself is not timed. */
function rebuildMs(model: TreeModel, change: (round: number) => void, rounds = 15): { fastest: number; median: number } {
  const times: number[] = [];
  for (let i = 0; i < rounds; i++) {
    change(i);
    const start = performance.now();
    model.rows();
    times.push(performance.now() - start);
  }
  times.sort((a, b) => a - b);
  return { fastest: times[0], median: times[Math.floor(times.length / 2)] };
}

it("rebuilds the rows of an open 50k-node tree inside one frame after expand, collapse and filter", async () => {
  const source = treeSource(generateTree(50_000));
  const model = new TreeModel(source.load, () => {});
  await model.loadRoot();
  await model.expandEnvironments();
  await openAll(model, source);
  const count = model.rows().length;
  expect(count).toBeGreaterThan(50_000);

  // Warm the JIT on the same work first, as a running app is.
  rebuildMs(model, () => {}, 5);
  const folder = source.lastFolder;
  const toggle = rebuildMs(model, (i) => (i % 2 ? model.expand(folder) : model.collapse(folder)));
  const filter = rebuildMs(model, (i) => model.setTextFilter(i % 2 ? "" : "sql"));
  model.setTextFilter("");
  const engine = rebuildMs(model, (i) => model.setHiddenEngines(i % 2 ? [] : ["cosmos"]));

  const ms = ({ fastest, median }: { fastest: number; median: number }) => `${median.toFixed(2)} (fastest ${fastest.toFixed(2)})`;
  console.log(`Tree rebuild perf: ${count} rows, median ms: expand/collapse ${ms(toggle)}, text filter ${ms(filter)}, engine filter ${ms(engine)}`);
  expect(toggle.fastest).toBeLessThan(FRAME_MS);
  expect(filter.fastest).toBeLessThan(FRAME_MS);
  expect(engine.fastest).toBeLessThan(FRAME_MS);
}, TEST_TIMEOUT_MS);
