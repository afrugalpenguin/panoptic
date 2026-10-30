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
}

export type QueryLanguage = "sql" | "cosmos";

/** What a query tab runs against, captured when the tab is opened. */
export interface QueryTarget {
  nodeId: string;
  /** Database, container or connection name shown on the tab. */
  label: string;
  connection: string;
  envColor?: string;
  readOnly: boolean;
  language: QueryLanguage;
}
