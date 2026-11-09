<script lang="ts" module>
  export interface RecentRow {
    key: string;
    /** What the object is in: its connection (environment pane) or its database (connection pane). */
    context?: string;
    label: string;
    title: string;
    at: number;
    open: () => void;
  }
</script>

<script lang="ts">
  // A Recent card's rows (docs/environment-pane.md, docs/connection-pane.md): "context · object", dim context, and the
  // age right-aligned in mono. A click opens the object.
  import { age } from "../usage";

  let { rows }: { rows: RecentRow[] } = $props();
</script>

{#each rows as r (r.key)}
  <button type="button" class="ghost recent-row" title={r.title} onclick={r.open}>
    <span class="what">{#if r.context}<span class="dim">{r.context} ·</span>{" "}{/if}{r.label}</span>
    <span class="when">{age(Date.now() - r.at)}</span>
  </button>
{/each}

<style>
  .recent-row {
    display: flex;
    align-items: center;
    gap: 10px;
    width: 100%;
    height: 28px;
    padding: 0 16px;
    border-radius: 0;
    text-align: left;
    font-size: var(--fs-md);
  }
  .recent-row:last-child {
    margin-bottom: 6px;
  }
  .recent-row:hover {
    background: var(--bg-hover);
  }
  .what {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .dim,
  .when {
    color: var(--tree-dim);
  }
  .when {
    flex: none;
    font: var(--fs-xs) var(--font-mono);
  }
</style>
