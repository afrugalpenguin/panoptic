<script lang="ts">
  import { onDestroy } from "svelte";
  import EngineFilter from "./EngineFilter.svelte";
  import { engineControl, summaryText } from "./explorer-view";
  import IconButton from "./IconButton.svelte";
  import Tree from "./Tree.svelte";
  import type { EngineSummary, ExplorerSummary, Row, TreeModel } from "./tree-model";

  /**
   * The explorer panel (docs/explorer-ux.md, "Layout (top to bottom)"): a 36px filter bar, the tree, and a footer
   * that sits over the bottom of the tree. Nothing in it scrolls horizontally, down to a 220px panel.
   */
  let {
    model,
    rows,
    engines,
    hiddenEngines,
    summary,
    selectedKey = $bindable(),
    onContextMenu,
    onActivate,
    onOpenProblem,
    onMoveConnection,
    disconnected = false,
    showKindBadge = true,
    rowFont = "mono",
    connected,
    emptyHint = false,
    onNewConnection,
    onNewEnvironment,
    onImport,
    onExpandAll,
    onCollapseAll,
    onSettings,
  }: {
    model: TreeModel;
    rows: Row[];
    engines: EngineSummary[];
    hiddenEngines: ReadonlySet<string>;
    summary: ExplorerSummary;
    selectedKey: string | undefined;
    onContextMenu: (row: Row, x: number, y: number) => void;
    onActivate: (row: Row) => void;
    onOpenProblem: (parentId: string) => void;
    onMoveConnection?: (connectionId: string, environmentId: string | null) => void;
    disconnected?: boolean;
    showKindBadge?: boolean;
    rowFont?: "mono" | "ui";
    /** The engine is up: New connection, Import and Settings need it. */
    connected: boolean;
    /** Nothing configured yet: "No connections yet." over the empty tree. */
    emptyHint?: boolean;
    onNewConnection: () => void;
    onNewEnvironment: () => void;
    onImport: () => void;
    onExpandAll: () => void;
    onCollapseAll: () => void;
    onSettings: () => void;
  } = $props();

  /** Typing settles this long before the tree model is filtered. */
  const FILTER_DEBOUNCE_MS = 50;

  let tree = $state<Tree>();
  let text = $state("");
  let barWidth = $state(0);
  let filterWidth = $state(0);
  let timer: ReturnType<typeof setTimeout> | undefined;

  const form = $derived(engineControl(barWidth, engines.length));
  const summaryLine = $derived(summaryText(summary));

  function onFilterInput() {
    clearTimeout(timer);
    timer = setTimeout(() => model.setTextFilter(text), FILTER_DEBOUNCE_MS);
  }

  function onFilterKeydown(e: KeyboardEvent) {
    if (e.key === "Escape" && text) {
      e.preventDefault();
      text = "";
      clearTimeout(timer);
      model.setTextFilter("");
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      tree?.focus();
    }
  }

  onDestroy(() => clearTimeout(timer));

  /** Seek's Esc (docs/landing.md) hands focus to the tree. */
  export function focus() {
    tree?.focus();
  }
</script>

<div class="explorer">
  <div class="filter-bar" bind:clientWidth={barWidth}>
    <span class="filter" bind:clientWidth={filterWidth}>
      <input
        type="text"
        spellcheck="false"
        autocomplete="off"
        aria-label="Filter connections"
        placeholder={filterWidth > 200 ? "Filter connections" : "Filter"}
        bind:value={text}
        oninput={onFilterInput}
        onkeydown={onFilterKeydown}
      />
    </span>
    {#if form !== "none"}
      <EngineFilter {engines} hidden={hiddenEngines} {form} onChange={(next) => model.setHiddenEngines(next)} />
    {/if}
  </div>
  <div class="tree-host">
    {#if emptyHint}
      <p class="hint muted">No connections yet.</p>
    {/if}
    <Tree
      bind:this={tree}
      {model}
      {rows}
      bind:selectedKey
      {onContextMenu}
      {onActivate}
      {onOpenProblem}
      {onMoveConnection}
      {disconnected}
      {showKindBadge}
      {rowFont}
      {footer}
    />
  </div>
</div>

{#snippet footer()}
  <div class="footer">
    <IconButton icon="connection" label="New connection" disabled={!connected} onclick={onNewConnection} />
    <IconButton icon="environment" label="New environment" onclick={onNewEnvironment} />
    <IconButton icon="import" label="Import from SSMS, Azure Data Studio or VS Code" disabled={!connected} onclick={onImport} />
    <span class="separator" aria-hidden="true"></span>
    <IconButton icon="collapse-all" label="Collapse all" disabled={rows.length === 0} onclick={onCollapseAll} />
    <IconButton icon="expand-all" label="Expand all" disabled={rows.length === 0} onclick={onExpandAll} />
    <span class="summary" role="status" title={summaryLine.long}>
      <span class="long">{summaryLine.long}</span>
      <span class="short" aria-hidden="true">{summaryLine.short}</span>
    </span>
    <IconButton icon="settings" label="Settings" disabled={!connected} onclick={onSettings} />
  </div>
{/snippet}

<style>
  .explorer {
    display: flex;
    flex-direction: column;
    height: 100%;
    min-width: 0;
    /* Size container so the engine popover can cap its height at the panel's (cqh). */
    container-type: size;
  }
  .filter-bar {
    position: relative;
    display: flex;
    align-items: center;
    gap: 6px;
    flex: none;
    box-sizing: border-box;
    height: 36px;
    padding: 0 6px;
    border-bottom: 1px solid var(--border);
    container: filter-bar / inline-size;
  }
  .filter {
    display: flex;
    flex: 1;
    min-width: 0;
  }
  .filter input {
    box-sizing: border-box;
    width: 100%;
    min-width: 0;
    height: 24px;
    padding: 0 8px;
    border: 1px solid var(--border);
    border-radius: 4px;
    background: var(--bg);
    color: var(--text);
    font: inherit;
    font-size: 12px;
  }
  .filter input:focus {
    outline: 1px solid var(--accent);
    outline-offset: -1px;
  }
  .tree-host {
    position: relative;
    flex: 1;
    min-height: 0;
  }
  .hint {
    position: absolute;
    inset: 12px auto auto 16px;
    margin: 0;
    pointer-events: none;
  }
  .footer {
    display: flex;
    align-items: center;
    height: 100%;
    box-sizing: border-box;
    padding: 0 4px;
    container: explorer-footer / inline-size;
  }
  .footer :global(.icon-button) {
    flex: none;
    width: 26px;
    height: 26px;
  }
  .separator {
    flex: none;
    width: 1px;
    height: 16px;
    margin: 0 3px;
    background: var(--border);
  }
  .summary {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    padding: 0 4px;
    text-align: right;
    white-space: nowrap;
    font-size: 10.5px;
    color: var(--text-muted);
  }
  .short {
    display: none;
  }
  /* Under 260px the words go; the long form stays for screen readers. */
  @container explorer-footer (width < 260px) {
    .long {
      position: absolute;
      width: 1px;
      height: 1px;
      overflow: hidden;
      clip-path: inset(50%);
    }
    .short {
      display: inline;
    }
  }
</style>
