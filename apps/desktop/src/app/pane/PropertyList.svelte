<script lang="ts">
  // A Properties card's rows: label dim on the left, value on the right, 13px. Rows are <dt>/<dd> pairs.
  import type { Snippet } from "svelte";

  let { error = "", children }: { /** The last store write's failure, shown under the rows. */ error?: string; children: Snippet } = $props();
</script>

<dl>{@render children()}</dl>
{#if error}<p class="error" role="alert">{error}</p>{/if}

<style>
  dl {
    display: grid;
    grid-template-columns: max-content minmax(0, 1fr);
    row-gap: 10px;
    column-gap: 16px;
    margin: 0;
    padding: 0 16px 14px;
    font-size: var(--fs-md);
  }
  dl > :global(dt) {
    display: flex;
    align-items: center;
    min-height: 22px;
    color: var(--tree-dim);
  }
  dl > :global(dt label) {
    color: inherit;
  }
  dl > :global(dd) {
    position: relative;
    display: flex;
    align-items: center;
    justify-content: flex-end;
    gap: 6px;
    min-width: 0;
    min-height: 22px;
    margin: 0;
  }
  .error {
    margin: 0;
    padding: 0 16px 14px;
    color: var(--bad);
    overflow-wrap: anywhere;
  }
</style>
