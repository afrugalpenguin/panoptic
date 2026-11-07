// A running query is obvious at a glance (issue #274). Runs in headless Chromium (vitest browser project): it mounts the
// query view and reads computed styles.
import { flushSync, mount, unmount } from "svelte";
import { afterEach, describe, expect, it, vi } from "vitest";
import "../app/app.css";
import type { SeekIndex } from "../app/seek";
import QueryView from "./QueryView.svelte";
import { QueryWorkspace } from "./store.svelte";
import type { QuerySummary } from "./types";

// Synthetic names only.
const target = { nodeId: "env:dev/conn:c1/db:Orders", label: "Orders", connection: "sql-dev", envColor: "#2f9e44", readOnly: false, language: "sql" as const, capabilities: { databasePicker: true, unknownNameWarnings: true, ddlRefresh: true } };

let mounted: Record<string, unknown> | undefined;
afterEach(() => {
  if (mounted) unmount(mounted);
  mounted = undefined;
  document.body.innerHTML = "";
});

function show() {
  let finish!: () => void;
  const summary: QuerySummary = { queryId: "", resultSets: [], elapsedMs: 30_000, rolledBack: false, committed: false, cancelled: false };
  const api = { executeQuery: vi.fn(() => new Promise<QuerySummary>((r) => (finish = () => r(summary)))), cancelQuery: vi.fn(async () => true) };
  const workspace = new QueryWorkspace(api);
  const tab = workspace.open(target, "WAITFOR DELAY '00:00:30';");
  const host = document.createElement("div");
  host.style.cssText = "width: 800px; height: 600px; display: flex; flex-direction: column;";
  document.body.append(host);
  mounted = mount(QueryView, { target: host, props: { tab, workspace, seekIndex: {} as SeekIndex, onConnect: () => {} } });
  return { host, workspace, tab, finish: () => finish() };
}

const muted = () => {
  const probe = document.createElement("span");
  probe.style.color = "var(--text-muted)";
  document.body.append(probe);
  const color = getComputedStyle(probe).color;
  probe.remove();
  return color;
};

describe("while a query runs", () => {
  it("shows a progress bar over the results and an elapsed timer beside Cancel, not in muted text", async () => {
    const { host, workspace, tab, finish } = show();
    const done = workspace.run(tab);
    flushSync();

    expect(host.querySelector('.results [role="progressbar"]')).not.toBeNull();
    const cancel = [...host.querySelectorAll("button")].find((b) => b.textContent?.trim() === "Cancel")!;
    const timer = cancel.nextElementSibling as HTMLElement;
    expect(timer.getAttribute("role")).toBe("status");
    expect(timer.textContent).toMatch(/Running\.\.\. \d+\.\d s/);
    expect(getComputedStyle(timer).color).not.toBe(muted());
    expect(host.querySelector(".result-body")!.textContent).toMatch(/Running\.\.\. \d+\.\d s/);

    finish();
    await done;
    flushSync();
    expect(host.querySelector('[role="progressbar"]')).toBeNull();
    expect(host.querySelector('[role="status"]')).toBeNull();
  });
});
