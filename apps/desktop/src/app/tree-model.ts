import type { TreeNode } from "./api";
import { kindBadge, type KindBadge } from "./kinds";
import { computeLabels, leafLabel, type LabelSegments } from "./labels";

/** Fixed row heights per level (docs/explorer-ux.md); the virtualiser lays rows out from these alone. */
export const ROW_HEIGHT = { header: 26, connection: 24, folder: 22, leaf: 22 } as const;
/** Space before each environment group after the first. */
export const ENV_GAP = 4;
const CONNECTION_INDENT = 30;
const INDENT_STEP = 20;

export type RowKind = keyof typeof ROW_HEIGHT;

type ChildState =
  | { status: "loading"; startedAt: number }
  | { status: "loaded"; ids: string[]; loadedAt: number }
  | { status: "error"; message: string };

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
  /** The environment node id this row belongs to, for grouping rows under --env. */
  envId: string;
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
    })
  | (RowBase & { type: "loading"; parentId: string })
  | (RowBase & { type: "error"; parentId: string; message: string })
  | (RowBase & { type: "empty"; parentId: string });

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
  error?: string;
}

export const DEFAULT_STALE_MS = 5 * 60_000;

/**
 * Tree state, independent of rendering: node cache, expansion, lazy loading. Children are fetched
 * on first expand and cached; after `staleMs` they are marked stale rather than refetched.
 */
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

  constructor(
    private readonly load: (id: string) => Promise<TreeNode[]>,
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

  isExpanded(id: string): boolean {
    return this.expanded.has(id);
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
    if (this.expanded.has(id)) this.collapse(id);
    else await this.expand(id);
  }

  async expand(id: string): Promise<void> {
    const node = this.nodes.get(id);
    if (node && !node.hasChildren) return;
    this.expanded.add(id);
    const state = this.children.get(id);
    if (!state || state.status === "error") await this.loadChildren(id);
    else this.onChange();
  }

  collapse(id: string): void {
    this.expanded.delete(id);
    this.onChange();
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

  rows(): Row[] {
    const out: Row[] = [];
    const root = this.children.get("");
    if (root?.status !== "loaded") return out;
    let top = 0;

    const place = <T extends Omit<RowBase, "height" | "top" | "gapBefore">>(row: T, firstOfTree: boolean) => {
      const gapBefore = row.rowKind === "header" && !firstOfTree ? ENV_GAP : 0;
      const height = ROW_HEIGHT[row.rowKind];
      top += gapBefore;
      const placed = { ...row, height, top, gapBefore };
      top += height;
      return placed;
    };
    const indentFor = (depth: number) => (depth === 0 ? 0 : CONNECTION_INDENT + (depth - 1) * INDENT_STEP);

    const visit = (ids: string[], depth: number, envColor: string | undefined, readOnly: boolean, envId: string) => {
      for (const id of ids) {
        const node = this.nodes.get(id)!;
        const isEnv = node.kind === "environment";
        const filter = this.kindFilter;
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
              badge: rowKind === "connection" ? kindBadge(node.meta?.connectionKind ?? node.icon) : undefined,
              count: isEnv
                ? filter
                  ? this.envKinds.get(id)?.get(filter)
                  : Number(node.meta?.connectionCount) || loadedCount
                : rowKind === "folder"
                  ? loadedCount
                  : undefined,
              secondary: node.meta?.partitionKey ?? node.meta?.detail,
            },
            out.length === 0,
          ),
        );
        if (!expanded || !state) continue;
        const base = { depth: depth + 1, envColor: color, readOnly: ro, parentId: id, rowKind: "leaf" as const, indent: indentFor(depth + 1), envId: env };
        if (state.status === "loading") out.push(place({ ...base, type: "loading" as const, key: `${id}#loading` }, false));
        else if (state.status === "error") out.push(place({ ...base, type: "error" as const, key: `${id}#error`, message: state.message }, false));
        else if (state.ids.length === 0) out.push(place({ ...base, type: "empty" as const, key: `${id}#empty` }, false));
        else visit(state.ids, depth + 1, color, ro, env);
      }
    };
    visit(this.orderedEnvs(root.ids), 0, undefined, false, "");
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
    this.children.set(id, { status: "loading", startedAt: Date.now() });
    this.onChange();
    const label = this.nodes.get(id)?.label ?? "tree";
    try {
      const items = await this.load(id);
      for (const item of items) {
        this.nodes.set(item.id, item);
        this.parents.set(item.id, id);
      }
      this.children.set(id, { status: "loaded", ids: items.map((i) => i.id), loadedAt: Date.now() });
      this.buildLabels(items);
      this.onLoaded({ id, label, count: items.length, ms: Math.round(performance.now() - startedAt) });
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      this.children.set(id, { status: "error", message });
      this.onLoaded({ id, label, count: 0, ms: Math.round(performance.now() - startedAt), error: message });
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
    // Only connections listed under environments that are themselves still listed: the node cache
    // keeps removed environments and connections.
    const root = this.children.get("");
    const envIds = root?.status === "loaded" ? root.ids : [];
    const listed = envIds.flatMap((env) => {
      const s = this.children.get(env);
      return s?.status === "loaded" ? s.ids : [];
    });
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

  private forgetBelow(id: string): void {
    const state = this.children.get(id);
    if (state?.status === "loaded") for (const child of state.ids) this.forgetBelow(child);
    this.children.delete(id);
  }
}
