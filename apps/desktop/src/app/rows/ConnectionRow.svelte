<script lang="ts">
  import type { Row } from "../tree-model";
  import KindBadge from "./KindBadge.svelte";
  import SegmentedLabel from "./SegmentedLabel.svelte";
  import WarningIcon from "./WarningIcon.svelte";

  let { row, disconnected = false }: { row: Extract<Row, { type: "node" }>; disconnected?: boolean } = $props();
</script>

<span class="chevron" class:open={row.expanded}></span>
{#if row.badge}<KindBadge badge={row.badge} />{/if}
<span class="endpoint"><SegmentedLabel label={row.label} /></span>
{#if row.certificateUnchecked}<span class="cert-unchecked" title="Trust server certificate is on: this server's certificate is not checked, so an interceptor could pose as it. Edit the connection to change it.">cert not checked</span>{/if}
{#if row.error}<WarningIcon small title="Failed to load. Expand to see why." />{/if}
{#if row.loading}<span class="spinner" aria-label="Loading"></span>{/if}
{#if disconnected}<span class="stale" title="The database engine stopped. Reconnects when it is running again.">disconnected</span>
{:else if row.stale}<span class="stale" title="Loaded a while ago. F5 to refresh.">stale</span>{/if}

<style>
  .cert-unchecked {
    flex: none;
    margin-left: 6px;
    padding: 0 5px;
    border-radius: 3px;
    font-size: 10.5px;
    line-height: 15px;
    color: var(--text);
    background: color-mix(in srgb, var(--warn) 22%, transparent);
    white-space: nowrap;
  }
  .endpoint {
    display: flex;
    min-width: 0;
    font: 12.5px/1 var(--row-font);
  }
</style>
