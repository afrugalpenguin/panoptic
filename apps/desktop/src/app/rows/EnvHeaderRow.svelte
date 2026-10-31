<script lang="ts">
  import type { Row } from "../tree-model";
  import WarningIcon from "./WarningIcon.svelte";

  let { row }: { row: Extract<Row, { type: "node" }> } = $props();
</script>

<span class="chevron" class:open={row.expanded} class:none={!row.node.hasChildren}></span>
<span class="name">{row.node.label}</span>
{#if row.readOnly}<span class="read-only">Read only</span>{/if}
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
  .read-only {
    flex: none;
    padding: 1px 5px;
    border: 1px solid var(--env);
    border-radius: 3px;
    color: var(--env);
    font: 700 10px/1.2 var(--font-ui);
    text-transform: uppercase;
    letter-spacing: 0.04em;
  }
  .count {
    margin-left: auto;
    color: var(--text-muted);
    font: 11px/1 var(--font-ui);
  }
</style>
