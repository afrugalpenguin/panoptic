<script lang="ts">
  import type { Row, TreeModel } from "./tree-model";
  import ConnectionRow from "./rows/ConnectionRow.svelte";
  import EnvHeaderRow from "./rows/EnvHeaderRow.svelte";
  import FolderRow from "./rows/FolderRow.svelte";
  import LeafRow from "./rows/LeafRow.svelte";

  const OVERSCAN_PX = 240;
  const TYPE_TO_JUMP_MS = 700;

  let {
    model,
    rows,
    selectedKey = $bindable(),
    onContextMenu,
    onActivate,
  }: {
    model: TreeModel;
    rows: Row[];
    selectedKey: string | undefined;
    onContextMenu: (row: Row, x: number, y: number) => void;
    onActivate: (row: Row) => void;
  } = $props();

  let scroller: HTMLDivElement;
  let scrollTop = $state(0);
  let height = $state(0);
  let focused = $state(false);
  let typed = "";
  let typedAt = 0;

  const totalHeight = $derived(rows.length ? rows[rows.length - 1].top + rows[rows.length - 1].height : 0);
  const selectedIndex = $derived(rows.findIndex((r) => r.key === selectedKey));

  /** First row whose box reaches below `y`; rows are sorted by top, so binary search. */
  function firstBelow(y: number): number {
    let lo = 0;
    let hi = rows.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (rows[mid].top + rows[mid].height <= y) lo = mid + 1;
      else hi = mid;
    }
    return lo;
  }

  const start = $derived(firstBelow(scrollTop - OVERSCAN_PX));
  const end = $derived(Math.min(rows.length, firstBelow(scrollTop + height + OVERSCAN_PX) + 1));

  /** Visible rows grouped by environment, so --env is set once per group element. */
  const groups = $derived.by(() => {
    const out: { envId: string; color?: string; rows: Row[] }[] = [];
    for (let i = start; i < end; i++) {
      const row = rows[i];
      const last = out[out.length - 1];
      if (last && last.envId === row.envId) last.rows.push(row);
      else out.push({ envId: row.envId, color: row.envColor, rows: [row] });
    }
    return out;
  });
  const windowTop = $derived(start < rows.length ? rows[start].top - rows[start].gapBefore : 0);

  function select(index: number) {
    if (rows.length === 0) return;
    const i = Math.max(0, Math.min(rows.length - 1, index));
    selectedKey = rows[i].key;
    const { top, height: h } = rows[i];
    if (top < scroller.scrollTop) scroller.scrollTop = top;
    else if (top + h > scroller.scrollTop + scroller.clientHeight) scroller.scrollTop = top + h - scroller.clientHeight;
  }

  function pageRows(direction: 1 | -1): number {
    const target = (selectedIndex >= 0 ? rows[selectedIndex].top : 0) + direction * scroller.clientHeight;
    return direction > 0 ? Math.min(rows.length - 1, firstBelow(target)) : Math.max(0, firstBelow(target));
  }

  function toggle(row: Row) {
    if (row.type === "node" && row.node.hasChildren) model.toggle(row.node.id);
  }

  function onKeydown(e: KeyboardEvent) {
    const row = rows[selectedIndex];
    switch (e.key) {
      case "ArrowDown":
        select(selectedIndex + 1);
        break;
      case "ArrowUp":
        select(selectedIndex - 1);
        break;
      case "PageDown":
        select(pageRows(1));
        break;
      case "PageUp":
        select(pageRows(-1));
        break;
      case "Home":
        select(0);
        break;
      case "End":
        select(rows.length - 1);
        break;
      case "ArrowRight":
        if (row?.type !== "node") break;
        if (row.node.hasChildren && !row.expanded) model.expand(row.node.id);
        else if (row.expanded) select(selectedIndex + 1);
        break;
      case "ArrowLeft": {
        if (!row) break;
        if (row.type === "node" && row.expanded) {
          model.collapse(row.node.id);
          break;
        }
        const parentId = row.type === "node" ? model.parentOf(row.node.id) : row.parentId;
        const parentIndex = rows.findIndex((r) => r.key === parentId);
        if (parentIndex >= 0) select(parentIndex);
        break;
      }
      case "Enter":
        if (row) onActivate(row);
        break;
      case "F5":
        if (row?.type === "node") model.refresh(row.node.id);
        else if (row) model.refresh(row.parentId);
        break;
      case "ContextMenu":
        if (row) {
          const bounds = scroller.getBoundingClientRect();
          onContextMenu(row, bounds.left + 40, bounds.top + row.top - scroller.scrollTop + row.height);
        }
        break;
      default:
        if (e.key.length === 1 && !e.ctrlKey && !e.altKey && !e.metaKey) typeToJump(e.key);
        else return;
    }
    e.preventDefault();
  }

  /** Jumps to the next row whose shown text starts with what has been typed in quick succession. */
  function typeToJump(ch: string) {
    const now = performance.now();
    typed = now - typedAt > TYPE_TO_JUMP_MS ? ch.toLowerCase() : typed + ch.toLowerCase();
    typedAt = now;
    const from = typed.length === 1 ? selectedIndex + 1 : Math.max(0, selectedIndex);
    for (let k = 0; k < rows.length; k++) {
      const r = rows[(from + k) % rows.length];
      if (r.type !== "node") continue;
      const shown = (r.label.prefix + r.label.core + r.label.suffix).toLowerCase();
      if (shown.startsWith(typed) || r.label.core.toLowerCase().startsWith(typed)) {
        select((from + k) % rows.length);
        return;
      }
    }
  }

  function onRowMouseDown(e: MouseEvent, row: Row) {
    selectedKey = row.key;
    if (e.button === 0 && (e.target as HTMLElement).classList.contains("chevron")) toggle(row);
  }
</script>

<div
  class="tree"
  class:focused
  role="tree"
  tabindex="0"
  bind:this={scroller}
  bind:clientHeight={height}
  onscroll={() => (scrollTop = scroller.scrollTop)}
  onkeydown={onKeydown}
  onfocus={() => (focused = true)}
  onblur={() => (focused = false)}
>
  <div class="spacer" style:height="{totalHeight}px">
    <div class="window" style:transform="translateY({windowTop}px)">
      <!-- Environments are contiguous in the tree, so an env id appears at most once among the visible groups. -->
      {#each groups as group (group.envId)}
        <div class="env-group" style:--env={group.color ?? "var(--text-muted)"}>
          {#each group.rows as row (row.key)}
            <div
              class="tree-row {row.rowKind}"
              class:selected={row.key === selectedKey}
              role="treeitem"
              tabindex="-1"
              aria-selected={row.key === selectedKey}
              aria-expanded={row.type === "node" && row.node.hasChildren ? row.expanded : undefined}
              style:height="{row.height}px"
              style:margin-top="{row.gapBefore}px"
              style:padding-left="{row.indent + 4 + (row.rowKind === "header" ? 6 : 0)}px"
              onmousedown={(e) => onRowMouseDown(e, row)}
              ondblclick={() => onActivate(row)}
              oncontextmenu={(e) => {
                e.preventDefault();
                selectedKey = row.key;
                onContextMenu(row, e.clientX, e.clientY);
              }}
            >
              {#if row.type === "node" && row.rowKind === "header"}
                <EnvHeaderRow {row} />
              {:else if row.type === "node" && row.rowKind === "connection"}
                <ConnectionRow {row} />
              {:else if row.type === "node" && row.rowKind === "folder"}
                <FolderRow {row} />
              {:else}
                <LeafRow {row} />
              {/if}
            </div>
          {/each}
        </div>
      {/each}
    </div>
  </div>
</div>

<style>
  .tree {
    height: 100%;
    overflow: auto;
    outline: none;
    contain: strict;
  }
  .spacer {
    position: relative;
  }
  .window {
    position: absolute;
    inset: 0 0 auto 0;
    will-change: transform;
  }
  .tree-row {
    display: flex;
    align-items: center;
    gap: 8px;
    box-sizing: border-box;
    padding-right: 10px;
    white-space: nowrap;
    cursor: default;
    /* Every row continues the group's bar: solid env colour on headers, darkened elsewhere. */
    box-shadow: inset 4px 0 0 var(--env-dark);
    --env-dark: hsl(from var(--env) h s 25%);
  }
  .tree-row:hover {
    background: var(--bg-hover);
  }
  .tree-row.header {
    background: color-mix(in srgb, var(--env) 14%, transparent);
    box-shadow: inset 4px 0 0 var(--env);
  }
  .tree-row.selected {
    background: var(--tree-selected);
  }
  .tree:not(.focused) .tree-row.selected {
    background: var(--bg-selected-blur);
  }
  .tree-row :global(.chevron) {
    flex: none;
    width: 12px;
    text-align: center;
    color: var(--text-muted);
    font-size: 10px;
    line-height: 1;
  }
  .tree-row :global(.chevron::before) {
    content: "\25B8";
  }
  .tree-row :global(.chevron.open::before) {
    content: "\25BE";
  }
  .tree-row :global(.chevron.none::before) {
    content: "";
  }
  .tree-row :global(.stale) {
    flex: none;
    font-size: 10px;
    padding: 0 5px;
    border-radius: 8px;
    border: 1px solid var(--border);
    color: var(--text-muted);
  }
  .tree-row :global(.spinner) {
    flex: none;
    width: 10px;
    height: 10px;
    border: 2px solid var(--border);
    border-top-color: var(--accent);
    border-radius: 50%;
    animation: spin 0.7s linear infinite;
  }
  @keyframes spin {
    to {
      transform: rotate(360deg);
    }
  }
</style>
