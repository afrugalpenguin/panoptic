// The connection detail pane's pure parts (docs/connection-pane.md): what App supplies, and the wording it shows.
import type { AuthKind, ConnectionConfig, EnvironmentConfig, KindDescription, ProbeResult, ServerState, TreeNode } from "./api";
import type { ServerDatabases } from "../sidecar-types.generated";
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
  /** The sidecar's cached session, About facts, databases and exceptions for this connection; refresh describes the
   * server again when a session has opened. Never opens one: showing the pane runs nothing on the server. */
  server: (refresh: boolean) => Promise<ServerState>;
  /** Changes when the sidecar says a describe for this connection finished (connection.serverUpdated). */
  serverRevision: number;
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

/** How long ago, for the Connected tile: "just now", "2 min ago", "3 h ago", "2 d ago". */
export function ago(ms: number): string {
  const minutes = Math.floor(Math.max(0, ms) / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  return hours < 24 ? `${hours} h ago` : `${Math.floor(hours / 24)} d ago`;
}

/** The Session tile's token note: "token 42 min left", "token 3 h left", or "token expired". */
export function tokenLeft(expiresAt: number, now: number): string {
  const minutes = Math.floor((expiresAt - now) / 60_000);
  if (minutes < 0) return "token expired";
  if (minutes < 60) return `token ${minutes} min left`;
  return `token ${Math.floor(minutes / 60)} h left`;
}

/** The About card's Databases row: "12 · 11 online", and a pill per state that is not online with how many. */
export function databaseSummary(databases: ServerDatabases): { text: string; pills: { state: string; count: number; error: boolean }[] } {
  const pills = new Map<string, { state: string; count: number; error: boolean }>();
  for (const d of databases.notOnline) {
    const found = pills.get(d.state);
    if (found) found.count++;
    else pills.set(d.state, { state: d.state, count: 1, error: !!d.error });
  }
  return { text: `${databases.total} · ${databases.online} online`, pills: [...pills.values()] };
}

/** The Needs attention strip's heading: "1 database needs attention", "3 databases need attention". */
export function attentionTitle(exceptions: { group: string }[]): string {
  const groups = new Set(exceptions.map((e) => e.group));
  const n = exceptions.length;
  const word = groups.size === 1 ? [...groups][0] : "item";
  return `${n} ${word}${n === 1 ? " needs" : "s need"} attention`;
}
