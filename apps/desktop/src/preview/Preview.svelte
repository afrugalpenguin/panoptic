<script lang="ts">
  // Dev-only: the real tree beside the landing, fed synthetic nodes (docs/plans/2026-10-31-loose-connections.md, Task 9).
  import { onMount } from "svelte";
  import type { TreeNode } from "../app/api";
  import Landing from "../app/Landing.svelte";
  import type { SeekIndex } from "../app/seek";
  import Explorer from "../app/Explorer.svelte";
  import { TreeModel, type EngineSummary, type ExplorerSummary, type Row } from "../app/tree-model";

  let {
    nodes,
    expand,
    index,
    envCount,
    connectionCount,
    width = 360,
  }: { nodes: Record<string, TreeNode[]>; expand: string[]; index: SeekIndex; envCount: number; connectionCount: number; width?: number } = $props();

  let rows = $state.raw<Row[]>([]);
  let engines = $state.raw<EngineSummary[]>([]);
  let hiddenEngines = $state.raw<ReadonlySet<string>>(new Set());
  let summary = $state.raw<ExplorerSummary>({ environments: 0, connections: 0, matching: 0 });
  let selectedKey = $state<string>();
  // svelte-ignore state_referenced_locally
  const model = new TreeModel(
    async (id) => nodes[id] ?? [],
    () => {
      rows = model.rows();
      engines = model.engines();
      hiddenEngines = model.hiddenEngines();
      summary = model.summary();
    },
  );
  const noop = () => {};

  onMount(async () => {
    await model.loadRoot();
    await model.preload(model.envIds());
    for (const id of expand) await model.expand(id);
  });
</script>

<div class="shell" style:grid-template-columns="{width}px 1fr">
  <aside class="explorer">
    <Explorer
      {model}
      {rows}
      {engines}
      {hiddenEngines}
      {summary}
      bind:selectedKey
      onContextMenu={noop}
      onActivate={(r) => r.type === "node" && model.toggle(r.node.id)}
      onOpenProblem={noop}
      connected
      onNewConnection={noop}
      onNewEnvironment={noop}
      onImport={noop}
      onExpandAll={() => model.expandEnvironments()}
      onCollapseAll={() => model.collapseAll()}
      onSettings={noop}
    />
  </aside>
  <main>
    <Landing
      {index}
      {envCount}
      {connectionCount}
      version="0.2.0"
      engine="connected"
      openedMs={412}
      onSeekOpen={noop}
      onSeekQuery={noop}
      onSeekLeave={noop}
      onReopen={noop}
      onNewQuery={noop}
      onNewConnection={noop}
      onImport={noop}
      onRestart={noop}
    />
  </main>
</div>

<style>
  .shell {
    display: grid;
    height: 100vh;
  }
  .explorer {
    min-width: 0;
    min-height: 0;
    background: var(--bg-pane);
    border-right: 1px solid var(--border);
  }
  main {
    min-width: 0;
    min-height: 0;
  }
</style>
