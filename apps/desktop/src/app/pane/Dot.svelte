<script lang="ts">
  // A status or policy dot: 8px by default, with a 3px ring at 15% alpha when ring is set.
  let { color, size = 8, ring = false }: { color: string; size?: number; ring?: boolean } = $props();
</script>

<span class="dot" class:ring style:--dot={color} style:--size="{size}px" aria-hidden="true"></span>

<style>
  .dot {
    flex: none;
    width: var(--size);
    height: var(--size);
    border-radius: 50%;
    background: var(--dot);
  }
  .ring {
    box-shadow: 0 0 0 3px color-mix(in srgb, var(--dot) 15%, transparent);
  }
</style>
