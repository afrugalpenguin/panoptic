<script lang="ts">
  import Icon from "../Icon.svelte";
  import type { Row } from "../tree-model";
  import SegmentedLabel from "./SegmentedLabel.svelte";

  /** Objects and their details, plus the loading / error / empty placeholder lines. */
  let { row }: { row: Row } = $props();
</script>

{#if row.type === "node"}
  <span class="chevron" class:open={row.expanded} class:none={!row.node.hasChildren}></span>
  <Icon icon={row.node.icon} />
  <span class="name"><SegmentedLabel label={row.label} /></span>
  {#if row.secondary}<span class="secondary">{row.secondary}</span>{/if}
  {#if row.loading}<span class="spinner" aria-label="Loading"></span>{/if}
  {#if row.stale}<span class="stale" title="Loaded a while ago. F5 to refresh.">stale</span>{/if}
{:else if row.type === "loading"}
  <span class="chevron none"></span><span class="note">Loading...</span>
{:else if row.type === "error"}
  <span class="chevron none"></span><span class="note error" title={row.message}>{row.message}</span>
{:else}
  <span class="chevron none"></span><span class="note">(empty)</span>
{/if}

<style>
  .name {
    display: flex;
    min-width: 0;
    font: 12px/1 var(--row-font);
  }
  .name :global(.core) {
    font-weight: 400;
  }
  .secondary,
  .note {
    color: var(--text-muted);
    font: 11px/1 var(--font-ui);
    white-space: nowrap;
  }
  .note {
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .error {
    color: var(--bad);
  }
</style>
