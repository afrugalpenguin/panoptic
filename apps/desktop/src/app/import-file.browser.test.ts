// The import dialog's fallbacks when a tool's files move (#25): an exported .regsrvr chosen by hand, and a values-free
// diagnostics report to attach to an issue.
import { flushSync, mount, unmount } from "svelte";
import { afterEach, describe, expect, it, vi } from "vitest";
import "./app.css";
import type { Api, AppConfig, ImportSource } from "./api";
import ImportDialog from "./ImportDialog.svelte";

const config: AppConfig = { environments: [], connections: [] };
// Synthetic names only.
const exported: ImportSource = {
  source: "ssms-registered",
  label: "Chosen file (team.regsrvr)",
  path: "C:\\Users\\me\\Downloads\\team.regsrvr",
  groups: [{ name: "UAT", connections: [{ name: "app-uat", kind: "sql", endpoint: "app-uat.example.test", auth: "sql", user: "reader", trustServerCertificate: false, alreadyAdded: false }] }],
};

let mounted: Record<string, unknown> | undefined;
afterEach(() => {
  if (mounted) unmount(mounted);
  mounted = undefined;
  document.body.innerHTML = "";
});

function open() {
  const api = {
    scanImports: vi.fn(async () => [] as ImportSource[]),
    scanImportFile: vi.fn(async (_path: string) => exported),
    importDiagnostics: vi.fn(async () => "Panoptic import diagnostics. Structure only: no values."),
  };
  const pickFile = vi.fn(async () => exported.path);
  const target = document.createElement("div");
  document.body.append(target);
  mounted = mount(ImportDialog, { target, props: { api: api as unknown as Api, config, pickFile, onImported: () => {}, onClose: () => {} } });
  flushSync();
  return { api, pickFile };
}

const button = (text: string) => [...document.querySelectorAll("button")].find((b) => b.textContent?.trim() === text);

describe("import from a chosen file", () => {
  it("adds the chosen file's connections to the list", async () => {
    const { api } = open();
    await vi.waitFor(() => expect(button("Choose a file...")).toBeDefined());

    button("Choose a file...")!.click();

    await vi.waitFor(() => expect(document.body.textContent).toContain("app-uat"));
    expect(api.scanImportFile).toHaveBeenCalledWith(exported.path);
    expect(document.body.textContent).toContain("Chosen file (team.regsrvr)");
  });

  it("copies the diagnostics report to the clipboard", async () => {
    const writeText = vi.spyOn(navigator.clipboard, "writeText").mockResolvedValue();
    const { api } = open();
    await vi.waitFor(() => expect(button("Copy diagnostics")).toBeDefined());

    button("Copy diagnostics")!.click();

    await vi.waitFor(() => expect(writeText).toHaveBeenCalledWith("Panoptic import diagnostics. Structure only: no values."));
    expect(api.importDiagnostics).toHaveBeenCalled();
    await vi.waitFor(() => expect(document.body.textContent).toContain("Copied"));
  });
});
