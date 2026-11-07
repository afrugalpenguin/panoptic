// A result set cut at the row limit says so on its tab (issue #186); the Messages pane carries the sidecar's
// explanation. Headless Chromium: QueryView needs the real Monaco editor.
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
const seekIndex: SeekIndex = { environments: [], loose: [], usage: { recent: [] } } as unknown as SeekIndex;

let mounted: Record<string, unknown> | undefined;
afterEach(() => {
  if (mounted) unmount(mounted);
  mounted = undefined;
  document.body.innerHTML = "";
});

async function run(resultSets: QuerySummary["resultSets"]) {
  const workspace = new QueryWorkspace({
    executeQuery: vi.fn(async (request: { queryId: string }) => {
      resultSets.forEach((s, index) =>
        workspace.handle("query.rows", { queryId: request.queryId, index, columns: [{ name: "n", type: "int" }], rows: Array.from({ length: s.rowCount }, (_, i) => [i]) }),
      );
      return { queryId: request.queryId, resultSets, elapsedMs: 1, rolledBack: false, committed: false, cancelled: false };
    }),
    cancelQuery: vi.fn(async () => true),
  });
  const tab = workspace.open(target, "select n from t; select 1");
  const host = document.createElement("div");
  host.style.cssText = "width: 800px; height: 600px; display: flex; flex-direction: column;";
  document.body.append(host);
  mounted = mount(QueryView, { target: host, props: { tab, workspace, seekIndex, onConnect: () => {} } });
  await workspace.run(tab);
  return host;
}

const labels = (host: HTMLElement) =>
  vi.waitFor(() => {
    const found = [...host.querySelectorAll(".muted")].map((e) => e.textContent?.replace(/\s+/g, " ").trim() ?? "").filter((t) => t.includes("row"));
    if (found.length < 2) throw new Error("result tabs not drawn yet");
    return found;
  });

describe("row limit", () => {
  it("marks a result set cut at the row limit, and only that one", async () => {
    const host = await run([
      { rowCount: 1000, truncated: true },
      { rowCount: 1, truncated: false },
    ]);
    expect(await labels(host)).toEqual(["(1,000 rows, row limit reached)", "(1 row)"]);
  });
});
