<script lang="ts">
  import type { Row } from "../tree-model";
  import ReadOnlyPill from "./ReadOnlyPill.svelte";
  import WarningIcon from "./WarningIcon.svelte";

  let { row }: { row: Extract<Row, { type: "node" }> } = $props();
</script>

<span class="chevron" class:open={row.expanded} class:none={!row.node.hasChildren}></span>
<span class="name">{row.node.label}</span>
{#if row.readOnly}<ReadOnlyPill />{/if}
{#if row.error}<WarningIcon small title="Failed to load. Expand to see why." />{/if}
{#if row.loading}<span class="spinner" aria-label="Loading"></span>{/if}
<span class="count">{row.count ?? ""}</span>

<style>
  .name {
    color: var(--tree-bright);
    font: 700 13px/1 var(--font-ui);
    overflow: hidden;
    white-space: nowrap;
  }
  .count {
    margin-left: auto;
    color: var(--text-muted);
    font: 11px/1 var(--font-ui);
  }
</style>
