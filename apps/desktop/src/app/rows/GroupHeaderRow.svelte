<script lang="ts">
  import type { Row } from "../tree-model";

  /** The dimmed "Ungrouped" header over connections in no environment (docs/explorer-ux.md). */
  let { row }: { row: Extract<Row, { type: "group" }> } = $props();
</script>

<span class="chevron" class:open={row.expanded}></span>
<span class="name">Ungrouped</span>
<span class="count">{row.count}</span>

<style>
  .name {
    color: var(--text-muted);
    font: 600 var(--fs-md)/1 var(--font-ui);
  }
  .count {
    margin-left: auto;
    color: var(--text-muted);
    font: var(--fs-xs)/1 var(--font-ui);
  }
</style>
