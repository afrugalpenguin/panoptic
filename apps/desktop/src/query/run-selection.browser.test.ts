// The Run button runs the editor's selection, like F5 and Ctrl+Enter (issue #273). Runs in headless Chromium (vitest
// browser project): it needs the real Monaco editor and its selection.
import { mount, unmount } from "svelte";
import { afterEach, describe, expect, it, vi } from "vitest";
import "../app/app.css";
import type { SeekIndex } from "../app/seek";
import { monaco } from "./monaco";
import QueryView from "./QueryView.svelte";
import { QueryWorkspace } from "./store.svelte";
import type { QuerySummary } from "./types";

// Synthetic names only.
const target = { nodeId: "env:dev/conn:c1/db:Orders", label: "Orders", connection: "sql-dev", envColor: "#2f9e44", readOnly: false, language: "sql" as const, capabilities: { databasePicker: true, unknownNameWarnings: true, ddlRefresh: true } };
const seekIndex: SeekIndex = { environments: [], loose: [], usage: { recent: [] } } as unknown as SeekIndex;

let mounted: Record<string, unknown> | undefined;
afterEach(() => {
  if (mounted) unmount(mounted);
  mounted = undefined;
  document.body.innerHTML = "";
});

async function show(text: string) {
  const summary: QuerySummary = { queryId: "", resultSets: [], elapsedMs: 1, rolledBack: false, committed: false, cancelled: false };
  const api = { executeQuery: vi.fn(async (_: { text: string }) => summary), cancelQuery: vi.fn(async () => true) };
  const workspace = new QueryWorkspace(api);
  const tab = workspace.open(target, text);
  const host = document.createElement("div");
  host.style.cssText = "width: 800px; height: 600px; display: flex; flex-direction: column;";
  document.body.append(host);
  mounted = mount(QueryView, { target: host, props: { tab, workspace, seekIndex, onConnect: () => {} } });
  await vi.waitFor(() => expect(host.querySelector(".monaco-editor textarea")).not.toBeNull(), { timeout: 15_000 });
  const run = [...host.querySelectorAll("button")].find((b) => b.textContent?.trim() === "Run")!;
  return { api, run };
}

describe("Run button", () => {
  it("runs only the selected text when there is a selection", async () => {
    const { api, run } = await show("SELECT 1 AS a;\nSELECT 2 AS b;");
    const [editor] = monaco.editor.getEditors();
    editor.setSelection(new monaco.Selection(2, 1, 2, 15));
    run.click();
    await vi.waitFor(() => expect(api.executeQuery).toHaveBeenCalledTimes(1));
    expect(api.executeQuery.mock.calls[0][0].text).toBe("SELECT 2 AS b;");
  });

  it("runs the whole script when nothing is selected", async () => {
    const { api, run } = await show("SELECT 1 AS a;\nSELECT 2 AS b;");
    run.click();
    await vi.waitFor(() => expect(api.executeQuery).toHaveBeenCalledTimes(1));
    expect(api.executeQuery.mock.calls[0][0].text).toBe("SELECT 1 AS a;\nSELECT 2 AS b;");
  });
});
