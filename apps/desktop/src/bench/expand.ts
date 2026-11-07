import { isLoopback } from "../app/loopback";
import type { TreeModel } from "../app/tree-model";

/** One expand, timed from the call to the tree having painted its children. */
export interface ExpandStep {
  /** The connection's engine (sql, postgres, cosmos...). */
  engine: string;
  /** Node kind expanded: connection, database, folder... */
  kind: string;
  /** Labels from the connection down to this node. */
  path: string[];
  /** First expand in this process: for a connection, includes connecting and signing in. */
  coldMs: number;
  /** The same node refreshed straight after, on the warm connection. */
  warmMs?: number;
  children: number;
  error?: string;
}

/** Connections on this machine (the dev-db containers in the seeded store): the only ones a bench can rely on. */
export function expandTargets(model: TreeModel): string[] {
  const connections = [...model.envIds().flatMap((env) => model.childIds(env)), ...model.looseIds()];
  return connections.filter((id) => {
    const node = model.node(id);
    return node?.kind === "connection" && isLoopback(node.meta?.endpoint ?? "");
  });
}

/**
 * For each connection, expands it and then the first expandable child at each level, up to `depth` levels:
 * connection > database > folder, the path a user takes to reach a table. Each level is timed cold, then
 * refreshed and timed warm before going deeper (a refresh drops what is below it).
 */
export async function walkExpands(
  model: TreeModel,
  connectionIds: string[],
  settle: () => Promise<void>,
  now: () => number = () => performance.now(),
  depth = 3,
): Promise<ExpandStep[]> {
  const steps: ExpandStep[] = [];
  const timed = async (work: () => Promise<void>) => {
    const t0 = now();
    await work();
    await settle();
    return Math.round((now() - t0) * 10) / 10;
  };
  const failure = (id: string) => {
    const row = model.rows().find((r) => r.type === "error" && r.parentId === id);
    return row?.type === "error" ? row.error.detail || row.error.summary : undefined;
  };

  for (const connection of connectionIds) {
    const parent = model.parentOf(connection);
    if (parent) await model.expand(parent);
    const engine = model.node(connection)?.meta?.connectionKind ?? "";
    const path: string[] = [];
    let id: string | undefined = connection;
    for (let level = 0; id && level < depth; level++) {
      const node = model.node(id)!;
      path.push(node.label);
      const coldMs = await timed(() => model.expand(id!));
      const error = failure(id);
      const step: ExpandStep = { engine, kind: node.kind, path: [...path], coldMs, children: model.childIds(id).length };
      steps.push(step);
      if (error) {
        step.error = error;
        break;
      }
      step.warmMs = await timed(() => model.refresh(id!));
      id = model.childIds(id).find((child) => model.node(child)?.hasChildren);
    }
  }
  return steps;
}
