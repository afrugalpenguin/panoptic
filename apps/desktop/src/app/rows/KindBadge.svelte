<script lang="ts">
  import type { KindBadge } from "../kinds";

  /** size: the square's side in px; 14 in the tree, larger in the environment pane's Connections card. */
  let { badge, size = 14 }: { badge: KindBadge; size?: number } = $props();
</script>

<span
  class="kind-badge"
  style:--badge={badge.color}
  style:--size="{size}px"
  style:--letter="{size <= 14 ? 9 : Math.round(size * 0.5)}px"
  style:--radius="{size <= 14 ? 3 : 5}px"
  aria-hidden="true">{badge.letters}</span>

<style>
  .kind-badge {
    display: inline-grid;
    place-items: center;
    flex: none;
    width: var(--size);
    height: var(--size);
    border-radius: var(--radius);
    background: var(--badge);
    color: var(--on-badge);
    font: 700 var(--letter)/1 var(--font-ui);
    letter-spacing: -0.02em;
  }
</style>
