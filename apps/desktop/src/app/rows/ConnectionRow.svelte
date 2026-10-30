<script lang="ts">
  import type { Row } from "../tree-model";
  import KindBadge from "./KindBadge.svelte";
  import SegmentedLabel from "./SegmentedLabel.svelte";
  import WarningIcon from "./WarningIcon.svelte";

  let { row }: { row: Extract<Row, { type: "node" }> } = $props();
</script>

<span class="chevron" class:open={row.expanded}></span>
{#if row.badge}<KindBadge badge={row.badge} />{/if}
<span class="endpoint"><SegmentedLabel label={row.label} /></span>
{#if row.error}<WarningIcon small title="Failed to load. Expand to see why." />{/if}
{#if row.loading}<span class="spinner" aria-label="Loading"></span>{/if}
{#if row.stale}<span class="stale" title="Loaded a while ago. F5 to refresh.">stale</span>{/if}

<style>
  .endpoint {
    display: flex;
    min-width: 0;
    font: 12.5px/1 var(--row-font);
  }
</style>
