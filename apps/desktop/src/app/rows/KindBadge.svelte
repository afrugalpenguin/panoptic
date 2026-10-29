<script lang="ts">
  import type { KindBadge } from "../kinds";

  let { badge }: { badge: KindBadge } = $props();
</script>

<span class="kind-badge" style:--badge={badge.color} aria-hidden="true">{badge.letters}</span>

<style>
  .kind-badge {
    display: inline-grid;
    place-items: center;
    flex: none;
    width: 14px;
    height: 14px;
    border-radius: 3px;
    background: var(--badge);
    color: #fff;
    font: 700 9px/1 var(--font-ui);
    letter-spacing: -0.02em;
  }
</style>
