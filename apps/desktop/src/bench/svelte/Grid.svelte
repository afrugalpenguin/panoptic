<script lang="ts">
  import type { GridData } from "../data";
  import { GRID_ROW_H, OVERSCAN } from "../types";

  let { grid }: { grid: GridData } = $props();

  let scrollTop = $state(0);
  let height = $state(0);
  let scroller: HTMLDivElement;

  const start = $derived(Math.max(0, Math.floor(scrollTop / GRID_ROW_H) - OVERSCAN));
  const end = $derived(Math.min(grid.rowCount, start + Math.ceil(height / GRID_ROW_H) + 2 * OVERSCAN));
  const visible = $derived(Array.from({ length: end - start }, (_, k) => start + k));

  export function getScroller() {
    return scroller;
  }
</script>

<div class="g-header">
  {#each grid.columns as c}<span class="g-cell">{c}</span>{/each}
</div>
<div class="v-scroller" bind:this={scroller} bind:clientHeight={height} onscroll={() => (scrollTop = scroller.scrollTop)}>
  <div class="v-spacer" style:height="{grid.rowCount * GRID_ROW_H}px">
    <div class="v-window" style:transform="translateY({start * GRID_ROW_H}px)">
      {#each visible as r}
        <div class="g-row">
          {#each grid.data as col}<span class="g-cell">{col[r]}</span>{/each}
        </div>
      {/each}
    </div>
  </div>
</div>
