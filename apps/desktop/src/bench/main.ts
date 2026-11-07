import "../app/app.css";
import "./bench.css";
import { generateGrid, generateTree } from "./data";
import { createTree, mountGrid, resultSet } from "./shipped.svelte";
import { median, summarise, type FrameStats } from "./stats";
import { openAll, treeSource } from "./tree-source";

const TREE_NODES = 50_000;
const GRID_ROWS = 100_000;
const SCROLL_MS = 5_000;
const ROUNDS = 3;

/** One round against the shipped explorer Tree (through TreeModel) and ResultGrid. */
interface RunMetrics {
  /** Mount with every environment open, as after Expand all at start-up. */
  treeMountMs: number;
  /** Every node open: the rows rebuilt from the model and rendered once. */
  treeOpenAllMs: number;
  /** One folder expanded inside the otherwise open tree, through the model as a click does. */
  treeExpandOneMs: number;
  treeScroll: FrameStats;
  treeCollapseAllMs: number;
  gridMountMs: number;
  gridScroll: FrameStats;
}

export interface UiBenchResult {
  kind: "ui";
  date: string;
  refreshHz: number;
  devicePixelRatio: number;
  viewport: string;
  userAgent: string;
  treeNodes: number;
  gridRows: number;
  rounds: number;
  scrollMs: number;
  median: RunMetrics;
  raw: RunMetrics[];
  /** The results as the Markdown table for docs/benchmarks.md; bench.ps1 prints it. */
  markdown: string;
}

const host = document.querySelector<HTMLElement>("#host")!;
const status = document.querySelector<HTMLElement>("#status")!;
const output = document.querySelector<HTMLElement>("#results")!;
const runButton = document.querySelector<HTMLButtonElement>("#run")!;

const frame = () => new Promise<number>((r) => requestAnimationFrame(r));
/** Resolves after the browser has painted whatever the last work changed. */
const painted = async () => {
  await frame();
  await frame();
};

async function timed(work: () => unknown): Promise<number> {
  const t0 = performance.now();
  await work();
  await painted();
  return round(performance.now() - t0);
}

/** Scrolls top to bottom at constant speed, one step per frame, recording frame intervals. */
async function scrollThrough(scroller: HTMLElement, durationMs: number): Promise<FrameStats> {
  scroller.scrollTop = 0;
  await painted();
  const max = scroller.scrollHeight - scroller.clientHeight;
  const deltas: number[] = [];
  const start = await frame();
  let last = start;
  for (;;) {
    const t = await frame();
    deltas.push(t - last);
    last = t;
    const p = Math.min(1, (t - start) / durationMs);
    scroller.scrollTop = p * max;
    if (p >= 1) break;
  }
  // Let the last scroll event land before the caller unmounts the component.
  await painted();
  return summarise(deltas);
}

async function measureRefreshHz(): Promise<number> {
  const deltas: number[] = [];
  let last = await frame();
  for (let i = 0; i < 60; i++) {
    const t = await frame();
    deltas.push(t - last);
    last = t;
  }
  return Math.round(1000 / summarise(deltas).p50);
}

async function runOnce(source: ReturnType<typeof treeSource>, set: ReturnType<typeof resultSet>): Promise<RunMetrics> {
  host.replaceChildren();
  const tree = await createTree(source);
  let scroller!: HTMLElement;
  const treeMountMs = await timed(() => (scroller = tree.mount(host)));

  tree.setLive(false);
  await openAll(tree.model, source, source.lastFolder);
  tree.setLive(true);
  const treeOpenAllMs = await timed(() => tree.render());
  const treeExpandOneMs = await timed(() => tree.model.expand(source.lastFolder));
  const treeScroll = await scrollThrough(scroller, SCROLL_MS);
  const treeCollapseAllMs = await timed(() => tree.model.collapseAll());
  tree.destroy();
  host.replaceChildren();

  let grid!: ReturnType<typeof mountGrid>;
  const gridMountMs = await timed(() => (grid = mountGrid(host, set)));
  const gridScroll = await scrollThrough(grid.scroller, SCROLL_MS);
  grid.destroy();
  host.replaceChildren();

  return { treeMountMs, treeOpenAllMs, treeExpandOneMs, treeScroll, treeCollapseAllMs, gridMountMs, gridScroll };
}

function medianMetrics(runs: RunMetrics[]): RunMetrics {
  const ms = (key: "treeMountMs" | "treeOpenAllMs" | "treeExpandOneMs" | "treeCollapseAllMs" | "gridMountMs") =>
    round(median(runs.map((r) => r[key])));
  const stats = (key: "treeScroll" | "gridScroll"): FrameStats => {
    const fields = Object.keys(runs[0][key]) as (keyof FrameStats)[];
    return Object.fromEntries(fields.map((f) => [f, round(median(runs.map((r) => r[key][f])))])) as unknown as FrameStats;
  };
  return {
    treeMountMs: ms("treeMountMs"),
    treeOpenAllMs: ms("treeOpenAllMs"),
    treeExpandOneMs: ms("treeExpandOneMs"),
    treeScroll: stats("treeScroll"),
    treeCollapseAllMs: ms("treeCollapseAllMs"),
    gridMountMs: ms("gridMountMs"),
    gridScroll: stats("gridScroll"),
  };
}

export async function runAll(): Promise<UiBenchResult> {
  status.textContent = "Generating fixtures...";
  await painted();
  const tree = generateTree(TREE_NODES);
  const source = treeSource(tree);
  const grid = generateGrid(GRID_ROWS);
  const set = resultSet(grid);
  const refreshHz = await measureRefreshHz();

  const raw: RunMetrics[] = [];
  for (let r = 0; r < ROUNDS; r++) {
    status.textContent = `Round ${r + 1}/${ROUNDS}...`;
    raw.push(await runOnce(source, set));
  }

  status.textContent = "Done.";
  const result: Omit<UiBenchResult, "markdown"> = {
    kind: "ui",
    date: new Date().toISOString(),
    refreshHz,
    devicePixelRatio: window.devicePixelRatio,
    viewport: `${window.innerWidth}x${window.innerHeight}`,
    userAgent: navigator.userAgent,
    treeNodes: tree.count,
    gridRows: grid.rowCount,
    rounds: ROUNDS,
    scrollMs: SCROLL_MS,
    median: medianMetrics(raw),
    raw,
  };
  return { ...result, markdown: toMarkdown(result) };
}

export function toMarkdown(r: Omit<UiBenchResult, "markdown">): string {
  const m = r.median;
  const frames = (s: FrameStats) => `${s.p50} / ${s.p95} / ${s.p99} / ${s.max}`;
  const dropped = (s: FrameStats) => `${s.over25} / ${s.over33} of ${s.frames}`;
  return [
    `Medians of ${r.rounds} rounds. ${r.treeNodes} tree nodes, ${r.gridRows} grid rows, ${r.scrollMs / 1000} s scroll. Display ${r.refreshHz} Hz, DPR ${r.devicePixelRatio}, viewport ${r.viewport}.`,
    "",
    "| Metric | Shipped Tree and ResultGrid |",
    "| --- | --- |",
    `| Tree mount, environments open (ms) | ${m.treeMountMs} |`,
    `| Tree open all, ${r.treeNodes} rows rebuilt and rendered (ms) | ${m.treeOpenAllMs} |`,
    `| Expand one folder in the open tree (ms) | ${m.treeExpandOneMs} |`,
    `| Tree scroll frame ms p50/p95/p99/max | ${frames(m.treeScroll)} |`,
    `| Tree scroll frames >25 / >33 ms | ${dropped(m.treeScroll)} |`,
    `| Tree collapse all (ms) | ${m.treeCollapseAllMs} |`,
    `| Grid mount, ${r.gridRows} rows (ms) | ${m.gridMountMs} |`,
    `| Grid scroll frame ms p50/p95/p99/max | ${frames(m.gridScroll)} |`,
    `| Grid scroll frames >25 / >33 ms | ${dropped(m.gridScroll)} |`,
  ].join("\n");
}

function round(n: number) {
  return Math.round(n * 10) / 10;
}

async function run(): Promise<UiBenchResult> {
  runButton.disabled = true;
  try {
    const result = await runAll();
    output.textContent = result.markdown;
    return result;
  } finally {
    runButton.disabled = false;
  }
}

runButton.addEventListener("click", () => run().catch((e) => (status.textContent = String(e))));

if (new URLSearchParams(location.search).has("auto")) {
  const { finishBenchmark } = await import("../startup");
  run()
    .then((result) => finishBenchmark(result))
    .catch((e) => finishBenchmark({ kind: "ui", error: String(e) }));
}
