<script lang="ts">
  import ContextMenu, { type MenuItem } from "../app/ContextMenu.svelte";
  import { bounds, columnLabel, copyText, rowFullySelected, type Cell, type Selection } from "./grid-selection";
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
  /** One rectangle, as SSMS (#374). A row, a column or everything is a rectangle spanning the grid. */
  let sel = $state<Selection>();
  /** A drag from a cell is in progress: moving over another cell extends the selection to it. */
  let dragging = false;
  let menu = $state<{ x: number; y: number }>();

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
  const lastCol = $derived(set.columns.length - 1);
  const totalWidth = $derived(NUM_W + widths.reduce((a, b) => a + b, 0));
  const start = $derived(Math.max(0, Math.floor(scrollTop / ROW_H) - OVERSCAN));
  const end = $derived(Math.min(count, start + Math.ceil(height / ROW_H) + 2 * OVERSCAN));
  const visible = $derived(Array.from({ length: Math.max(0, end - start) }, (_, k) => start + k));
  const b = $derived(sel && bounds(sel));

  function display(v: CellValue): string {
    if (v === null || v === undefined) return "NULL";
    if (typeof v === "boolean") return v ? "1" : "0";
    return String(v);
  }

  function inSelection(r: number, c: number) {
    return !!b && r >= b.top && r <= b.bottom && c >= b.left && c <= b.right;
  }

  function copy(headers: boolean) {
    if (!b || count === 0) return;
    navigator.clipboard.writeText(copyText(set.columns, set.rows, b, headers)).catch(() => {});
  }

  function clamp(c: Cell): Cell {
    return { row: Math.max(0, Math.min(count - 1, c.row)), col: Math.max(0, Math.min(lastCol, c.col)) };
  }

  /** Selects from anchor to focus; with extend, keeps the current anchor and moves only the focus. */
  function selectRange(anchor: Cell, focus: Cell, extend = false) {
    if (count === 0 || lastCol < 0) return;
    const f = clamp(focus);
    sel = { anchor: extend && sel ? sel.anchor : clamp(anchor), focus: f };
    scrollToRow(f.row);
  }

  function selectAll() {
    selectRange({ row: 0, col: 0 }, { row: count - 1, col: lastCol });
  }

  function selectRow(r: number, extend: boolean) {
    selectRange({ row: extend && sel ? sel.anchor.row : r, col: 0 }, { row: r, col: lastCol });
  }

  function selectColumn(c: number, extend: boolean) {
    selectRange({ row: 0, col: extend && sel ? sel.anchor.col : c }, { row: count - 1, col: c });
  }

  function scrollToRow(row: number) {
    const top = row * ROW_H;
    const viewTop = scroller.scrollTop;
    const viewBottom = viewTop + scroller.clientHeight - HEADER_H;
    if (top < viewTop) scroller.scrollTop = top;
    else if (top + ROW_H > viewBottom) scroller.scrollTop = top + ROW_H - (scroller.clientHeight - HEADER_H);
  }

  function cellDown(e: MouseEvent, r: number, c: number) {
    if (e.button !== 0) return;
    selectRange({ row: r, col: c }, { row: r, col: c }, e.shiftKey);
    dragging = true;
    window.addEventListener("mouseup", () => (dragging = false), { once: true });
  }

  function cellOver(e: MouseEvent, r: number, c: number) {
    if (dragging && e.buttons & 1) selectRange({ row: r, col: c }, { row: r, col: c }, true);
  }

  /** Right-click inside the selection keeps it, as SSMS; outside it, the cell (or the row) is selected first. */
  function openMenu(e: MouseEvent, r: number, c?: number) {
    e.preventDefault();
    if (c === undefined) {
      if (!b || !rowFullySelected(b, r, lastCol + 1)) selectRow(r, false);
    } else if (!inSelection(r, c)) selectRange({ row: r, col: c }, { row: r, col: c });
    menu = { x: e.clientX, y: e.clientY };
  }

  const menuItems: MenuItem[] = [
    { label: "Copy", run: () => copy(false) },
    { label: "Copy with Headers", run: () => copy(true) },
    { label: "Select All", run: selectAll },
  ];

  function onKeydown(e: KeyboardEvent) {
    const k = e.key.toLowerCase();
    if ((e.ctrlKey || e.metaKey) && (k === "c" || k === "a")) {
      if (k === "a") selectAll();
      else copy(e.shiftKey);
      e.preventDefault();
      return;
    }
    if (!sel) return;
    const moves: Record<string, [number, number]> = { ArrowDown: [1, 0], ArrowUp: [-1, 0], ArrowRight: [0, 1], ArrowLeft: [0, -1] };
    const page = Math.floor((scroller.clientHeight - HEADER_H) / ROW_H);
    const m = moves[e.key] ?? (e.key === "PageDown" ? [page, 0] : e.key === "PageUp" ? [-page, 0] : undefined);
    if (!m) return;
    const to = { row: sel.focus.row + m[0], col: sel.focus.col + m[1] };
    selectRange(to, to, e.shiftKey);
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
  aria-multiselectable="true"
  bind:this={scroller}
  bind:clientHeight={height}
  onscroll={() => (scrollTop = scroller.scrollTop)}
  onkeydown={onKeydown}
>
  <div class="inner" style:width="{totalWidth}px" style:height="{HEADER_H + count * ROW_H}px">
    <div class="header" style:width="{totalWidth}px" role="row">
      <span
        class="num head corner"
        style:width="{NUM_W}px"
        role="columnheader"
        tabindex="-1"
        aria-label="Select all"
        title="Select all"
        onmousedown={(e) => e.button === 0 && selectAll()}
      ></span>
      {#each set.columns as c, i}
        <span
          class="cell head"
          style:width="{widths[i]}px"
          title={c.type ? `${c.name} (${c.type})` : c.name}
          role="columnheader"
          tabindex="-1"
          onmousedown={(e) => e.button === 0 && !(e.target as HTMLElement).classList.contains("resize") && selectColumn(i, e.shiftKey)}
        >
          {columnLabel(c, i)}
          <span class="resize" role="separator" aria-orientation="vertical" onpointerdown={(e) => startResize(e, i)}></span>
        </span>
      {/each}
    </div>
    <div class="window" style:transform="translateY({HEADER_H + start * ROW_H}px)">
      {#each visible as r (r)}
        <div class="row" class:alt={r % 2 === 1} class:row-selected={!!b && rowFullySelected(b, r, lastCol + 1)} role="row">
          <span
            class="num"
            style:width="{NUM_W}px"
            role="rowheader"
            tabindex="-1"
            onmousedown={(e) => e.button === 0 && selectRow(r, e.shiftKey)}
            oncontextmenu={(e) => openMenu(e, r)}
            title="Click to select this row">{r + 1}</span
          >
          {#each set.columns as _, i}
            {@const v = set.rows[r][i]}
            <!-- svelte-ignore a11y_mouse_events_have_key_events (drag-select; Shift+arrows does the same from the keyboard) -->
            <span
              class="cell"
              class:null={v === null || v === undefined}
              class:number={typeof v === "number"}
              class:in-range={inSelection(r, i)}
              class:selected={sel?.focus.row === r && sel?.focus.col === i}
              style:width="{widths[i]}px"
              role="gridcell"
              tabindex="-1"
              aria-selected={inSelection(r, i)}
              title={typeof v === "string" && v.length > 40 ? v.slice(0, 2000) : undefined}
              onmousedown={(e) => cellDown(e, r, i)}
              onmouseover={(e) => cellOver(e, r, i)}
              oncontextmenu={(e) => openMenu(e, r, i)}>{display(v)}</span
            >
          {/each}
        </div>
      {/each}
    </div>
  </div>
</div>
{#if menu}
  <!-- Outside the grid: its contain: strict would make it the containing block of the menu's position: fixed. -->
  <ContextMenu x={menu.x} y={menu.y} items={menuItems} onClose={() => (menu = undefined)} />
{/if}

<style>
  .grid {
    height: 100%;
    overflow: auto;
    outline: none;
    font: var(--fs-sm)/22px var(--font-mono);
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
    font: 600 var(--fs-sm)/26px var(--font-ui);
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
  .cell.head {
    cursor: pointer;
  }
  .cell.number {
    text-align: right;
  }
  .cell.null {
    color: var(--text-muted);
    font-style: italic;
  }
  .cell.in-range {
    background: color-mix(in srgb, var(--accent) 16%, transparent);
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
