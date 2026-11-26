// Export all (#376): every result set of a tab to base1, base2, ... in one go, CSV or JSON alike, never over a file
// that exists (the shell picks free names). Headless Chromium: QueryView needs the real Monaco editor.
import { mount, unmount } from "svelte";
import { afterEach, describe, expect, it, vi } from "vitest";
import "../app/app.css";
import type { SeekIndex } from "../app/seek";
import QueryView from "./QueryView.svelte";
import { QueryWorkspace } from "./store.svelte";
import type { QuerySummary } from "./types";

const dialog = vi.hoisted(() => ({ picked: null as string | null, options: undefined as unknown }));
const written = vi.hoisted(() => [] as { path: string; text: string }[]);
const invoked = vi.hoisted(() => [] as { cmd: string; args: Record<string, unknown> }[]);

vi.mock("@tauri-apps/plugin-dialog", () => ({
  save: async (options: unknown) => ((dialog.options = options), dialog.picked),
}));
vi.mock("@tauri-apps/plugin-fs", () => ({
  writeTextFile: async (path: string, text: string) => void written.push({ path, text }),
}));
vi.mock("@tauri-apps/api/core", () => ({
  // The shell's free_export_paths: here results1 is taken, so numbering skips it.
  invoke: async (cmd: string, args: Record<string, unknown>) => {
    invoked.push({ cmd, args });
    if (cmd !== "free_export_paths") return null;
    const dir = (args.dir as string | null) ?? "D:/downloads";
    const taken = new Set([`${dir}/results1.${args.ext}`]);
    const out: string[] = [];
    for (let n = 1; out.length < (args.count as number); n++) {
      const p = `${dir}/${args.base}${n}.${args.ext}`;
      if (!taken.has(p)) out.push(p);
    }
    return out;
  },
}));

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
  written.length = 0;
  invoked.length = 0;
  localStorage.removeItem("panoptic.exportDir");
});

async function run(resultSets: QuerySummary["resultSets"]) {
  const workspace = new QueryWorkspace({
    executeQuery: vi.fn(async (request: { queryId: string }) => {
      resultSets.forEach((s, index) =>
        workspace.handle("query.rows", { queryId: request.queryId, index, columns: [{ name: "n", type: "int" }], rows: Array.from({ length: s.rowCount }, (_, i) => [index * 10 + i]) }),
      );
      return { queryId: request.queryId, resultSets, elapsedMs: 1, rolledBack: false, committed: false, cancelled: false };
    }),
    cancelQuery: vi.fn(async () => true),
  });
  const tab = workspace.open(target, "select 1; select 2");
  const host = document.createElement("div");
  host.style.cssText = "width: 800px; height: 600px; display: flex; flex-direction: column;";
  document.body.append(host);
  mounted = mount(QueryView, { target: host, props: { tab, workspace, seekIndex, onConnect: () => {} } });
  await workspace.run(tab);
  return host;
}

const button = (host: HTMLElement, text: string) => [...host.querySelectorAll("button")].find((b) => b.textContent?.trim() === text);
const two = [
  { rowCount: 2, truncated: false },
  { rowCount: 1, truncated: false },
];

describe("Export all", () => {
  it("is offered only when the tab has more than one result set", async () => {
    const host = await run([{ rowCount: 2, truncated: false }]);
    await vi.waitFor(() => expect(button(host, "Export CSV")).toBeDefined());
    expect(button(host, "Export all...")).toBeUndefined();
  });

  it("writes every result set as CSV to free numbered names in the chosen folder", async () => {
    const host = await run(two);
    await vi.waitFor(() => expect(button(host, "Export all...")).toBeDefined());
    dialog.picked = "E:/out/results2.csv";
    button(host, "Export all...")!.click();
    await vi.waitFor(() => expect(written).toHaveLength(2));
    expect(written).toEqual([
      { path: "E:/out/results2.csv", text: "n\r\n0\r\n1\r\n" },
      { path: "E:/out/results3.csv", text: "n\r\n10\r\n" },
    ]);
    expect(invoked.at(-1)).toEqual({ cmd: "free_export_paths", args: { dir: "E:/out", base: "results", ext: "csv", count: 2 } });
  });

  it("does the same for JSON, from the chosen name's base", async () => {
    const host = await run(two);
    await vi.waitFor(() => expect(button(host, "Export all...")).toBeDefined());
    dialog.picked = "E:/out/orders.json";
    button(host, "Export all...")!.click();
    await vi.waitFor(() => expect(written).toHaveLength(2));
    expect(written.map((w) => w.path)).toEqual(["E:/out/orders1.json", "E:/out/orders2.json"]);
    expect(JSON.parse(written[1].text)).toEqual([{ n: 10 }]);
  });

  it("suggests the first free numbered name and writes nothing when the dialog is cancelled", async () => {
    const host = await run(two);
    await vi.waitFor(() => expect(button(host, "Export all...")).toBeDefined());
    dialog.picked = null;
    button(host, "Export all...")!.click();
    await vi.waitFor(() => expect(dialog.options).toMatchObject({ defaultPath: "D:/downloads/results2.csv" }));
    expect(written).toEqual([]);
  });
});
