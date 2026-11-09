<script lang="ts">
  // The detail panes' header row: identity tile, name with its place tag and one-line summary, actions on the right.
  import type { Snippet } from "svelte";

  let {
    tileText,
    tileBackground,
    tileColor,
    tileMono = false,
    tileDot = false,
    mono = false,
    place,
    title,
    summary,
    actions,
  }: {
    /** The tile's letter(s): an environment's initial, a connection's engine letters. */
    tileText: string;
    tileBackground: string;
    tileColor: string;
    tileMono?: boolean;
    /** A 14px dot in --env on the tile's bottom-right corner (a connection in an environment). */
    tileDot?: boolean;
    /** The name in the mono stack (a host) rather than the UI font. */
    mono?: boolean;
    /** "Environment · 2 of 3", drawn uppercase. */
    place: string;
    title: Snippet;
    summary: Snippet;
    actions: Snippet;
  } = $props();
</script>

<header>
  <span class="tile" class:mono={tileMono} style:background={tileBackground} style:color={tileColor} aria-hidden="true">
    {tileText}
    {#if tileDot}<span class="tile-dot"></span>{/if}
  </span>
  <div class="identity">
    <div class="title">
      <h2 class:mono>{@render title()}</h2>
      <span class="place">{place}</span>
    </div>
    <p class="summary">{@render summary()}</p>
  </div>
  <div class="actions">{@render actions()}</div>
</header>

<style>
  header {
    display: flex;
    align-items: flex-start;
    gap: 20px;
  }
  .tile {
    position: relative;
    flex: none;
    display: grid;
    place-items: center;
    width: 44px;
    height: 44px;
    border-radius: 10px;
    font-size: 17px;
    font-weight: 700;
  }
  .tile.mono {
    font-family: var(--font-mono);
  }
  .tile-dot {
    position: absolute;
    right: -4px;
    bottom: -4px;
    width: 14px;
    height: 14px;
    box-sizing: border-box;
    border: 2px solid var(--bg);
    border-radius: 50%;
    background: var(--env);
  }
  .identity {
    flex: 1;
    min-width: 0;
  }
  .title {
    display: flex;
    align-items: baseline;
    gap: 12px;
    min-width: 0;
  }
  h2 {
    margin: 0;
    min-width: 0;
    font-size: var(--fs-3xl);
    font-weight: 700;
    letter-spacing: -0.02em;
    line-height: 1.15;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    user-select: text;
  }
  h2.mono {
    display: flex;
    font: 700 24px/1.15 var(--font-mono);
    letter-spacing: 0;
  }
  h2.mono :global(.segmented) {
    text-overflow: ellipsis;
  }
  h2.mono :global(.dim) {
    font-weight: 500;
  }
  .place {
    flex: none;
    font: var(--fs-xs) var(--font-mono);
    text-transform: uppercase;
    color: var(--tree-dim);
  }
  .summary {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    margin: 4px 0 0;
    font-size: var(--fs-md);
    color: var(--text-muted);
  }
  .summary :global(b) {
    font-weight: 600;
    color: var(--text);
  }
  .summary :global(.sep) {
    color: var(--border);
  }
  .summary :global(.reach) {
    display: inline-flex;
    align-items: center;
    gap: 6px;
  }
  .actions {
    flex: none;
    display: flex;
    align-items: center;
    gap: 6px;
  }
</style>
