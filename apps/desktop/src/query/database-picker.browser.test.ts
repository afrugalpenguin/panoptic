// The tab's database picker shows the database the tab really runs in (issue #188). A tab opened on a connection has
// none of its own: it runs in the connection's default, and the picker must say so rather than show its first option.
import { mount, unmount } from "svelte";
import { afterEach, describe, expect, it, vi } from "vitest";
import "../app/app.css";
import type { SeekIndex } from "../app/seek";
import QueryView from "./QueryView.svelte";
import { QueryWorkspace } from "./store.svelte";
import type { QuerySummary } from "./types";

// Synthetic names only.
const onConnection = { nodeId: "env:dev/conn:c1", label: "pg-dev", connection: "pg-dev", envColor: "#2f9e44", readOnly: false, language: "pgsql" as const, capabilities: { databasePicker: true, unknownNameWarnings: true, ddlRefresh: true } };
const onDatabase = { ...onConnection, nodeId: "env:dev/conn:c1/db:orders", label: "orders" };
const seekIndex: SeekIndex = { environments: [], loose: [], usage: { recent: [] } } as unknown as SeekIndex;

let mounted: Record<string, unknown> | undefined;
afterEach(() => {
  if (mounted) unmount(mounted);
  mounted = undefined;
  document.body.innerHTML = "";
});

async function show(target: typeof onConnection) {
  const summary: QuerySummary = { queryId: "", resultSets: [], elapsedMs: 1, rolledBack: false, committed: false, cancelled: false };
  const api = {
    executeQuery: vi.fn(async (_: { database?: string }) => summary),
    cancelQuery: vi.fn(async () => true),
    databases: vi.fn(async () => ["inventory", "orders", "postgres"]),
  };
  const workspace = new QueryWorkspace(api);
  const tab = workspace.open(target, "select current_database()");
  const host = document.createElement("div");
  host.style.cssText = "width: 800px; height: 600px; display: flex; flex-direction: column;";
  document.body.append(host);
  mounted = mount(QueryView, { target: host, props: { tab, workspace, seekIndex, onConnect: () => {} } });
  const picker = await vi.waitFor(() => {
    const el = host.querySelector<HTMLSelectElement>("select.database");
    if (!el || el.options.length < 3) throw new Error("picker not filled yet");
    return el;
  });
  return { api, picker, workspace, tab };
}

const shown = (picker: HTMLSelectElement) => picker.options[picker.selectedIndex].textContent?.trim();

describe("database picker", () => {
  it("shows the connection default on a tab opened on a connection, not the first database", async () => {
    const { picker } = await show(onConnection);
    expect(shown(picker)).toBe("(connection default)");
    expect([...picker.options].map((o) => o.textContent?.trim())).toEqual(["(connection default)", "inventory", "orders", "postgres"]);
  });

  it("goes back to the connection default after a database was picked", async () => {
    const { picker, workspace, tab, api } = await show(onConnection);
    picker.value = "inventory";
    picker.dispatchEvent(new Event("change"));
    await vi.waitFor(() => expect(shown(picker)).toBe("inventory"));
    picker.value = "";
    picker.dispatchEvent(new Event("change"));
    await vi.waitFor(() => expect(shown(picker)).toBe("(connection default)"));
    await workspace.run(tab);
    expect(api.executeQuery.mock.calls[0][0].database).toBeUndefined();
  });

  it("shows the node's own database on a tab opened on a database, with no default entry", async () => {
    const { picker } = await show(onDatabase);
    expect(shown(picker)).toBe("orders");
    expect([...picker.options].map((o) => o.textContent?.trim())).toEqual(["inventory", "orders", "postgres"]);
  });
});
