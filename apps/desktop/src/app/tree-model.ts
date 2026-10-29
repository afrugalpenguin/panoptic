import type { TreeNode } from "./api";
import { computeLabels, leafLabel, type LabelSegments } from "./labels";

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
}

export type Row =
  | (RowBase & { type: "node"; node: TreeNode; label: LabelSegments; expanded: boolean; loading: boolean; stale: boolean })
  | (RowBase & { type: "loading"; parentId: string })
  | (RowBase & { type: "error"; parentId: string; message: string })
  | (RowBase & { type: "empty"; parentId: string });

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

  /** Refetches one already-loaded level, keeping descendants' caches. Used when config changes. */
  async reload(id: string): Promise<void> {
    if (this.children.has(id)) await this.loadChildren(id);
  }

  rows(): Row[] {
    const out: Row[] = [];
    const root = this.children.get("");
    if (root?.status !== "loaded") return out;

    const visit = (ids: string[], depth: number, envColor: string | undefined, readOnly: boolean) => {
      for (const id of ids) {
        const node = this.nodes.get(id)!;
        const color = node.kind === "environment" ? node.meta?.color : envColor;
        const ro = node.kind === "environment" ? node.meta?.readOnly === "true" : readOnly;
        const expanded = this.expanded.has(id);
        const state = this.children.get(id);
        out.push({
          type: "node",
          key: id,
          node,
          label: this.labels.get(id) ?? { prefix: "", core: node.label, suffix: "" },
          depth,
          expanded,
          loading: state?.status === "loading",
          stale: this.isStale(id),
          envColor: color,
          readOnly: ro,
        });
        if (!expanded || !state) continue;
        const base = { depth: depth + 1, envColor: color, readOnly: ro, parentId: id };
        if (state.status === "loading") out.push({ ...base, type: "loading", key: `${id}#loading` });
        else if (state.status === "error") out.push({ ...base, type: "error", key: `${id}#error`, message: state.message });
        else if (state.ids.length === 0) out.push({ ...base, type: "empty", key: `${id}#empty` });
        else visit(state.ids, depth + 1, color, ro);
      }
    };
    visit(root.ids, 0, undefined, false);
    return out;
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
    if (!loaded.some((n) => n.kind === "connection")) return;
    // Only connections currently listed under an environment: the node cache keeps removed ones.
    const listed = [...this.children].flatMap(([parent, s]) =>
      s.status === "loaded" && this.nodes.get(parent)?.kind === "environment" ? s.ids : [],
    );
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
  }

  private forgetBelow(id: string): void {
    const state = this.children.get(id);
    if (state?.status === "loaded") for (const child of state.ids) this.forgetBelow(child);
    this.children.delete(id);
  }
}
