import type { TreeNode } from "../app/api";
import type { TreeModel } from "../app/tree-model";
import { KINDS, type TreeData } from "./data";

/** The generated tree as the shipped TreeModel's loader sees a sidecar: children by node id, no server. */
export interface TreeSource {
  load: (id: string) => Promise<TreeNode[]>;
  /** Node ids with children, parents before children. */
  expandable: string[];
  /** The last folder in the tree: the bench expands it on its own inside an otherwise open tree. */
  lastFolder: string;
}

const ENV_COLORS = ["#2f9e44", "#f08c00", "#e03131", "#1971c2"];

export function treeSource(tree: TreeData): TreeSource {
  const children = new Map<string, TreeNode[]>([["", []]]);
  const expandable: string[] = [];
  let lastFolder = "";
  for (let i = 0; i < tree.count; i++) {
    const id = `n${i}`;
    const kind = KINDS[tree.kind[i]];
    const hasChildren = tree.size[i] > 1;
    const meta: Record<string, string> | undefined =
      kind === "environment"
        ? { color: ENV_COLORS[i % ENV_COLORS.length], readOnly: "false" }
        : kind === "connection"
          ? { connectionKind: tree.label[i].startsWith("cosmos") ? "cosmos" : "sql" }
          : undefined;
    const node: TreeNode = { id, kind, label: tree.label[i], icon: kind, hasChildren, actions: [], meta };
    children.get(tree.parent[i] < 0 ? "" : `n${tree.parent[i]}`)!.push(node);
    if (hasChildren) {
      children.set(id, []);
      expandable.push(id);
    }
    if (kind === "folder") lastFolder = id;
  }
  return { load: async (id) => children.get(id) ?? [], expandable, lastFolder };
}

/** Expands every node with children except `except`. Parents come first, so each expand finds its node loaded. */
export async function openAll(model: TreeModel, source: TreeSource, except?: string): Promise<void> {
  for (const id of source.expandable) if (id !== except) await model.expand(id);
}
