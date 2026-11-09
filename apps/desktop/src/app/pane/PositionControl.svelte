<script lang="ts">
  // Position: "2 of 8" and up and down arrows, disabled at the ends. Same as the tree's Move up and Move down.
  import Glyph from "./Glyph.svelte";

  let { position, total, onMove }: { position: number; total: number; onMove: (by: -1 | 1) => void } = $props();
</script>

<span class="position">
  <span class="mono">{position} of {total}</span>
  <button type="button" class="ghost arrow" aria-label="Move up" title="Move up" disabled={position <= 1} onclick={() => onMove(-1)}><Glyph name="arrow-up" /></button>
  <button type="button" class="ghost arrow" aria-label="Move down" title="Move down" disabled={position >= total} onclick={() => onMove(1)}><Glyph name="arrow-down" /></button>
</span>

<style>
  .position {
    display: inline-flex;
    align-items: center;
    gap: 2px;
  }
  .mono {
    margin-right: 6px;
    font-family: var(--font-mono);
  }
  button.arrow {
    display: inline-grid;
    place-items: center;
    width: 22px;
    height: 22px;
    padding: 0;
    border-radius: 4px;
    color: var(--text-muted);
  }
  button.arrow:hover:not(:disabled) {
    background: var(--bg-hover);
    color: var(--text);
  }
</style>
