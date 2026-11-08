// Typing never copies the whole script out of Monaco; the text is read when something needs it (issue #201). Runs in
// headless Chromium (vitest browser project): it needs the real Monaco editor.
import { mount, unmount } from "svelte";
import { afterEach, describe, expect, it, vi } from "vitest";
import "../app/app.css";
import type { SeekIndex } from "../app/seek";
import { monaco } from "./monaco";
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
  const [editor] = monaco.editor.getEditors();
  return { api, workspace, tab, editor, model: editor.getModel()! };
}

describe("Query editor text", () => {
  it("does not read the whole text on a keystroke, and a run still sends what was typed", async () => {
    const { api, workspace, tab, editor, model } = await show("SELECT 1");
    editor.setPosition({ lineNumber: 1, column: 9 });
    const getValue = vi.spyOn(model, "getValue");

    // No trigger characters (space, dot, @): completions read the text by design.
    for (const ch of "00;") editor.trigger("keyboard", "type", { text: ch });
    expect(getValue).not.toHaveBeenCalled();

    expect(tab.text).toBe("SELECT 100;");
    await workspace.run(tab);
    expect(api.executeQuery.mock.calls[0][0].text).toBe("SELECT 100;");
  });

  it("shows text set on the tab from outside", async () => {
    const { tab, model } = await show("SELECT 1");
    tab.text = "SELECT 2";
    expect(model.getValue()).toBe("SELECT 2");
  });
});
