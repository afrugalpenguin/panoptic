<script lang="ts">
  import type { TreeData } from "../data";
  import { OVERSCAN, TREE_ROW_H } from "../types";

  let { tree, rows: initialRows, expanded: initialExpanded }: { tree: TreeData; rows: Int32Array; expanded: Uint8Array } =
    $props();

  // svelte-ignore state_referenced_locally
  let rows = $state.raw(initialRows);
  // svelte-ignore state_referenced_locally
  let expanded = $state.raw(initialExpanded);
  let scrollTop = $state(0);
  let height = $state(0);
  let scroller: HTMLDivElement;

  const start = $derived(Math.max(0, Math.floor(scrollTop / TREE_ROW_H) - OVERSCAN));
  const end = $derived(Math.min(rows.length, start + Math.ceil(height / TREE_ROW_H) + 2 * OVERSCAN));
  const visible = $derived(Array.from(rows.subarray(start, end)));

  export function setRows(r: Int32Array, e: Uint8Array) {
    rows = r;
    expanded = e;
  }

  export function getScroller() {
    return scroller;
  }
</script>

<div class="v-scroller" bind:this={scroller} bind:clientHeight={height} onscroll={() => (scrollTop = scroller.scrollTop)}>
  <div class="v-spacer" style:height="{rows.length * TREE_ROW_H}px">
    <div class="v-window" style:transform="translateY({start * TREE_ROW_H}px)">
      {#each visible as i}
        <div class="t-row" style:padding-left="{tree.depth[i] * 16 + 4}px">
          <span class={tree.size[i] > 1 ? (expanded[i] ? "t-twisty open" : "t-twisty closed") : "t-twisty"}></span>
          <span class="t-icon k{tree.kind[i]}"></span>
          <span class="t-label">{tree.label[i]}</span>
        </div>
      {/each}
    </div>
  </div>
</div>
