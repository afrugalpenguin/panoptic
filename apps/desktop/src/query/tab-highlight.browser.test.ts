// The active workspace tab stands out from the others (issue #271). Runs in headless Chromium (vitest browser project):
// it reads computed styles.
import { mount, unmount } from "svelte";
import { afterEach, describe, expect, it } from "vitest";
import "../app/app.css";
import type { SeekIndex } from "../app/seek";
import { QueryWorkspace } from "./store.svelte";
import Workspace from "./Workspace.svelte";

// Synthetic names only.
const target = {
  nodeId: "conn:c1/db:Orders", label: "Orders", connection: "sql-dev", envColor: "#2f9e44", readOnly: false, language: "sql" as const,
  capabilities: { databasePicker: true, unknownNameWarnings: true, ddlRefresh: true },
  scope: { connection: "conn:c1", database: "Orders", label: "Orders", connectionLabel: "sql-dev" },
};
const seekIndex = {} as SeekIndex;

let mounted: Record<string, unknown> | undefined;
afterEach(() => {
  if (mounted) unmount(mounted);
  mounted = undefined;
  document.body.innerHTML = "";
});

function show() {
  const workspace = new QueryWorkspace({ executeQuery: async () => ({}) as never, cancelQuery: async () => true });
  workspace.open(target, "SELECT 1");
  workspace.open(target, "SELECT 2");
  const host = document.createElement("div");
  host.style.cssText = "width: 800px; height: 400px;";
  document.body.append(host);
  mounted = mount(Workspace, { target: host, props: { workspace, seekIndex, onConnect: () => {}, onLinkError: () => {} } });
  const [inactive, active] = [...host.querySelectorAll<HTMLElement>('[role="tab"]')];
  return { active, inactive };
}

/** The accent colour as the browser resolves it, to compare with computed styles. */
function accent(): string {
  const probe = document.createElement("span");
  probe.style.color = "var(--accent)";
  document.body.append(probe);
  const color = getComputedStyle(probe).color;
  probe.remove();
  return color;
}

describe("workspace tabs", () => {
  it("mark the active tab with an accent underline the others lack", () => {
    const { active, inactive } = show();
    expect(active.getAttribute("aria-selected")).toBe("true");
    expect(getComputedStyle(active).boxShadow).toContain(accent());
    expect(getComputedStyle(inactive).boxShadow).not.toContain(accent());
  });

  it("dim the inactive tabs' titles and keep every tab's environment band", () => {
    const { active, inactive } = show();
    expect(getComputedStyle(inactive).color).not.toBe(getComputedStyle(active).color);
    for (const tab of [active, inactive]) expect(getComputedStyle(tab).boxShadow).toContain("rgb(47, 158, 68)");
  });
});
