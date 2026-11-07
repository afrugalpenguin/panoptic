// The detail pane's facts about a node, from its meta, in words rather than raw keys (#225).
import type { TreeNode } from "./api";
import { kindBadge, kindDescription } from "./kinds";

export interface DetailField {
  label: string;
  value: string;
  /** A colour to show as a swatch beside the value. */
  swatch?: string;
}

/** Meta that is for the app, not for reading: ids, editor text, and Cosmos JSON (shown as a block of its own). */
const HIDDEN = new Set(["json", "environmentId", "connectionId", "dragText", "copyText"]);

const LABELS: Record<string, string> = {
  color: "Colour",
  readOnly: "Read-only",
  connectionCount: "Connections",
  connectionKind: "Engine",
  trustServerCertificate: "Trust server certificate",
};

/** "partitionKey" reads "Partition key". */
const sentence = (key: string) => {
  const words = key.replace(/([A-Z])/g, " $1").toLowerCase();
  return words.charAt(0).toUpperCase() + words.slice(1);
};

export function detailFields(node: TreeNode): DetailField[] {
  const meta = node.meta ?? {};
  const fields: DetailField[] = [];
  for (const [key, raw] of Object.entries(meta)) {
    if (HIDDEN.has(key)) continue;
    const value = raw === "true" ? "Yes" : raw === "false" ? "No" : raw;
    if (key === "color") fields.push({ label: LABELS.color, value, swatch: raw });
    else if (key === "connectionKind") fields.push({ label: LABELS.connectionKind, value: kindBadge(raw).name });
    // "Server", "Account URI": what the connection dialog calls this kind's endpoint.
    else if (key === "endpoint") fields.push({ label: kindDescription(meta.connectionKind ?? "")?.endpointLabel ?? "Server", value });
    else fields.push({ label: LABELS[key] ?? sentence(key), value });
  }
  return fields;
}
