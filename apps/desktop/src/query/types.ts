// Mirrors the query records in apps/sidecar/Panoptic.Sidecar/Model.cs and the notifications
// documented in Query/QueryService.cs.

export interface ResultColumn {
  name: string;
  /** SQL type name; empty for Cosmos. */
  type: string;
}

export type CellValue = string | number | boolean | null | undefined;

export interface QuerySummary {
  queryId: string;
  resultSets: { rowCount: number }[];
  elapsedMs: number;
  /** Read-only environment: the guard transaction was still open at the end and was rolled back. */
  rolledBack: boolean;
  /** Read-only environment: a COMMIT or ROLLBACK in the script (or an error) ended the guard transaction early, so changes may be committed. */
  committed: boolean;
  cancelled: boolean;
  error?: string | null;
  requestCharge?: number | null;
}

export interface RowsNotification {
  queryId: string;
  index: number;
  columns?: ResultColumn[];
  rows: CellValue[][];
}

export interface MessageNotification {
  queryId: string;
  kind: "info" | "error";
  text: string;
  elapsedMs: number;
  /** A server error's number (SQL Server: 208 invalid object name, ...). */
  number?: number;
  /** A server error's SQLSTATE (Postgres: 42P01 undefined table, ...). */
  state?: string;
  /** 1-based line of a server error in the text that was sent; absent when it is in another module or unknown. */
  line?: number;
  /** 1-based column on that line (UTF-16 code units), when the server gives an exact position (Postgres). */
  column?: number;
}

export type QueryLanguage = "sql" | "cosmos" | "pgsql";

/**
 * Mirrors QueryScope in the sidecar's Model.cs: what a node's query tabs belong to, resolved by the sidecar so the UI
 * never parses node ids. `connection` is the connection's node id; database and container are the node's own.
 */
export interface QueryScope {
  connection: string;
  database?: string;
  container?: string;
  /** The nearest container, database or connection name. */
  label?: string;
  connectionLabel?: string;
}

/** What a query tab runs against, captured when the tab is opened. */
export interface QueryTarget {
  nodeId: string;
  /** Database, container or connection name shown on the tab. */
  label: string;
  connection: string;
  envColor?: string;
  readOnly: boolean;
  language: QueryLanguage;
  /** From query.template. Absent: read from the node id (nodeParts), as before the sidecar sent it. */
  scope?: QueryScope;
}
