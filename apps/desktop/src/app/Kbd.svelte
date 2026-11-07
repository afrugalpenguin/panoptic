<script lang="ts">
  // A shortcut chip, e.g. "Ctrl P" (docs/design-tokens.md). Where it sits is the parent's: it only draws the chip.
  let { keys }: { keys: string } = $props();
</script>

<kbd>{keys}</kbd>

<style>
  kbd {
    flex: none;
    padding: 1px 6px;
    border: 1px solid var(--kbd-border);
    border-radius: 4px;
    background: var(--kbd-bg);
    color: var(--text-muted);
    font: var(--fs-xs) var(--font-mono);
  }
</style>
