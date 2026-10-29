<script lang="ts">
  import type { ResultSet } from "./store.svelte";
  import type { CellValue } from "./types";

  const ROW_H = 22;
  const HEADER_H = 26;
  const NUM_W = 56;
  const OVERSCAN = 10;
  const MIN_COL_W = 48;

  let { set }: { set: ResultSet } = $props();

  let scroller: HTMLDivElement;
  let scrollTop = $state(0);
  let height = $state(0);
  let widths = $state<number[]>([]);
  let selected = $state<{ row: number; col: number }>();
  let selectedRow = $state<number>();

  // Initial column widths from the header and the first rows, capped so one long value doesn't take over.
  $effect(() => {
    const cols = set.columns;
    if (widths.length >= cols.length) return;
    const sample = set.rows.slice(0, 50);
    widths = cols.map((c, i) => {
      if (widths[i]) return widths[i];
      const longest = Math.max(c.name.length, ...sample.map((r) => display(r[i]).length));
      return Math.min(320, Math.max(64, longest * 7.5 + 18));
    });
  });

  const count = $derived(set.count);
  const totalWidth = $derived(NUM_W + widths.reduce((a, b) => a + b, 0));
  const start = $derived(Math.max(0, Math.floor(scrollTop / ROW_H) - OVERSCAN));
  const end = $derived(Math.min(count, start + Math.ceil(height / ROW_H) + 2 * OVERSCAN));
  const visible = $derived(Array.from({ length: Math.max(0, end - start) }, (_, k) => start + k));

  function display(v: CellValue): string {
    if (v === null || v === undefined) return "NULL";
    if (typeof v === "boolean") return v ? "1" : "0";
    return String(v);
  }

  function copy(text: string) {
    navigator.clipboard.writeText(text).catch(() => {});
  }

  function rowText(r: number) {
    return set.columns.map((_, i) => (set.rows[r][i] == null ? "" : display(set.rows[r][i]))).join("\t");
  }

  function select(row: number, col: number) {
    selectedRow = undefined;
    selected = { row: Math.max(0, Math.min(count - 1, row)), col: Math.max(0, Math.min(set.columns.length - 1, col)) };
    const top = selected.row * ROW_H;
    const viewTop = scroller.scrollTop;
    const viewBottom = viewTop + scroller.clientHeight - HEADER_H;
    if (top < viewTop) scroller.scrollTop = top;
    else if (top + ROW_H > viewBottom) scroller.scrollTop = top + ROW_H - (scroller.clientHeight - HEADER_H);
  }

  function onKeydown(e: KeyboardEvent) {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "c") {
      if (selectedRow !== undefined) copy(rowText(selectedRow));
      else if (selected) {
        const v = set.rows[selected.row]?.[selected.col];
        copy(v == null ? "" : display(v));
      }
      e.preventDefault();
      return;
    }
    if (!selected) return;
    const moves: Record<string, [number, number]> = { ArrowDown: [1, 0], ArrowUp: [-1, 0], ArrowRight: [0, 1], ArrowLeft: [0, -1] };
    const page = Math.floor((scroller.clientHeight - HEADER_H) / ROW_H);
    const m = moves[e.key] ?? (e.key === "PageDown" ? [page, 0] : e.key === "PageUp" ? [-page, 0] : undefined);
    if (!m) return;
    select(selected.row + m[0], selected.col + m[1]);
    e.preventDefault();
  }

  function startResize(e: PointerEvent, col: number) {
    e.stopPropagation();
    const target = e.currentTarget as HTMLElement;
    target.setPointerCapture(e.pointerId);
    const x0 = e.clientX;
    const w0 = widths[col];
    const move = (ev: PointerEvent) => {
      widths[col] = Math.max(MIN_COL_W, w0 + ev.clientX - x0);
    };
    target.addEventListener("pointermove", move);
    target.addEventListener("pointerup", () => target.removeEventListener("pointermove", move), { once: true });
  }
</script>

<div
  class="grid"
  role="grid"
  tabindex="0"
  aria-rowcount={count}
  bind:this={scroller}
  bind:clientHeight={height}
  onscroll={() => (scrollTop = scroller.scrollTop)}
  onkeydown={onKeydown}
>
  <div class="inner" style:width="{totalWidth}px" style:height="{HEADER_H + count * ROW_H}px">
    <div class="header" style:width="{totalWidth}px" role="row">
      <span class="num head" style:width="{NUM_W}px"></span>
      {#each set.columns as c, i}
        <span class="cell head" style:width="{widths[i]}px" title={c.type ? `${c.name} (${c.type})` : c.name} role="columnheader">
          {c.name || `(column ${i + 1})`}
          <span class="resize" role="separator" aria-orientation="vertical" onpointerdown={(e) => startResize(e, i)}></span>
        </span>
      {/each}
    </div>
    <div class="window" style:transform="translateY({HEADER_H + start * ROW_H}px)">
      {#each visible as r (r)}
        <div class="row" class:alt={r % 2 === 1} class:row-selected={selectedRow === r} role="row">
          <span
            class="num"
            style:width="{NUM_W}px"
            role="rowheader"
            tabindex="-1"
            onmousedown={() => {
              selected = undefined;
              selectedRow = r;
              copy(rowText(r));
            }}
            title="Click to copy this row">{r + 1}</span
          >
          {#each set.columns as _, i}
            {@const v = set.rows[r][i]}
            <span
              class="cell"
              class:null={v === null || v === undefined}
              class:number={typeof v === "number"}
              class:selected={selected?.row === r && selected?.col === i}
              style:width="{widths[i]}px"
              role="gridcell"
              tabindex="-1"
              title={typeof v === "string" && v.length > 40 ? v.slice(0, 2000) : undefined}
              onmousedown={() => select(r, i)}>{display(v)}</span
            >
          {/each}
        </div>
      {/each}
    </div>
  </div>
</div>

<style>
  .grid {
    height: 100%;
    overflow: auto;
    outline: none;
    font: 12px/22px var(--font-mono);
    contain: strict;
  }
  .inner {
    position: relative;
  }
  .header {
    position: sticky;
    top: 0;
    z-index: 2;
    display: flex;
    height: 26px;
    background: var(--bg-pane);
    border-bottom: 1px solid var(--border);
    font: 600 12px/26px var(--font-ui);
  }
  .window {
    position: absolute;
    top: 0;
    left: 0;
    will-change: transform;
  }
  .row {
    display: flex;
    height: 22px;
  }
  .row.alt {
    background: color-mix(in srgb, var(--text) 3%, transparent);
  }
  .row.row-selected {
    background: var(--bg-selected);
  }
  .cell,
  .num {
    flex: none;
    position: relative;
    padding: 0 8px;
    overflow: hidden;
    white-space: nowrap;
    text-overflow: ellipsis;
    border-right: 1px solid color-mix(in srgb, var(--border) 60%, transparent);
    box-sizing: border-box;
  }
  .num {
    position: sticky;
    left: 0;
    z-index: 1;
    text-align: right;
    color: var(--text-muted);
    background: var(--bg-pane);
    cursor: pointer;
  }
  .num.head {
    z-index: 3;
  }
  .cell.number {
    text-align: right;
  }
  .cell.null {
    color: var(--text-muted);
    font-style: italic;
  }
  .cell.selected {
    outline: 2px solid var(--accent);
    outline-offset: -2px;
  }
  .resize {
    position: absolute;
    top: 0;
    right: -3px;
    width: 6px;
    height: 100%;
    cursor: col-resize;
    z-index: 1;
  }
</style>
