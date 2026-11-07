<script lang="ts">
  import { GLYPHS } from "../glyphs";
  import Spinner from "../Spinner.svelte";
  import type { Row } from "../tree-model";
  import WarningIcon from "./WarningIcon.svelte";

  let { row }: { row: Extract<Row, { type: "node" }> } = $props();
</script>

<span class="chevron" class:open={row.expanded}></span>
<svg class="folder" viewBox="0 0 16 16" aria-hidden="true">
  <path d={GLYPHS.folder} fill="none" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round" />
</svg>
<span class="name">{row.node.label}</span>
{#if row.count !== undefined}<span class="count">{row.count}</span>{/if}
{#if row.error}<WarningIcon small title="Failed to load. Expand to see why." />{/if}
{#if row.loading}<Spinner label="Loading" />{/if}
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
    font: var(--fs-xs)/1 var(--font-ui);
  }
</style>
