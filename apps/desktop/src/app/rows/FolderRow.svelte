<script lang="ts">
  import type { Row } from "../tree-model";
  import WarningIcon from "./WarningIcon.svelte";

  let { row }: { row: Extract<Row, { type: "node" }> } = $props();
</script>

<span class="chevron" class:open={row.expanded}></span>
<svg class="folder" viewBox="0 0 12 12" aria-hidden="true">
  <path d="M1 2.5h3.5l1 1H11v6.5H1z" fill="none" stroke="currentColor" stroke-width="1" stroke-linejoin="round" />
</svg>
<span class="name">{row.node.label}</span>
{#if row.count !== undefined}<span class="count">{row.count}</span>{/if}
{#if row.error}<WarningIcon small title="Failed to load. Expand to see why." />{/if}
{#if row.loading}<span class="spinner" aria-label="Loading"></span>{/if}
{#if row.stale}<span class="stale" title="Loaded a while ago. F5 to refresh.">stale</span>{/if}

<style>
  .folder {
    flex: none;
    width: 12px;
    height: 12px;
    color: var(--text-muted);
  }
  .name {
    color: var(--tree-folder);
    font: 12.5px/1 var(--font-ui);
    overflow: hidden;
    white-space: nowrap;
  }
  .count {
    color: var(--text-muted);
    font: 11px/1 var(--font-ui);
  }
</style>
