<script lang="ts">
  import type { Snippet } from "svelte";
  import {
    connectionDrop,
    environmentDrop,
    moveEnvironment,
    ROW_HEIGHT,
    selectableRow,
    stepConnection,
    UNGROUPED,
    type DropAt,
    type Row,
    type TreeModel,
  } from "./tree-model";
  import ConnectionRow from "./rows/ConnectionRow.svelte";
  import EnvHeaderRow from "./rows/EnvHeaderRow.svelte";
  import GroupHeaderRow from "./rows/GroupHeaderRow.svelte";
  import FolderRow from "./rows/FolderRow.svelte";
  import LeafRow from "./rows/LeafRow.svelte";

  const OVERSCAN_PX = 240;
  /** A connection being dragged to move or reorder it (docs/explorer-ux.md, "Grouping"). Carries the connection id. */
  const CONNECTION_MIME = "application/x-panoptic-connection";
  /** An environment header being dragged to reorder the environments (#63). Carries the environment id. */
  const ENVIRONMENT_MIME = "application/x-panoptic-environment";
  const TYPE_TO_JUMP_MS = 700;
  /** The explorer footer sits over the bottom of the tree (docs/explorer-ux.md, "Footer"). */
  const FOOTER_HEIGHT = 30;
  /** The scrollbar thumb stays visible this long after the last scroll. */
  const SCROLLING_MS = 800;

  let {
    model,
    rows,
    selectedKey = $bindable(),
    onContextMenu,
    onActivate,
    onOpenProblem,
    onMoveConnection = () => {},
    onReorderEnvironments = () => {},
    disconnected = false,
    showKindBadge = true,
    rowFont = "mono",
    footer,
  }: {
    model: TreeModel;
    rows: Row[];
    selectedKey: string | undefined;
    onContextMenu: (row: Row, x: number, y: number) => void;
    onActivate: (row: Row) => void;
    /** Click on an error row: show its entry in the Problems tab. */
    onOpenProblem: (parentId: string) => void;
    /**
     * A connection was dropped on an environment (its id) or on the Ungrouped header (null), or before another
     * connection there (beforeId; null for last), by drag or Alt+Up/Down. No beforeId: a header or empty row.
     */
    onMoveConnection?: (connectionId: string, environmentId: string | null, beforeId?: string | null) => void;
    /** An environment was dragged, or moved with Alt+Up/Down: explorer.envOrder as it should now be. */
    onReorderEnvironments?: (envOrder: string[]) => void;
    /** The sidecar is down (ADR 0005): every connection row says so until it answers ping again. */
    disconnected?: boolean;
    /** explorer.showKindBadge and explorer.rowFont: CSS switches on the tree, no row recomputation. */
    showKindBadge?: boolean;
    rowFont?: "mono" | "ui";
    /** Drawn in a 30px bar stuck to the bottom of the scroll area, always present so the layout never jumps. */
    footer?: Snippet;
  } = $props();

  /** Prefixes the rows' ids, which aria-activedescendant names (#219): unique per tree. */
  const uid = $props.id();
  let scroller: HTMLDivElement;
  let scrollTop = $state(0);
  let height = $state(0);
  let focused = $state(false);
  let typed = "";
  let typedAt = 0;
  /** What is being dragged to move it, set on dragstart: a connection's or an environment's config id. */
  let dragging: { kind: "connection" | "environment"; id: string } | undefined;
  /** The row being dragged over and how it shows the drop: outlined, or a line above or below it. */
  let dropOn = $state<{ key: string; at: DropAt }>();
  /** Shows the scrollbar thumb while scrolling. */
  let scrolling = $state(false);
  let scrollingTimer: ReturnType<typeof setTimeout> | undefined;

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
    const out: { envId: string; color?: string; loose: boolean; rows: Row[] }[] = [];
    for (let i = start; i < end; i++) {
      const row = rows[i];
      const last = out[out.length - 1];
      if (last && last.envId === row.envId) last.rows.push(row);
      else out.push({ envId: row.envId, color: row.envColor, loose: row.loose, rows: [row] });
    }
    return out;
  });
  const windowTop = $derived(start < rows.length ? rows[start].top - rows[start].gapBefore : 0);

  /** Index of each group's header row (environment or Ungrouped), in tree order. Flat trees have none. */
  const headers = $derived(rows.flatMap((r, i) => (r.rowKind === "header" ? [i] : [])));
  const headerOf = $derived(new Map(headers.map((i) => [rows[i].envId, i])));

  /**
   * Sticky environment header (docs/explorer-ux.md, "Tree"): the header of the group at the top of the viewport,
   * pinned while its children scroll, and pushed up by the next group's header as it arrives.
   */
  const pinned = $derived.by(() => {
    const top = rows[firstBelow(scrollTop)];
    const at = top && headerOf.get(top.envId);
    if (at === undefined || rows[at].top >= scrollTop) return undefined;
    const next = rows[headers[headers.indexOf(at) + 1]];
    const offset = next ? Math.min(0, next.top - next.gapBefore - scrollTop - rows[at].height) : 0;
    return { row: rows[at], offset };
  });

  function onScroll() {
    scrollTop = scroller.scrollTop;
    scrolling = true;
    clearTimeout(scrollingTimer);
    scrollingTimer = setTimeout(() => (scrolling = false), SCROLLING_MS);
  }

  /** Selects the row with this key and scrolls it into view (a new connection, #216); a key not in the tree is ignored. */
  export function reveal(key: string) {
    const index = rows.findIndex((r) => r.key === key);
    if (index >= 0) select(index);
  }

  /** Selects the row at index, or the nearest selectable one in direction dir (then the other way). */
  function select(index: number, dir: 1 | -1 = 1) {
    if (rows.length === 0) return;
    const from = Math.max(0, Math.min(rows.length - 1, index));
    let i = from;
    while (rows[i] && !selectableRow(rows[i])) i += dir;
    if (!rows[i]) for (i = from; rows[i] && !selectableRow(rows[i]); ) i -= dir;
    if (!rows[i]) return;
    selectedKey = rows[i].key;
    const { top, height: h, rowKind, envId } = rows[i];
    // Keep the row clear of the pinned header above and the footer below.
    const above = rowKind !== "header" && headerOf.has(envId) ? ROW_HEIGHT.header : 0;
    const below = footer ? FOOTER_HEIGHT : 0;
    if (top - above < scroller.scrollTop) scroller.scrollTop = top - above;
    else if (top + h > scroller.scrollTop + scroller.clientHeight - below) scroller.scrollTop = top + h - scroller.clientHeight + below;
  }

  /**
   * Focus stays on the tree itself (#219); rows never take it, so a click leaves no focus ring behind. Set while focus
   * arrives without a keyboard choice of row: a click selects its own row, and Seek's Esc keeps the landing.
   */
  let keepSelection = false;

  /** Seek's Esc (docs/landing.md) passes pick false: nothing is selected, so the landing stays. */
  export function focus(pick = true) {
    keepSelection = !pick;
    scroller.focus();
    keepSelection = false;
  }

  /**
   * Focus moved here from elsewhere on the page with nothing selected selects the first row in view, so the arrows
   * start there. Not when the window regains focus (no previous element) or a closing dialog or menu hands it back
   * (#216): nothing was chosen, so the landing stays.
   */
  function onFocus(e: FocusEvent) {
    focused = true;
    const keep = keepSelection;
    keepSelection = false;
    const from = e.relatedTarget instanceof Element ? e.relatedTarget : undefined;
    if (keep || selectedKey !== undefined || !from || from.closest("dialog, [role='menu']")) return;
    select(firstBelow(scroller.scrollTop));
  }

  /** The id aria-activedescendant names; keys may hold spaces, which an id cannot. */
  const rowId = (key: string) => `${uid}-${encodeURIComponent(key)}`;
  const activeId = $derived(selectedIndex >= start && selectedIndex < end ? rowId(rows[selectedIndex].key) : undefined);

  function pageRows(direction: 1 | -1): number {
    const target = (selectedIndex >= 0 ? rows[selectedIndex].top : 0) + direction * scroller.clientHeight;
    return direction > 0 ? Math.min(rows.length - 1, firstBelow(target)) : Math.max(0, firstBelow(target));
  }

  function toggle(row: Row) {
    if (row.type === "group") model.toggle(UNGROUPED);
    else if (row.type === "node" && row.node.hasChildren) model.toggle(row.node.id);
  }

  function onKeydown(e: KeyboardEvent) {
    // The footer's buttons sit inside the tree's focus container; their keys (Enter, Space) are theirs.
    if ((e.target as Element | null)?.closest?.(".tree-footer")) return;
    const row = rows[selectedIndex];
    if (e.altKey && (e.key === "ArrowUp" || e.key === "ArrowDown")) {
      if (row) moveRow(row, e.key === "ArrowUp" ? -1 : 1);
      e.preventDefault();
      return;
    }
    switch (e.key) {
      case "ArrowDown":
        select(selectedIndex + 1);
        break;
      case "ArrowUp":
        select(selectedIndex - 1, -1);
        break;
      case "PageDown":
        select(pageRows(1));
        break;
      case "PageUp":
        select(pageRows(-1), -1);
        break;
      case "Home":
        select(0);
        break;
      case "End":
        select(rows.length - 1, -1);
        break;
      case "ArrowRight":
        if (row?.type === "group") {
          if (!row.expanded) model.expand(UNGROUPED);
          else select(selectedIndex + 1);
          break;
        }
        if (row?.type !== "node") break;
        if (row.node.hasChildren && !row.expanded) model.expand(row.node.id);
        else if (row.expanded) select(selectedIndex + 1);
        break;
      case "ArrowLeft": {
        if (!row) break;
        if (row.type === "group" && row.expanded) {
          model.collapse(UNGROUPED);
          break;
        }
        if (row.type === "node" && row.expanded) {
          model.collapse(row.node.id);
          break;
        }
        const parentId = row.type === "node" ? model.parentOf(row.node.id) : row.parentId;
        // A loose connection's parent is the root; under the Ungrouped header, that header stands for it.
        const parentKey = parentId === "" && row.loose ? UNGROUPED : parentId;
        const parentIndex = rows.findIndex((r) => r.key === parentKey);
        if (parentIndex >= 0) select(parentIndex);
        break;
      }
      case "Enter":
        if (row) onActivate(row);
        break;
      case "Escape":
        // Nothing selected brings the landing back (docs/landing.md).
        if (selectedKey === undefined) return;
        selectedKey = undefined;
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

  /** Alt+Up and Alt+Down: an environment among the environments, a connection within its group (#63). */
  function moveRow(row: Row, by: -1 | 1) {
    if (row.type !== "node") return;
    if (row.node.kind === "environment") {
      const order = model.treeEnvironmentIds();
      const next = moveEnvironment(order, order, row.node.meta?.environmentId ?? "", by);
      if (next.join("\n") !== order.join("\n")) onReorderEnvironments(next);
      return;
    }
    const group = model.connectionGroup(row.node.id);
    const connectionId = row.node.meta?.connectionId;
    const beforeId = group && connectionId ? stepConnection(group.connectionIds, connectionId, by) : undefined;
    if (group && connectionId && beforeId !== undefined) onMoveConnection(connectionId, group.environmentId, beforeId);
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

  /** Dragging a row into the query editor inserts the text its backend gave it (meta.dragText); Monaco's drop handler places it. */
  function onRowDragStart(e: DragEvent, row: Row) {
    // Connections and environment headers drag to move them; anything else drags its text into the editor.
    dragging = undefined;
    const connectionId = row.type === "node" && row.node.kind === "connection" ? row.node.meta?.connectionId : undefined;
    const environmentId = row.type === "node" && row.node.kind === "environment" ? row.node.meta?.environmentId : undefined;
    if ((connectionId || environmentId) && e.dataTransfer) {
      e.dataTransfer.setData(connectionId ? CONNECTION_MIME : ENVIRONMENT_MIME, (connectionId ?? environmentId)!);
      e.dataTransfer.effectAllowed = "move";
      dragging = connectionId ? { kind: "connection", id: connectionId } : { kind: "environment", id: environmentId! };
      return;
    }
    const text = row.type === "node" ? row.node.meta?.dragText : undefined;
    if (!text || !e.dataTransfer) return e.preventDefault();
    e.dataTransfer.setData("text/plain", text);
    e.dataTransfer.effectAllowed = "copy";
  }

  /**
   * What dropping here would do, or undefined where the row is not a target. A connection goes into an environment
   * (its header or empty row, or the Ungrouped header) or before or after another connection; an environment before
   * or after another environment. Which, by the half of the row the pointer is in (#63).
   */
  function dropHere(e: DragEvent, row: Row): { at: DropAt; run: () => void } | undefined {
    // The source row can scroll out of the virtualiser mid-drag and miss its dragend, so the drag itself must say so.
    if (!dragging || !e.dataTransfer?.types.includes(dragging.kind === "connection" ? CONNECTION_MIME : ENVIRONMENT_MIME)) return undefined;
    const box = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const upper = e.clientY < box.top + box.height / 2;
    if (dragging?.kind === "connection") {
      const id = dragging.id;
      const target = connectionDrop(row, upper, id, row.type === "node" ? model.connectionGroup(row.node.id) : undefined);
      return target && { at: target.at, run: () => onMoveConnection(id, target.drop.environmentId, target.drop.beforeId) };
    }
    if (dragging?.kind === "environment") {
      const target = environmentDrop(row, upper, dragging.id, model.treeEnvironmentIds());
      return target && { at: target.at, run: () => onReorderEnvironments(target.order) };
    }
    return undefined;
  }

  function onRowDragOver(e: DragEvent, row: Row) {
    const target = dropHere(e, row);
    if (!target) {
      // Not a target, or the half of the row that would leave it where it is.
      if (dropOn?.key === row.key) dropOn = undefined;
      return;
    }
    e.preventDefault();
    if (e.dataTransfer) e.dataTransfer.dropEffect = "move";
    if (dropOn?.key !== row.key || dropOn.at !== target.at) dropOn = { key: row.key, at: target.at };
  }

  /** Crossing onto the row's own chevron, name or count also fires dragleave: only leaving the row clears it. */
  function onRowDragLeave(e: DragEvent, row: Row) {
    const to = e.relatedTarget;
    if (to instanceof Node && (e.currentTarget as HTMLElement).contains(to)) return;
    if (dropOn?.key === row.key) dropOn = undefined;
  }

  function onRowDrop(e: DragEvent, row: Row) {
    const target = dropHere(e, row);
    onDragEnd();
    if (!target) return;
    e.preventDefault();
    target.run();
  }

  /** Every drag ends here, dropped or not (Escape cancels a drag natively): nothing stays marked. */
  function onDragEnd() {
    dragging = undefined;
    dropOn = undefined;
  }

  function onRowMouseDown(e: MouseEvent, row: Row) {
    if (!selectableRow(row)) return;
    selectedKey = row.key;
    if (e.button === 0 && (e.target as HTMLElement).classList.contains("chevron")) toggle(row);
  }
</script>

<!-- One row's markup, drawn by the virtualiser and again for the pinned header (the same row, not a copy). -->
{#snippet treeRow(row: Row, pin: boolean)}
  <!-- Keys are handled once on the tree (Enter on an error row opens Problems), which keeps focus and names the
       selected row with aria-activedescendant, so rows are not focusable. -->
  <!-- svelte-ignore a11y_click_events_have_key_events, a11y_interactive_supports_focus -->
  <div
    id={pin ? undefined : rowId(row.key)}
    class="tree-row {row.rowKind}"
    class:selected={row.key === selectedKey}
    class:drop-over={row.key === dropOn?.key && dropOn.at === "over"}
    class:drop-before={row.key === dropOn?.key && dropOn.at === "before"}
    class:drop-after={row.key === dropOn?.key && dropOn.at === "after"}
    role="treeitem"
    aria-selected={row.key === selectedKey}
    aria-expanded={row.type === "group" || (row.type === "node" && row.node.hasChildren) ? row.expanded : undefined}
    style:height="{row.height}px"
    style:margin-top="{pin ? 0 : row.gapBefore}px"
    style:padding-left="{row.indent + 4 + (row.rowKind === "header" ? 6 : 0)}px"
    style:--drop-indent="{row.indent + 4}px"
    draggable={row.type === "node"}
    ondragstart={(e) => onRowDragStart(e, row)}
    ondragover={(e) => onRowDragOver(e, row)}
    ondragleave={(e) => onRowDragLeave(e, row)}
    ondrop={(e) => onRowDrop(e, row)}
    onmousedown={(e) => onRowMouseDown(e, row)}
    onclick={() => row.type === "error" && onOpenProblem(row.parentId)}
    ondblclick={() => onActivate(row)}
    oncontextmenu={(e) => {
      e.preventDefault();
      if (!selectableRow(row)) return;
      selectedKey = row.key;
      onContextMenu(row, e.clientX, e.clientY);
    }}
  >
    {#if row.type === "group"}
      <GroupHeaderRow {row} />
    {:else if row.type === "node" && row.rowKind === "header"}
      <EnvHeaderRow {row} />
    {:else if row.type === "node" && row.rowKind === "connection"}
      <ConnectionRow {row} {disconnected} />
    {:else if row.type === "node" && row.rowKind === "folder"}
      <FolderRow {row} />
    {:else}
      <LeafRow {row} />
    {/if}
  </div>
{/snippet}

<div
  class="tree"
  class:focused
  class:scrolling
  class:no-badge={!showKindBadge}
  class:font-ui={rowFont === "ui"}
  role="tree"
  tabindex="0"
  aria-activedescendant={activeId}
  bind:this={scroller}
  bind:clientHeight={height}
  onscroll={onScroll}
  onkeydown={onKeydown}
  ondragend={onDragEnd}
  onmousedown={(e) => (keepSelection = !(e.target as Element).closest(".tree-footer"))}
  onfocus={onFocus}
  onblur={() => {
    focused = false;
    keepSelection = false;
  }}
>
  {#if pinned}
    <!-- The real header row is still in the list below (scrolled up out of view), so this copy is hidden from
         assistive tech; the mouse uses it like the row itself. -->
    <div class="pin" aria-hidden="true">
      <div
        class="env-group pinned"
        class:loose={pinned.row.loose}
        style:--env={pinned.row.envColor ?? "var(--text-muted)"}
        style:transform="translateY({pinned.offset}px)"
      >
        {@render treeRow(pinned.row, true)}
      </div>
    </div>
  {/if}
  <div class="spacer" style:min-height="{totalHeight}px">
    <div class="window" style:transform="translateY({windowTop}px)">
      <!-- Environments are contiguous in the tree, so an env id appears at most once among the visible groups. -->
      {#each groups as group (group.envId)}
        <div class="env-group" class:loose={group.loose} style:--env={group.color ?? "var(--text-muted)"}>
          {#each group.rows as row (row.key)}
            {@render treeRow(row, false)}
          {/each}
        </div>
      {/each}
    </div>
  </div>
  {#if footer}
    <div class="tree-footer" style:height="{FOOTER_HEIGHT}px">{@render footer()}</div>
  {/if}
</div>

<style>
  .tree {
    display: flex;
    flex-direction: column;
    height: 100%;
    /* Vertical only: nothing in the explorer scrolls sideways (docs/explorer-ux.md, "Principles"). */
    overflow-x: hidden;
    overflow-y: auto;
    outline: none;
    contain: strict;
  }
  /* A 6px thumb on a transparent track with no arrow buttons, shown on hover or while scrolling. WebView2 is
     Chromium; scrollbar-width and scrollbar-color are left unset because they switch these rules off. */
  .tree::-webkit-scrollbar {
    width: 6px;
    height: 0;
  }
  .tree::-webkit-scrollbar-track,
  .tree::-webkit-scrollbar-corner {
    background: transparent;
  }
  .tree::-webkit-scrollbar-button {
    display: none;
    width: 0;
    height: 0;
  }
  .tree::-webkit-scrollbar-thumb {
    border-radius: 3px;
    background: transparent;
  }
  .tree:hover::-webkit-scrollbar-thumb,
  .tree.scrolling::-webkit-scrollbar-thumb {
    background: var(--scrollbar-thumb);
  }
  .pin {
    position: sticky;
    top: 0;
    z-index: 2;
    height: 0;
  }
  .pinned {
    background: var(--bg-pane);
    box-shadow: 0 4px 4px -2px var(--explorer-sticky-shadow);
  }
  .tree-footer {
    position: sticky;
    bottom: 0;
    z-index: 3;
    flex: none;
    box-sizing: border-box;
    border-top: 1px solid var(--border);
    background: var(--explorer-footer-bg);
    backdrop-filter: blur(4px);
  }
  /* Hidden badges leave no gap: display none removes the flex item and its gap. */
  .tree.no-badge :global(.kind-badge) {
    display: none;
  }
  .tree.font-ui {
    --row-font: var(--font-ui);
  }
  .spacer {
    position: relative;
    /* Fills a short tree so the footer stays at the bottom. */
    flex: 1 0 auto;
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
    /* Long labels are clipped at the panel edge, no ellipsis: the dim suffix goes first. */
    overflow: clip;
    cursor: default;
    /* Every row continues the group's bar: solid env colour on headers, darkened elsewhere. */
    box-shadow: inset 4px 0 0 var(--env-dark);
    --env-dark: hsl(from var(--env) h s 25%);
    /* Every fill is the env colour over the base; states only change its alpha. */
    --wash: 0%;
    --wash-hover: 11%;
    --wash-selected: 22%;
    background: color-mix(in srgb, var(--env) var(--wash), transparent);
  }
  .tree-row.header {
    --wash: 14%;
    --wash-hover: 22%;
    --wash-selected: 30%;
    box-shadow: inset 4px 0 0 var(--env);
  }
  /* No environment: no bar and no tint, only the neutral hover and selection washes. :where keeps these at the
     specificity of the rules they override, so the hover and selected rules below still win. */
  :where(.loose) > .tree-row {
    box-shadow: none;
  }
  :where(.loose) > .tree-row.header {
    box-shadow: none;
    --wash: 0%;
    --wash-hover: 11%;
    --wash-selected: 22%;
  }
  .tree-row.drop-over {
    outline: 1px dashed var(--brand-primary);
    outline-offset: -1px;
  }
  /* Where a dragged connection or environment will land: a 2px line at the row's indent, above or below it (#63). */
  .tree-row.drop-before,
  .tree-row.drop-after {
    position: relative;
  }
  .tree-row.drop-before::after,
  .tree-row.drop-after::after {
    content: "";
    position: absolute;
    left: var(--drop-indent);
    right: 0;
    height: 2px;
    background: var(--accent);
    pointer-events: none;
  }
  .tree-row.drop-before::after {
    top: 0;
  }
  .tree-row.drop-after::after {
    bottom: 0;
  }
  .tree-row:hover {
    --wash: var(--wash-hover);
  }
  .tree-row.selected {
    --wash: var(--wash-selected);
  }
  .tree:not(.focused) .tree-row.selected {
    --wash: var(--wash-hover);
  }
  .tree-row :global(.chevron) {
    flex: none;
    width: 12px;
    text-align: center;
    color: var(--text-muted);
    font-size: var(--fs-2xs);
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
    font-size: var(--fs-2xs);
    padding: 0 5px;
    border-radius: 8px;
    border: 1px solid var(--border);
    color: var(--text-muted);
  }
</style>
