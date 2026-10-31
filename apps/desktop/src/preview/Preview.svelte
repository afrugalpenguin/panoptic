<script lang="ts">
  // Dev-only: the real tree beside the landing, fed synthetic nodes (docs/plans/2026-10-31-loose-connections.md, Task 9).
  import { onMount } from "svelte";
  import type { TreeNode } from "../app/api";
  import Landing from "../app/Landing.svelte";
  import type { SeekIndex } from "../app/seek";
  import Tree from "../app/Tree.svelte";
  import { TreeModel, type Row } from "../app/tree-model";

  let {
    nodes,
    expand,
    index,
    envCount,
    connectionCount,
  }: { nodes: Record<string, TreeNode[]>; expand: string[]; index: SeekIndex; envCount: number; connectionCount: number } = $props();

  let rows = $state.raw<Row[]>([]);
  let selectedKey = $state<string>();
  // svelte-ignore state_referenced_locally
  const model = new TreeModel(async (id) => nodes[id] ?? [], () => (rows = model.rows()));
  const noop = () => {};

  onMount(async () => {
    await model.loadRoot();
    await model.preload(model.envIds());
    for (const id of expand) await model.expand(id);
  });
</script>

<div class="shell">
  <aside class="explorer">
    <div class="toolbar">EXPLORER</div>
    <div class="tree-host">
      <Tree {model} {rows} bind:selectedKey onContextMenu={noop} onActivate={(r) => r.type === "node" && model.toggle(r.node.id)} onOpenProblem={noop} />
    </div>
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
    grid-template-columns: 360px 1fr;
    height: 100vh;
  }
  .explorer {
    display: flex;
    flex-direction: column;
    min-height: 0;
    background: var(--bg-pane);
    border-right: 1px solid var(--border);
  }
  .toolbar {
    display: flex;
    align-items: center;
    height: 40px;
    padding: 0 12px;
    border-bottom: 1px solid var(--border);
    color: var(--text-muted);
    font-size: 11px;
    font-weight: 600;
    letter-spacing: 0.06em;
  }
  .tree-host {
    flex: 1;
    min-height: 0;
  }
  main {
    min-width: 0;
    min-height: 0;
  }
</style>
