<script lang="ts">
  /** The explorer's error marker: on the error row, and as a small glyph after a failed node's label. */
  let { small = false, title }: { small?: boolean; title?: string } = $props();
</script>

<svg class="warning" class:small viewBox="0 0 12 12" role={title ? "img" : undefined} aria-hidden={title ? undefined : true} aria-label={title}>
  {#if title}<title>{title}</title>{/if}
  <path d="M6 1.2 11 10.5H1z" fill="none" stroke="currentColor" stroke-width="1.1" stroke-linejoin="round" />
  <path d="M6 4.6v2.9M6 8.6v.6" stroke="currentColor" stroke-width="1.1" />
</svg>

<style>
  .warning {
    flex: none;
    width: 12px;
    height: 12px;
    color: var(--bad);
  }
  .small {
    width: 10px;
    height: 10px;
  }
</style>
