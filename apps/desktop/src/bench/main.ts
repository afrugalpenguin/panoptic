import "./bench.css";
import { flatten, generateGrid, generateTree, type GridData, type TreeData } from "./data";
import { summarise, type FrameStats } from "./stats";
import { svelte } from "./svelte";
import type { Renderer } from "./types";
import { vanilla } from "./vanilla";

const TREE_NODES = 50_000;
const GRID_ROWS = 100_000;
const SCROLL_MS = 5_000;
const ROUNDS = 3;
const RENDERERS: Renderer[] = [vanilla, svelte];

interface RunMetrics {
  treeMountMs: number;
  treeExpandAllMs: number;
  treeCollapseAllMs: number;
  treeScroll: FrameStats;
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
  medians: Record<string, RunMetrics>;
  raw: Record<string, RunMetrics[]>;
}

const host = document.querySelector<HTMLElement>("#host")!;
const status = document.querySelector<HTMLElement>("#status")!;
const output = document.querySelector<HTMLElement>("#results")!;
const runButton = document.querySelector<HTMLButtonElement>("#run")!;

const frame = () => new Promise<number>((r) => requestAnimationFrame(r));
/** Resolves after the browser has painted whatever the last synchronous work changed. */
const painted = async () => {
  await frame();
  await frame();
};

async function timed(work: () => void): Promise<number> {
  const t0 = performance.now();
  work();
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

async function runOnce(r: Renderer, tree: TreeData, grid: GridData): Promise<RunMetrics> {
  host.replaceChildren();
  const collapsed = new Uint8Array(tree.count);
  const all = new Uint8Array(tree.count).fill(1);

  let view!: ReturnType<Renderer["mountTree"]>;
  const treeMountMs = await timed(() => (view = r.mountTree(host, tree, flatten(tree, collapsed), collapsed)));
  const treeExpandAllMs = await timed(() => view.setRows(flatten(tree, all), all));
  const treeScroll = await scrollThrough(view.scroller, SCROLL_MS);
  const treeCollapseAllMs = await timed(() => view.setRows(flatten(tree, collapsed), collapsed));
  view.destroy();
  host.replaceChildren();

  let gridView!: ReturnType<Renderer["mountGrid"]>;
  const gridMountMs = await timed(() => (gridView = r.mountGrid(host, grid)));
  const gridScroll = await scrollThrough(gridView.scroller, SCROLL_MS);
  gridView.destroy();
  host.replaceChildren();

  return { treeMountMs, treeExpandAllMs, treeCollapseAllMs, treeScroll, gridMountMs, gridScroll };
}

function median(values: number[]): number {
  const s = [...values].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
}

function medianMetrics(runs: RunMetrics[]): RunMetrics {
  const stats = (key: "treeScroll" | "gridScroll"): FrameStats => {
    const fields = Object.keys(runs[0][key]) as (keyof FrameStats)[];
    return Object.fromEntries(fields.map((f) => [f, median(runs.map((r) => r[key][f]))])) as unknown as FrameStats;
  };
  return {
    treeMountMs: median(runs.map((r) => r.treeMountMs)),
    treeExpandAllMs: median(runs.map((r) => r.treeExpandAllMs)),
    treeCollapseAllMs: median(runs.map((r) => r.treeCollapseAllMs)),
    treeScroll: stats("treeScroll"),
    gridMountMs: median(runs.map((r) => r.gridMountMs)),
    gridScroll: stats("gridScroll"),
  };
}

export async function runAll(): Promise<UiBenchResult> {
  status.textContent = "Generating fixtures...";
  await painted();
  const tree = generateTree(TREE_NODES);
  const grid = generateGrid(GRID_ROWS);
  const refreshHz = await measureRefreshHz();

  const raw: Record<string, RunMetrics[]> = Object.fromEntries(RENDERERS.map((r) => [r.name, []]));
  for (let round = 0; round < ROUNDS; round++) {
    // Alternate order each round so neither renderer always runs on a cold JIT.
    const order = round % 2 ? [...RENDERERS].reverse() : RENDERERS;
    for (const r of order) {
      status.textContent = `Round ${round + 1}/${ROUNDS}: ${r.name}...`;
      raw[r.name].push(await runOnce(r, tree, grid));
    }
  }

  const medians = Object.fromEntries(RENDERERS.map((r) => [r.name, medianMetrics(raw[r.name])]));
  status.textContent = "Done.";
  return {
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
    medians,
    raw,
  };
}

export function toMarkdown(r: UiBenchResult): string {
  const names = Object.keys(r.medians);
  const row = (label: string, pick: (m: RunMetrics) => string) =>
    `| ${label} | ${names.map((n) => pick(r.medians[n])).join(" | ")} |`;
  const frames = (s: FrameStats) => `${s.p50} / ${s.p95} / ${s.p99} / ${s.max}`;
  const dropped = (s: FrameStats) => `${s.over25} / ${s.over33} of ${s.frames}`;
  return [
    `Medians of ${r.rounds} rounds. ${r.treeNodes} tree nodes, ${r.gridRows} grid rows, ${r.scrollMs / 1000} s scroll. Display ${r.refreshHz} Hz, DPR ${r.devicePixelRatio}, viewport ${r.viewport}.`,
    "",
    `| Metric | ${names.join(" | ")} |`,
    `| --- | ${names.map(() => "---").join(" | ")} |`,
    row("Tree mount (ms)", (m) => `${m.treeMountMs}`),
    row("Tree expand all 50k (ms)", (m) => `${m.treeExpandAllMs}`),
    row("Tree collapse all (ms)", (m) => `${m.treeCollapseAllMs}`),
    row("Tree scroll frame ms p50/p95/p99/max", (m) => frames(m.treeScroll)),
    row("Tree scroll frames >25 / >33 ms", (m) => dropped(m.treeScroll)),
    row("Grid mount 100k (ms)", (m) => `${m.gridMountMs}`),
    row("Grid scroll frame ms p50/p95/p99/max", (m) => frames(m.gridScroll)),
    row("Grid scroll frames >25 / >33 ms", (m) => dropped(m.gridScroll)),
  ].join("\n");
}

function round(n: number) {
  return Math.round(n * 10) / 10;
}

async function run(): Promise<UiBenchResult> {
  runButton.disabled = true;
  try {
    const result = await runAll();
    output.textContent = toMarkdown(result);
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
