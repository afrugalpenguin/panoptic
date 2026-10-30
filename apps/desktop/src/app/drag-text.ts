import { TSQL_KEYWORDS } from "../query/intellisense/tsql-words";
import type { TreeNode } from "./api";

const REGULAR = /^[A-Za-z_][A-Za-z0-9_@$#]*$/;
const KEYWORDS = new Set(TSQL_KEYWORDS);

/** Brackets a T-SQL identifier only when it is not a regular identifier or is a keyword. */
function quote(name: string): string {
  return REGULAR.test(name) && !KEYWORDS.has(name.toUpperCase()) ? name : `[${name.replaceAll("]", "]]")}]`;
}

/**
 * The reference for the drag rule, no longer used by the app: the sidecar's backends now put this text in node
 * meta "dragText" (SqlBackend.DragName, CosmosBackend.DragText), with the same cases pinned in DragTextTests.cs. Kept
 * so drag-text.test.ts keeps passing unchanged until a follow-up removes both.
 *
 * The text a tree node inserts when dragged into the query editor, or undefined when it has no name worth inserting.
 * `connectionKind` is the kind of the connection the node sits under.
 */
export function dragText(node: TreeNode, connectionKind: string | undefined): string | undefined {
  if (connectionKind === "cosmos") {
    // Cosmos SQL has no identifier quoting, so names that are not identifiers would not parse.
    const name = node.kind === "container" ? node.label : node.kind === "udf" ? `udf.${node.label}` : undefined;
    return name && /^[A-Za-z_][A-Za-z0-9_.]*$/.test(name) ? name : undefined;
  }
  const { schema, name } = node.meta ?? {};
  if (schema && name) return `${quote(schema)}.${quote(name)}`;
  if (node.kind === "column" && name) return quote(name);
  if (node.kind === "database") return quote(node.label);
  return undefined;
}
