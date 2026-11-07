<script lang="ts">
  // The one loading spinner (docs/design-tokens.md): tree rows, the status bar, query tabs and the results pane.
  let { size = 10, label }: { size?: number; label?: string } = $props();
</script>

<span class="spinner" style:width="{size}px" style:height="{size}px" aria-label={label}></span>

<style>
  .spinner {
    flex: none;
    display: inline-block;
    border: 2px solid var(--border);
    border-top-color: var(--accent);
    border-radius: 50%;
    animation: spin 0.7s linear infinite;
  }
  @keyframes spin {
    to {
      transform: rotate(360deg);
    }
  }
  @media (prefers-reduced-motion: reduce) {
    .spinner {
      animation-duration: 2s;
    }
  }
</style>
