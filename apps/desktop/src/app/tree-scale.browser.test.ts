import { flushSync } from "svelte";
import { afterEach, expect, it } from "vitest";
import { generateTree } from "../bench/data";
import { createTree, type BenchTree } from "../bench/shipped.svelte";
import { openAll, treeSource } from "../bench/tree-source";

// #195: every model change re-reads the whole row list and re-renders the shipped Tree. This times one expand or
// collapse in an open 50k-node tree, from the model change to the DOM updated, against one 60 Hz frame (16 ms). The
// fastest round is asserted, as in tree-model.perf.test.ts, so other test files running beside it do not fail it; one
// frame locally, three on CI. The median is logged (docs/benchmarks.md, "Tree row rebuild").
const FRAME_MS = 16 * (import.meta.env.CI ? 3 : 1);
// Wall-clock cap for the whole test, not a budget (see engine.perf.test.ts, #260). Only the timing assertion decides.
const TEST_TIMEOUT_MS = 60_000;

let tree: BenchTree | undefined;
let host: HTMLElement | undefined;
afterEach(() => {
  tree?.destroy();
  host?.remove();
});

it("expands and collapses a folder in an open 50k-node tree inside one frame", async () => {
  const source = treeSource(generateTree(50_000));
  tree = await createTree(source);
  host = document.createElement("div");
  host.style.cssText = "display: flex; width: 400px; height: 800px";
  document.body.append(host);
  const scroller = tree.mount(host);
  tree.setLive(false);
  await openAll(tree.model, source);
  tree.setLive(true);
  tree.render();
  const spacer = scroller.querySelector<HTMLElement>(".spacer")!;
  const open = spacer.style.minHeight;

  const folder = source.lastFolder;
  const times: number[] = [];
  for (let i = 0; i < 21; i++) {
    const start = performance.now();
    // Loaded already, so both run the change synchronously, as a click on a loaded folder does.
    if (i % 2) void tree.model.expand(folder);
    else tree.model.collapse(folder);
    flushSync();
    times.push(performance.now() - start);
    // The change reached the DOM: the scroll space shrinks with the folder closed.
    expect(spacer.style.minHeight === open).toBe(i % 2 === 1);
  }
  times.sort((a, b) => a - b);
  const median = times[Math.floor(times.length / 2)];

  console.log(`Tree change perf: 50k-node open tree, expand/collapse to DOM ${median.toFixed(2)} ms median, ${times[0].toFixed(2)} fastest`);
  expect(times[0]).toBeLessThan(FRAME_MS);
}, TEST_TIMEOUT_MS);
