<script lang="ts">
  // Test-only: the real Explorer on a TreeModel fed synthetic nodes, in a panel of a given width. Wired the way
  // App.svelte wires it, minus the dialogs.
  import { onMount } from "svelte";
  import type { TreeNode } from "../app/api";
  import Explorer from "../app/Explorer.svelte";
  import { TreeModel, type EngineSummary, type ExplorerSummary, type Row } from "../app/tree-model";

  let {
    nodes,
    width,
    expand = [],
    onMoveConnection,
    onReorderEnvironments,
  }: {
    nodes: Record<string, TreeNode[]>;
    width: number;
    expand?: string[];
    /** Drag and drop and Alt+Up/Down: recorded by the test, not saved. */
    onMoveConnection?: (connectionId: string, environmentId: string | null, beforeId?: string | null) => void;
    onReorderEnvironments?: (envOrder: string[]) => void;
  } = $props();

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
  let explorer = $state<Explorer>();

  /** What App does after Add connection. */
  export function reveal(key: string) {
    explorer?.reveal(key);
  }

  onMount(async () => {
    await model.loadRoot();
    await model.preload(model.envIds());
    for (const id of expand) await model.expand(id);
  });
</script>

<div class="panel" style:width="{width}px">
  <Explorer
    bind:this={explorer}
    {model}
    {rows}
    {engines}
    {hiddenEngines}
    {summary}
    bind:selectedKey
    onContextMenu={noop}
    onActivate={(r) => r.type === "node" && model.toggle(r.node.id)}
    onOpenProblem={noop}
    {onMoveConnection}
    {onReorderEnvironments}
    connected
    onNewConnection={noop}
    onNewEnvironment={noop}
    onImport={noop}
    onExpandAll={() => model.expandEnvironments()}
    onCollapseAll={() => model.collapseAll()}
    onSettings={noop}
  />
</div>

<style>
  .panel {
    height: 420px;
    background: var(--bg-pane);
  }
</style>
