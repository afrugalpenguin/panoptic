// An unconnected tab opens with focus in its connection picker, not the editor (#218): Shift+Tab in Monaco stays in
// Monaco, so a keyboard user who started in the editor could not reach the picker. Runs in headless Chromium (vitest
// browser project): it needs the real Monaco editor and where it puts focus once loaded.
import { mount, unmount } from "svelte";
import { afterEach, describe, expect, it, vi } from "vitest";
import "../app/app.css";
import type { SeekIndex } from "../app/seek";
import QueryView from "./QueryView.svelte";
import { QueryWorkspace } from "./store.svelte";
import type { QuerySummary } from "./types";

// Synthetic names only.
const target = {
  nodeId: "conn:c1/db:Orders", label: "Orders", connection: "sql-dev", envColor: "#2f9e44", readOnly: false, language: "sql" as const,
  capabilities: { databasePicker: true, unknownNameWarnings: true, ddlRefresh: true },
  scope: { connection: "conn:c1", database: "Orders", label: "Orders", connectionLabel: "sql-dev" },
};
const seekIndex: SeekIndex = { envs: [], usage: { envs: {}, recent: [] } };

let mounted: Record<string, unknown> | undefined;
afterEach(() => {
  if (mounted) unmount(mounted);
  mounted = undefined;
  document.body.innerHTML = "";
});

async function show(connected: boolean) {
  const summary: QuerySummary = { queryId: "", resultSets: [], elapsedMs: 1, rolledBack: false, committed: false, cancelled: false };
  const workspace = new QueryWorkspace({ executeQuery: async () => summary, cancelQuery: async () => true });
  const tab = connected ? workspace.open(target, "") : workspace.openUnconnected();
  const host = document.createElement("div");
  host.style.cssText = "width: 800px; height: 600px; display: flex; flex-direction: column;";
  document.body.append(host);
  mounted = mount(QueryView, { target: host, props: { tab, workspace, seekIndex, onConnect: () => {} } });
  await vi.waitFor(() => expect(host.querySelector(".monaco-editor textarea")).not.toBeNull(), { timeout: 15_000 });
  return host;
}

describe("query tab focus", () => {
  it("an unconnected tab keeps focus in the connection picker once the editor has loaded", async () => {
    const host = await show(false);
    // Monaco focuses itself after load; give it the chance.
    await new Promise((r) => setTimeout(r, 100));
    expect(document.activeElement).toBe(host.querySelector('.picker input[aria-label="Choose a connection for this tab"]'));
  });

  it("a connected tab still opens with focus in the editor", async () => {
    const host = await show(true);
    await vi.waitFor(() => expect(host.querySelector(".monaco-editor")!.contains(document.activeElement)).toBe(true));
  });
});
