import type { NodeError, TreeNode } from "./api";
import { kindBadge, type KindBadge } from "./kinds";
import { computeLabels, leafLabel, type LabelSegments } from "./labels";
import { isAbortError } from "../rpc";
import { toNodeError, type Problem } from "./problems";

/** Fixed row heights per level (docs/explorer-ux.md); the virtualiser lays rows out from these alone. */
export const ROW_HEIGHT = { header: 26, connection: 24, folder: 22, leaf: 22 } as const;
/** Space before each environment group after the first. */
export const ENV_GAP = 4;
const CONNECTION_INDENT = 30;
/** Connections at the root when there are no environments: no group bar to clear (docs/explorer-ux.md). */
const FLAT_CONNECTION_INDENT = 10;
const INDENT_STEP = 20;
/** Key of the synthetic group that holds connections in no environment. Not a node id: ids never start with "#". */
export const UNGROUPED = "#ungrouped";

export type RowKind = keyof typeof ROW_HEIGHT;

type ChildState =
  | { status: "loading"; startedAt: number }
  | { status: "loaded"; ids: string[]; loadedAt: number }
  | { status: "error"; error: NodeError };

interface RowBase {
  /** Stable key: the node id, or the parent id plus a suffix for placeholder rows. */
  key: string;
  depth: number;
  envColor?: string;
  readOnly: boolean;
  /** Which row component draws it; placeholders (loading, error, empty) draw as leaves. */
  rowKind: RowKind;
  height: number;
  /** Offset of the row's own box from the top of the tree; any gap sits above it. */
  top: number;
  gapBefore: number;
  /** Pixels from the left bar: connections 30, then 20 more per level. Headers 0. */
  indent: number;
  /** The environment node id this row belongs to, for grouping rows under --env; UNGROUPED for loose connections. */
  envId: string;
  /** In no environment: no environment colour, bar or wash. */
  loose: boolean;
}

export type Row =
  | (RowBase & {
      type: "node";
      node: TreeNode;
      label: LabelSegments;
      expanded: boolean;
      loading: boolean;
      stale: boolean;
      /** Connection rows only. */
      badge?: KindBadge;
      /** Headers: connections in the env. Folders: loaded children. */
      count?: number;
      /** Muted text after the name, e.g. a container's partition key. */
      secondary?: string;
      /** Its children failed to load: a warning glyph after the label, visible even when collapsed. */
      error?: NodeError;
    })
  | (RowBase & { type: "loading"; parentId: string })
  | (RowBase & { type: "error"; parentId: string; error: NodeError })
  | (RowBase & { type: "empty"; parentId: string })
  /** The dimmed "Ungrouped" header over connections in no environment (only when there are environments). */
  | (RowBase & { type: "group"; parentId: ""; expanded: boolean; count: number })
  /** "Empty - drag a connection here" under an environment with no connections: not a node, not selectable. */
  | (RowBase & { type: "env-empty"; parentId: string; environmentId: string });

/** Whether keys and clicks can select the row. */
export const selectableRow = (row: Row) => row.type !== "env-empty";

/**
 * Where a connection dropped on the row goes: an environment id (its header or its empty row), null for no
 * environment (the Ungrouped header), undefined when the row is not a drop target.
 */
export function dropTarget(row: Row): string | null | undefined {
  if (row.type === "group") return null;
  if (row.type === "env-empty") return row.environmentId;
  if (row.type === "node" && row.node.kind === "environment") return row.node.meta?.environmentId;
  return undefined;
}

/** One chip in the kind filter row: a kind present in the loaded connections and how many. */
export interface KindSummary {
  kind: string;
  badge: KindBadge;
  count: number;
}

export interface LoadReport {
  id: string;
  label: string;
  count: number;
  ms: number;
  /** The failure's summary line. */
  error?: string;
}

export const DEFAULT_STALE_MS = 5 * 60_000;

/**
 * Tree state, independent of rendering: node cache, expansion, lazy loading. Children are fetched
 * on first expand and cached; after `staleMs` they are marked stale rather than refetched.
 */
/** The order the tree shows environments in: the saved order first, then the rest in order added. */
export function environmentOrder(saved: string[], known: string[]): string[] {
  return [...saved.filter((e) => known.includes(e)), ...known.filter((e) => !saved.includes(e))];
}

/** explorer.envOrder after moving one environment up (-1) or down (1). Ids of deleted environments are dropped. */
export function moveEnvironment(saved: string[], known: string[], id: string, by: -1 | 1): string[] {
  const order = environmentOrder(saved, known);
  const i = order.indexOf(id);
  const j = i + by;
  if (i < 0 || j < 0 || j >= order.length) return order;
  [order[i], order[j]] = [order[j], order[i]];
  return order;
}

export class TreeModel {
  private readonly nodes = new Map<string, TreeNode>();
  private readonly parents = new Map<string, string>();
  private readonly children = new Map<string, ChildState>();
  private readonly expanded = new Set<string>();
  /** Display segments per node, rebuilt when nodes load (docs/explorer-ux.md); rows only read them. */
  private readonly labels = new Map<string, LabelSegments>();
  /** Built with the labels: connection kind per connection id, kind counts per env, and tree-wide. */
  private readonly connectionKind = new Map<string, string>();
  private envKinds = new Map<string, Map<string, number>>();
  private kindList: KindSummary[] = [];
  private kindFilter: string | undefined;
  /** explorer.envOrder: environment ids (not node ids) in manual order. */
  private envOrder: string[] = [];
  /** Each node's last failed load, kept while a retry is loading (docs/explorer-errors.md); cleared on success. */
  private readonly failures = new Map<string, { error: NodeError; at: number }>();
  /** Aborts each in-flight load; collapsing a node, or cancelling from the status bar, aborts its load. */
  private readonly loads = new Map<string, AbortController>();
  /** The Ungrouped group starts open: its connections are already loaded with the root. */
  private ungroupedOpen = true;

  constructor(
    private readonly load: (id: string, signal: AbortSignal) => Promise<TreeNode[]>,
    private readonly onChange: () => void,
    private readonly staleMs = DEFAULT_STALE_MS,
    private readonly onLoaded: (report: LoadReport) => void = () => {},
  ) {}

  node(id: string): TreeNode | undefined {
    return this.nodes.get(id);
  }

  parentOf(id: string): string | undefined {
    return this.parents.get(id);
  }

  /** Ids of a node's loaded children ("" for the environments); empty while loading, failed or not loaded. */
  childIds(id: string): string[] {
    const state = this.children.get(id);
    return state?.status === "loaded" ? [...state.ids] : [];
  }

  isExpanded(id: string): boolean {
    return id === UNGROUPED ? this.ungroupedOpen : this.expanded.has(id);
  }

  /** The root's environment nodes, without the connections in no environment. */
  envIds(): string[] {
    return this.childIds("").filter((id) => this.nodes.get(id)?.kind !== "connection");
  }

  /**
   * After a move, opens where the connection landed so it never seems to vanish: the environment with that config
   * id (an empty one could not be open before), or the Ungrouped group for null. An unknown id opens nothing.
   */
  async reveal(environmentId: string | null): Promise<void> {
    if (environmentId === null) return this.expand(UNGROUPED);
    const id = this.envIds().find((e) => this.nodes.get(e)?.meta?.environmentId === environmentId);
    if (id) await this.expand(id);
  }

  /** The root's connections in no environment. */
  looseIds(): string[] {
    return this.childIds("").filter((id) => this.nodes.get(id)?.kind === "connection");
  }

  isStale(id: string): boolean {
    const state = this.children.get(id);
    return state?.status === "loaded" && Date.now() - state.loadedAt > this.staleMs;
  }

  /** Ids currently loading, with when they started, for the status bar's elapsed timer. */
  inFlight(): { id: string; startedAt: number }[] {
    return [...this.children].flatMap(([id, s]) => (s.status === "loading" ? [{ id, startedAt: s.startedAt }] : []));
  }

  loadRoot(): Promise<void> {
    return this.loadChildren("");
  }

  async toggle(id: string): Promise<void> {
    if (this.isExpanded(id)) this.collapse(id);
    else await this.expand(id);
  }

  async expand(id: string): Promise<void> {
    if (id === UNGROUPED) {
      this.ungroupedOpen = true;
      return this.onChange();
    }
    const node = this.nodes.get(id);
    if (node && !node.hasChildren) return;
    this.expanded.add(id);
    const state = this.children.get(id);
    if (!state || state.status === "error") await this.loadChildren(id);
    else this.onChange();
  }

  /** Collapsing a node that is still loading cancels the load; expanding again starts a fresh one. */
  collapse(id: string): void {
    if (id === UNGROUPED) this.ungroupedOpen = false;
    this.expanded.delete(id);
    this.loads.get(id)?.abort();
    this.onChange();
  }

  /** Collapses every node, so re-expanding shows each level closed. Loads under way for them are cancelled. */
  collapseAll(): void {
    for (const id of this.expanded) this.loads.get(id)?.abort();
    this.expanded.clear();
    this.ungroupedOpen = false;
    this.onChange();
  }

  /**
   * Seek's Enter: only this environment open, and the connection in it when given (docs/landing.md). With no
   * environment, the Ungrouped group is the one left open (with no environments at all it is not drawn).
   */
  async focus(envId: string | undefined, id?: string): Promise<void> {
    for (const other of this.envIds()) if (other !== envId && this.expanded.has(other)) this.collapse(other);
    if (envId) {
      this.ungroupedOpen = false;
      await this.expand(envId);
    } else await this.expand(UNGROUPED);
    if (id && id !== envId) await this.expand(id);
  }

  /** The status bar's cancel: stops a node's load and collapses it, as if it had never been expanded. */
  cancel(id: string): void {
    if (this.expanded.has(id)) this.collapse(id);
    else this.loads.get(id)?.abort();
  }

  /**
   * Expand all: opens every environment as far as its connections and closes everything deeper.
   * Connection lists are config only, so this never calls a server.
   */
  async expandEnvironments(): Promise<void> {
    const envs = this.envIds().filter((id) => this.nodes.get(id)?.hasChildren);
    this.expanded.clear();
    this.ungroupedOpen = true;
    for (const id of envs) this.expanded.add(id);
    this.onChange();
    const unloaded = envs.filter((id) => !this.children.has(id) || this.children.get(id)!.status === "error");
    await Promise.all(unloaded.map((id) => this.loadChildren(id)));
  }

  /** Reloads a node's children. Descendants' caches are dropped so they reload when expanded. */
  async refresh(id: string): Promise<void> {
    this.forgetBelow(id);
    if (id === "" || this.expanded.has(id)) await this.loadChildren(id);
    else this.onChange();
  }

  /**
   * Loads children without expanding: used to fetch every environment's connection list at start-up
   * (config only, no server calls), so labels and kind chips see the whole tree.
   */
  async preload(ids: string[]): Promise<void> {
    await Promise.all(ids.filter((id) => !this.children.has(id)).map((id) => this.loadChildren(id)));
  }

  /** Kinds present in the loaded connections, in order of first appearance, with counts. */
  kinds(): KindSummary[] {
    return this.kindList;
  }

  /** Applies explorer.envOrder. Listed environments come first in that order, the rest in order added. */
  setEnvOrder(order: string[]): void {
    if (JSON.stringify(order) === JSON.stringify(this.envOrder)) return;
    this.envOrder = [...order];
    this.onChange();
  }

  /** The kind being filtered on, if any; cleared automatically when that kind disappears. */
  activeKind(): string | undefined {
    return this.kindFilter;
  }

  /** Shows only connections of one kind (and environments that have some); undefined shows all. */
  setKindFilter(kind: string | undefined): void {
    if (this.kindFilter === kind) return;
    this.kindFilter = kind;
    this.onChange();
  }

  /** Refetches one already-loaded level, keeping descendants' caches. Used when config changes. */
  async reload(id: string): Promise<void> {
    if (this.children.has(id)) await this.loadChildren(id);
  }

  /**
   * The sidecar went away (ADR 0005): drops everything loaded below the connection rows, and its
   * Problems entries, and collapses those levels, since reopening them means new server calls.
   * Environments, their connection lists and which environments are open are kept.
   */
  forgetConnections(): void {
    for (const env of this.envIds()) {
      const state = this.children.get(env);
      if (state?.status === "loaded") for (const id of state.ids) this.forgetBelow(id);
    }
    for (const id of this.looseIds()) this.forgetBelow(id);
    for (const id of this.expanded) if (this.nodes.get(id)?.kind !== "environment") this.expanded.delete(id);
    this.onChange();
  }

  /**
   * One entry per node whose children failed to load, oldest first. A node that is reloading keeps its
   * entry until it succeeds; one no longer in the tree (connection removed, ancestor refreshed) drops it.
   */
  problems(): Problem[] {
    const out: Problem[] = [];
    for (const [id, { error, at }] of this.failures) {
      if (!this.children.has(id) || !this.reachable(id)) {
        this.failures.delete(id);
        continue;
      }
      const chain: TreeNode[] = [];
      for (let cur: string | undefined = id; cur; cur = this.parents.get(cur)) {
        const n = this.nodes.get(cur);
        if (n) chain.unshift(n);
      }
      const env = chain.find((n) => n.kind === "environment");
      const connectionIndex = chain.findIndex((n) => n.kind === "connection");
      out.push({
        nodeId: id,
        env: env?.label ?? "",
        connection: connectionIndex >= 0 ? chain[connectionIndex].label : "",
        path: connectionIndex >= 0 ? chain.slice(connectionIndex + 1).map((n) => n.label) : [],
        error,
        at,
      });
    }
    return out.sort((a, b) => a.at - b.at);
  }

  rows(): Row[] {
    const out: Row[] = [];
    const root = this.children.get("");
    if (root?.status !== "loaded") return out;
    let top = 0;
    const filter = this.kindFilter;
    const envs = this.orderedEnvs(this.envIds());
    const loose = this.looseIds().filter((id) => !filter || this.connectionKind.get(id) === filter);
    // With no environments at all, loose connections are the whole tree: flat at the root, no header.
    const flat = envs.length === 0;

    const place = <T extends Omit<RowBase, "height" | "top" | "gapBefore">>(row: T, firstOfTree: boolean) => {
      const gapBefore = row.rowKind === "header" && !firstOfTree ? ENV_GAP : 0;
      const height = ROW_HEIGHT[row.rowKind];
      top += gapBefore;
      const placed = { ...row, height, top, gapBefore };
      top += height;
      return placed;
    };
    const indentFor = (depth: number) =>
      flat ? FLAT_CONNECTION_INDENT + depth * INDENT_STEP : depth === 0 ? 0 : CONNECTION_INDENT + (depth - 1) * INDENT_STEP;

    const visit = (ids: string[], depth: number, envColor: string | undefined, readOnly: boolean, envId: string, isLoose: boolean) => {
      for (const id of ids) {
        const node = this.nodes.get(id)!;
        const isEnv = node.kind === "environment";
        if (filter && isEnv && !this.envKinds.get(id)?.get(filter)) continue;
        if (filter && node.kind === "connection" && this.connectionKind.get(id) !== filter) continue;
        const color = isEnv ? node.meta?.color : envColor;
        const ro = isEnv ? node.meta?.readOnly === "true" : readOnly;
        const env = isEnv ? id : envId;
        const expanded = this.expanded.has(id);
        const state = this.children.get(id);
        const rowKind: RowKind = isEnv ? "header" : node.kind === "connection" ? "connection" : node.kind === "folder" ? "folder" : "leaf";
        const loadedCount = state?.status === "loaded" ? state.ids.length : undefined;
        out.push(
          place(
            {
              type: "node" as const,
              key: id,
              node,
              label: this.labels.get(id) ?? { prefix: "", core: node.label, suffix: "" },
              depth,
              expanded,
              loading: state?.status === "loading",
              stale: this.isStale(id),
              envColor: color,
              readOnly: ro,
              rowKind,
              indent: indentFor(depth),
              envId: env,
              loose: isLoose,
              badge: rowKind === "connection" ? kindBadge(node.meta?.connectionKind ?? node.icon) : undefined,
              count: isEnv
                ? filter
                  ? this.envKinds.get(id)?.get(filter)
                  : Number(node.meta?.connectionCount) || loadedCount
                : rowKind === "folder"
                  ? loadedCount
                  : undefined,
              secondary: node.meta?.partitionKey ?? node.meta?.detail,
              error: state?.status === "error" ? state.error : undefined,
            },
            out.length === 0,
          ),
        );
        const base = { depth: depth + 1, envColor: color, readOnly: ro, parentId: id, rowKind: "leaf" as const, indent: indentFor(depth + 1), envId: env, loose: isLoose };
        // An environment with no connections cannot expand: its hint row is always there to drop onto.
        if (isEnv && !node.hasChildren) {
          out.push(place({ ...base, type: "env-empty" as const, key: `${id}#empty`, environmentId: node.meta?.environmentId ?? "" }, false));
          continue;
        }
        if (!expanded || !state) continue;
        if (state.status === "loading") out.push(place({ ...base, type: "loading" as const, key: `${id}#loading` }, false));
        else if (state.status === "error") out.push(place({ ...base, type: "error" as const, key: `${id}#error`, error: state.error }, false));
        else if (state.ids.length === 0) out.push(place({ ...base, type: "empty" as const, key: `${id}#empty` }, false));
        else visit(state.ids, depth + 1, color, ro, env, isLoose);
      }
    };
    visit(envs, 0, undefined, false, "", false);
    if (loose.length === 0) return out;
    if (flat) {
      visit(loose, 0, undefined, false, UNGROUPED, true);
      return out;
    }
    out.push(
      place(
        {
          type: "group" as const,
          parentId: "" as const,
          key: UNGROUPED,
          depth: 0,
          readOnly: false,
          rowKind: "header" as const,
          indent: 0,
          envId: UNGROUPED,
          loose: true,
          expanded: this.ungroupedOpen,
          count: loose.length,
        },
        out.length === 0,
      ),
    );
    if (this.ungroupedOpen) visit(loose, 1, undefined, false, UNGROUPED, true);
    return out;
  }

  private orderedEnvs(ids: string[]): string[] {
    if (this.envOrder.length === 0) return ids;
    const rank = new Map(this.envOrder.map((envId, i) => [envId, i]));
    const position = (id: string) => rank.get(this.nodes.get(id)?.meta?.environmentId ?? "") ?? Number.MAX_SAFE_INTEGER;
    return [...ids].sort((a, b) => position(a) - position(b));
  }

  private async loadChildren(id: string): Promise<void> {
    const startedAt = performance.now();
    const prior = this.children.get(id);
    const controller = new AbortController();
    this.loads.set(id, controller);
    this.children.set(id, { status: "loading", startedAt: Date.now() });
    this.onChange();
    const label = this.nodes.get(id)?.label ?? "tree";
    try {
      const items = await this.load(id, controller.signal);
      for (const item of items) {
        this.nodes.set(item.id, item);
        this.parents.set(item.id, id);
      }
      this.children.set(id, { status: "loaded", ids: items.map((i) => i.id), loadedAt: Date.now() });
      this.failures.delete(id);
      this.buildLabels(items);
      this.onLoaded({ id, label, count: items.length, ms: Math.round(performance.now() - startedAt) });
    } catch (e) {
      if (controller.signal.aborted || isAbortError(e)) {
        // Cancelled on purpose, not a failure: no error row, no Problems entry, no status bar error. The node
        // goes back to how it was (unloaded, loaded or failed), unless a newer load has taken over.
        if (this.loads.get(id) === controller) {
          if (prior && prior.status !== "loading") this.children.set(id, prior);
          else this.children.delete(id);
        }
      } else {
        const error = toNodeError(e);
        this.children.set(id, { status: "error", error });
        this.failures.set(id, { error, at: Date.now() });
        this.onLoaded({ id, label, count: 0, ms: Math.round(performance.now() - startedAt), error: error.summary });
      }
    } finally {
      if (this.loads.get(id) === controller) this.loads.delete(id);
    }
    this.onChange();
  }

  /**
   * The label build step. Endpoint segments depend on every connection of the same kind, so they are
   * recomputed over the whole tree whenever connections load; other nodes get theirs as they arrive
   * (schema-qualified objects dim the schema, everything else is the plain label).
   */
  private buildLabels(loaded: TreeNode[]): void {
    for (const n of loaded) {
      if (n.kind !== "connection") this.labels.set(n.id, n.meta?.schema ? leafLabel(n.label) : { prefix: "", core: n.label, suffix: "" });
    }
    if (!loaded.some((n) => n.kind === "connection" || n.kind === "environment")) return;
    // Only connections still listed, under an environment that is itself still listed or at the root: the node
    // cache keeps removed environments and connections.
    const listed = [
      ...this.envIds().flatMap((env) => {
        const s = this.children.get(env);
        return s?.status === "loaded" ? s.ids : [];
      }),
      ...this.looseIds(),
    ];
    const connections = listed
      .map((id) => this.nodes.get(id)!)
      .filter((n) => n.kind === "connection")
      .map((n) => ({
        id: n.id,
        kind: n.meta?.connectionKind ?? n.icon,
        endpoint: n.meta?.endpoint ?? n.label,
        envId: this.parents.get(n.id) ?? "",
      }));
    for (const [id, segments] of computeLabels(connections)) this.labels.set(id, segments);

    // Kinds for the filter chips, from the same connection list.
    this.connectionKind.clear();
    this.envKinds = new Map();
    const totals = new Map<string, number>();
    for (const c of connections) {
      this.connectionKind.set(c.id, c.kind);
      const perEnv = this.envKinds.get(c.envId) ?? new Map<string, number>();
      perEnv.set(c.kind, (perEnv.get(c.kind) ?? 0) + 1);
      this.envKinds.set(c.envId, perEnv);
      totals.set(c.kind, (totals.get(c.kind) ?? 0) + 1);
    }
    this.kindList = [...totals].map(([kind, count]) => ({ kind, badge: kindBadge(kind), count }));
    if (this.kindFilter && !totals.has(this.kindFilter)) this.kindFilter = undefined;
  }

  /** Whether a node is still listed: every ancestor is loaded and lists it. */
  private reachable(id: string): boolean {
    for (let cur = id; cur !== ""; ) {
      const parent = this.parents.get(cur);
      const state = parent === undefined ? undefined : this.children.get(parent);
      if (parent === undefined || state?.status !== "loaded" || !state.ids.includes(cur)) return false;
      cur = parent;
    }
    return true;
  }

  private forgetBelow(id: string): void {
    const state = this.children.get(id);
    if (state?.status === "loaded") for (const child of state.ids) this.forgetBelow(child);
    this.children.delete(id);
  }
}
