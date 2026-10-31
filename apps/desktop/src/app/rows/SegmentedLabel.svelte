<script lang="ts">
  import type { LabelSegments } from "../labels";

  /** Draws precomputed segments: dim prefix, bright core, dim suffix. Never splits anything itself. */
  let { label }: { label: LabelSegments } = $props();
</script>

<span class="segmented"
  >{#if label.prefix}<span class="dim">{label.prefix}</span>{/if}<span class="core">{label.core}</span
  >{#if label.suffix}<span class="dim">{label.suffix}</span>{/if}</span
>

<style>
  .segmented {
    overflow: hidden;
    white-space: nowrap;
    min-width: 0;
  }
  .dim {
    color: var(--tree-dim);
  }
  .core {
    color: var(--tree-bright);
    font-weight: 700;
  }
  :global(.tree-row.selected) .dim {
    color: var(--tree-dim-selected);
  }
</style>
