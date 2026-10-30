import { RpcError } from "../rpc";
import type { NodeError } from "./api";

/** One entry in the Problems tab: a node whose children failed to load (docs/explorer-errors.md). */
export interface Problem {
  nodeId: string;
  env: string;
  connection: string;
  /** Labels below the connection, down to the node. */
  path: string[];
  error: NodeError;
  /** When it failed, epoch ms. */
  at: number;
}

const MAX_SUMMARY = 80;

function isNodeError(data: unknown): data is NodeError {
  const d = data as NodeError | undefined;
  return typeof d?.summary === "string" && typeof d.detail === "string" && typeof d.retryable === "boolean";
}

/**
 * The sidecar's structured error when it sent one; otherwise (a timeout, the sidecar stopping, an older
 * sidecar) the message's first sentence as the summary and the whole message as the detail.
 */
export function toNodeError(e: unknown): NodeError {
  if (e instanceof RpcError && isNodeError(e.data)) return e.data;
  const message = e instanceof Error ? e.message : String(e);
  return { summary: firstSentence(message), detail: message, retryable: true };
}

export function firstSentence(message: string): string {
  const text = message.trim().split(/(?<=\.)\s|;\s|[\r\n]/)[0].trim() || "The request failed.";
  if (text.length < MAX_SUMMARY) return text;
  const cut = text.lastIndexOf(" ", MAX_SUMMARY - 2);
  return `${text.slice(0, cut > MAX_SUMMARY / 2 ? cut : MAX_SUMMARY - 2).trimEnd()}…`;
}

/** Tree row tooltip: the summary plus the code. */
export function errorTooltip(error: NodeError): string {
  return error.code ? `${error.summary} (${error.code})` : error.summary;
}

/** What Copy error puts on the clipboard. */
export function errorText(error: NodeError): string {
  return `${errorTooltip(error)}\n\n${error.detail}`;
}
