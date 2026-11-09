// The connection detail pane's pure parts (docs/connection-pane.md): what App supplies, and the wording it shows.
import type { AuthKind, ConnectionConfig, EnvironmentConfig, KindDescription, ProbeResult, TreeNode } from "./api";
import type { KindBadge } from "./kinds";
import type { LabelSegments } from "./labels";

/** What the connection detail pane reads and runs; App supplies it for the selected connection. */
export interface ConnectionPaneProps {
  connection: ConnectionConfig;
  /** Its environment; undefined for a loose connection (in no environment). */
  env?: EnvironmentConfig;
  /** The host as the tree splits it: dim prefix, bright core, dim suffix. */
  label: LabelSegments;
  badge: KindBadge;
  /** Its kind as the sidecar describes it (backends.describe): auth labels and which fields it has. */
  kind?: KindDescription;
  /** 1-based place among its environment's connections (or the loose ones), and how many there are. */
  position: number;
  total: number;
  /** Every environment, in the tree's order, for the Environment menu. */
  environments: EnvironmentConfig[];
  /** The connection's children as the tree has them loaded, or undefined before they are listed; the pane times the call. */
  children: () => TreeNode[] | undefined;
  /** Copy name and New query are offered only when the node carries them. */
  copyText?: string;
  canQuery: boolean;
  /** Probes this connection for reachability (the environment pane's probe); fresh skips the sidecar's 60 s cache. */
  probe: (fresh: boolean) => Promise<ProbeResult[]>;
  /** Writes the changed connection where it is (config.saveConnection); secret undefined keeps the stored one while the
   * sidecar's binding rule allows, "" clears it. Rejects when the write fails. */
  onSave: (next: ConnectionConfig, secret?: string) => Promise<void>;
  /** Moves it to an environment, or none (null), asking first when it leaves a read-only one. Resolves false when the
   * user declined; rejects when the write fails. */
  onMoveTo: (environmentId: string | null) => Promise<boolean>;
  /** Move up (-1) or down (1) among its siblings, as the tree's Move up and Move down. */
  onMove: (by: -1 | 1) => void;
  onNewQuery: () => void;
  onCopyName: () => void;
  /** Lists its children again, as the tree's Refresh. */
  onRefresh: () => void;
  /** Asks, removes and offers Undo, as the tree's Remove connection. */
  onRemove: () => void;
}

/** The header's tag: "Connection · 2 of 8 in Prod", or "Loose connection". */
export function placeText(env: EnvironmentConfig | undefined, position: number, total: number): string {
  return env ? `Connection · ${position} of ${total} in ${env.name}` : "Loose connection";
}

/** The effective write policy and where it comes from (ADR 0016: policy is set on the environment). */
export function writePolicy(env: EnvironmentConfig | undefined): { readOnly: boolean; value: string; tag: string; summary: string } {
  if (!env) return { readOnly: false, value: "Allowed", tag: "no environment", summary: "writes allowed, no environment" };
  return env.readOnly
    ? { readOnly: true, value: "Read-only", tag: "inherited", summary: `writes read-only from ${env.name}` }
    : { readOnly: false, value: "Allowed", tag: "inherited", summary: `writes allowed from ${env.name}` };
}

/** The sign-in's name as the sidecar labels it ("Microsoft Entra ID", "SQL login"); the id if the kind is unknown. */
export function authLabel(kind: KindDescription | undefined, auth: AuthKind): string {
  return kind?.auths.find((a) => a.id === auth)?.label ?? auth;
}

/**
 * Where the sign-in's secret is kept: passwords and account keys (and a client key's passphrase, when one was given)
 * are in Panoptic's DPAPI-encrypted store (ADR 0008); Entra, Windows and AWS IAM keep none.
 */
export function secretPlace(auth: AuthKind): { value: string; title: string } {
  const where = "Encrypted with Windows DPAPI for your account, in Panoptic's store; never sent to the explorer.";
  if (auth === "sql" || auth === "password") return { value: "Encrypted store", title: `The password. ${where}` };
  if (auth === "key") return { value: "Encrypted store", title: `The account key. ${where}` };
  if (auth === "certificate") return { value: "Encrypted store", title: `The key's passphrase, if you gave one. ${where}` };
  return { value: "none", title: "This sign-in stores no secret." };
}

/** The database nodes among a connection's children, in the tree's order. */
export const databases = (children: TreeNode[] | undefined) => children?.filter((n) => n.kind === "database") ?? [];

/**
 * Notes left after a save, by connection id. A save reloads the tree, which can remount the pane, so a note outlives
 * the component that set it, until the next edit there.
 */
export const paneNotices = new Map<string, string>();
