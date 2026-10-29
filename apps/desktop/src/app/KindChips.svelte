<script lang="ts">
  import KindBadge from "./rows/KindBadge.svelte";
  import type { KindSummary } from "./tree-model";

  /** Kind filter row (docs/explorer-ux.md). The parent leaves it out when there is only one kind. */
  let { kinds, active, onSelect }: { kinds: KindSummary[]; active: string | undefined; onSelect: (kind: string | undefined) => void } =
    $props();
</script>

<div class="chips" role="toolbar" aria-label="Filter by kind">
  <button class="chip" class:on={active === undefined} aria-pressed={active === undefined} onclick={() => onSelect(undefined)}>All</button>
  {#each kinds as k (k.kind)}
    <button class="chip" class:on={active === k.kind} aria-pressed={active === k.kind} onclick={() => onSelect(active === k.kind ? undefined : k.kind)}>
      <KindBadge badge={k.badge} />
      <span>{k.badge.name}</span>
      <span class="count">{k.count}</span>
    </button>
  {/each}
</div>

<style>
  .chips {
    display: flex;
    align-items: center;
    gap: 6px;
    height: 32px;
    padding: 0 8px;
    overflow-x: auto;
    border-bottom: 1px solid var(--border);
  }
  .chip {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    flex: none;
    height: 22px;
    padding: 0 8px;
    border-radius: 11px;
    font-size: 11.5px;
  }
  .chip.on {
    border-color: var(--accent);
    background: color-mix(in srgb, var(--accent) 18%, var(--bg-pane));
  }
  .count {
    color: var(--text-muted);
  }
</style>
