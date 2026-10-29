<script lang="ts">
  import Icon from "./Icon.svelte";
  import type { Row, TreeModel } from "./tree-model";

  const ROW_H = 22;
  const OVERSCAN = 10;
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

  const start = $derived(Math.max(0, Math.floor(scrollTop / ROW_H) - OVERSCAN));
  const end = $derived(Math.min(rows.length, start + Math.ceil(height / ROW_H) + 2 * OVERSCAN));
  const visible = $derived(rows.slice(start, end));
  const selectedIndex = $derived(rows.findIndex((r) => r.key === selectedKey));

  function select(index: number) {
    if (rows.length === 0) return;
    const i = Math.max(0, Math.min(rows.length - 1, index));
    selectedKey = rows[i].key;
    const top = i * ROW_H;
    if (top < scroller.scrollTop) scroller.scrollTop = top;
    else if (top + ROW_H > scroller.scrollTop + scroller.clientHeight) scroller.scrollTop = top + ROW_H - scroller.clientHeight;
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
        select(selectedIndex + Math.floor(scroller.clientHeight / ROW_H));
        break;
      case "PageUp":
        select(selectedIndex - Math.floor(scroller.clientHeight / ROW_H));
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
          const top = selectedIndex * ROW_H - scroller.scrollTop + scroller.getBoundingClientRect().top;
          onContextMenu(row, scroller.getBoundingClientRect().left + 40, top + ROW_H);
        }
        break;
      default:
        if (e.key.length === 1 && !e.ctrlKey && !e.altKey && !e.metaKey) typeToJump(e.key);
        else return;
    }
    e.preventDefault();
  }

  /** Jumps to the next row whose label starts with what has been typed in quick succession. */
  function typeToJump(ch: string) {
    const now = performance.now();
    typed = now - typedAt > TYPE_TO_JUMP_MS ? ch.toLowerCase() : typed + ch.toLowerCase();
    typedAt = now;
    const from = typed.length === 1 ? selectedIndex + 1 : Math.max(0, selectedIndex);
    for (let k = 0; k < rows.length; k++) {
      const r = rows[(from + k) % rows.length];
      if (r.type === "node" && r.node.label.toLowerCase().startsWith(typed)) {
        select((from + k) % rows.length);
        return;
      }
    }
  }

  function onRowMouseDown(e: MouseEvent, row: Row) {
    selectedKey = row.key;
    if (e.button === 0 && (e.target as HTMLElement).classList.contains("twisty")) toggle(row);
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
  <div class="spacer" style:height="{rows.length * ROW_H}px">
    <div class="window" style:transform="translateY({start * ROW_H}px)">
      {#each visible as row (row.key)}
        <div
          class="row {row.type}"
          class:selected={row.key === selectedKey}
          class:env={row.type === "node" && row.node.kind === "environment"}
          role="treeitem"
          tabindex="-1"
          aria-selected={row.key === selectedKey}
          aria-expanded={row.type === "node" && row.node.hasChildren ? row.expanded : undefined}
          style:--band={row.envColor ?? "transparent"}
          style:padding-left="{row.depth * 16 + 6}px"
          onmousedown={(e) => onRowMouseDown(e, row)}
          ondblclick={() => onActivate(row)}
          oncontextmenu={(e) => {
            e.preventDefault();
            selectedKey = row.key;
            onContextMenu(row, e.clientX, e.clientY);
          }}
        >
          {#if row.type === "node"}
            <span class="twisty" class:open={row.expanded} class:hidden={!row.node.hasChildren}></span>
            {#if row.node.kind !== "environment"}<Icon icon={row.node.icon} />{/if}
            <span class="label">{row.node.label}</span>
            {#if row.node.kind === "environment" && row.readOnly}<span class="badge">read-only</span>{/if}
            {#if row.loading}<span class="spinner" aria-label="Loading"></span>{/if}
            {#if row.stale}<span class="stale" title="Loaded a while ago. F5 to refresh.">stale</span>{/if}
          {:else if row.type === "loading"}
            <span class="twisty hidden"></span><span class="muted">Loading...</span>
          {:else if row.type === "error"}
            <span class="twisty hidden"></span><span class="error-text" title={row.message}>{row.message}</span>
          {:else}
            <span class="twisty hidden"></span><span class="muted">(empty)</span>
          {/if}
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
  .row {
    display: flex;
    align-items: center;
    gap: 5px;
    height: 22px;
    padding-right: 8px;
    white-space: nowrap;
    cursor: default;
    box-shadow: inset 3px 0 0 var(--band);
  }
  .row:hover {
    background: var(--bg-hover);
  }
  .row.selected {
    background: var(--bg-selected-blur);
  }
  .tree.focused .row.selected {
    background: var(--bg-selected);
  }
  .row.env {
    font-weight: 600;
    background: color-mix(in srgb, var(--band) 10%, transparent);
  }
  .row.env.selected {
    background: color-mix(in srgb, var(--band) 22%, var(--bg-selected-blur));
  }
  .twisty {
    width: 14px;
    flex: none;
    text-align: center;
    color: var(--text-muted);
    font-size: 10px;
  }
  .twisty::before {
    content: "\25B8";
  }
  .twisty.open::before {
    content: "\25BE";
  }
  .twisty.hidden::before {
    content: "";
  }
  .label {
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .badge,
  .stale {
    font-size: 10px;
    font-weight: 500;
    padding: 0 5px;
    border-radius: 8px;
    border: 1px solid var(--border);
    color: var(--text-muted);
  }
  .badge {
    color: var(--warn);
    border-color: color-mix(in srgb, var(--warn) 40%, transparent);
  }
  .error-text {
    color: var(--bad);
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .spinner {
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
