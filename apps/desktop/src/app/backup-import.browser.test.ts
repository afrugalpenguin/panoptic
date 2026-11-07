// Importing a connections backup (#28): a preview of what the file holds, with what cannot be imported disabled and
// explained, and only the chosen connections sent.
import { flushSync, mount, unmount } from "svelte";
import { afterEach, describe, expect, it, vi } from "vitest";
import "./app.css";
import type { Api } from "./api";
import BackupImportDialog from "./BackupImportDialog.svelte";
import type { BackupPreview } from "../sidecar-types.generated";

// Synthetic names only.
const preview: BackupPreview = {
  environments: [
    { name: "Prod", color: "#e03131", readOnly: true, exists: true },
    { name: "Sandbox", color: "#0c8599", readOnly: false, exists: false },
  ],
  connections: [
    { index: 0, name: "Orders", kind: "sql", endpoint: "orders.example.test", auth: "sql", user: "reader", environment: "Prod", skip: 'Already added as "Orders".' },
    { index: 1, name: "Billing", kind: "sql", endpoint: "billing.example.test", auth: "sql", user: "reader", environment: "Prod" },
    { index: 2, name: "Reports", kind: "postgres", endpoint: "reports.example.test", auth: "entra", environment: null },
  ],
};

let mounted: Record<string, unknown> | undefined;
afterEach(() => {
  if (mounted) unmount(mounted);
  mounted = undefined;
  document.body.innerHTML = "";
});

function open() {
  const importBackup = vi.fn(async (_path: string, connections: number[]) => ({ environmentsCreated: 1, connectionsAdded: connections.length, skipped: 0 }));
  const onImported = vi.fn();
  const target = document.createElement("div");
  document.body.append(target);
  mounted = mount(BackupImportDialog, {
    target,
    props: { api: { importBackup } as unknown as Api, path: "C:\\backups\\panoptic.json", preview, onImported, onClose: () => {} },
  });
  flushSync();
  return { importBackup, onImported };
}

const boxes = () => [...document.querySelectorAll<HTMLInputElement>("input[type=checkbox]")];
const importButton = () => [...document.querySelectorAll("button")].find((b) => b.textContent?.startsWith("Import"))!;

describe("Backup import dialog", () => {
  it("shows which environments are new and which already exist", () => {
    open();
    const text = document.body.textContent ?? "";
    expect(text).toContain("Sandbox");
    expect(text).toMatch(/Prod.*already here/);
  });

  it("disables what cannot be imported, says why, and selects the rest", () => {
    open();
    const [orders, billing, reports] = boxes();
    expect(orders.disabled).toBe(true);
    expect(orders.checked).toBe(false);
    expect(document.body.textContent).toContain('Already added as "Orders".');
    expect([billing.checked, reports.checked]).toEqual([true, true]);
    expect(importButton().textContent).toBe("Import 2");
  });

  it("imports only the chosen connections", async () => {
    const { importBackup, onImported } = open();
    boxes()[2].click();
    flushSync();
    importButton().click();
    await vi.waitFor(() => expect(onImported).toHaveBeenCalled());
    expect(importBackup).toHaveBeenCalledWith("C:\\backups\\panoptic.json", [1]);
    expect(onImported).toHaveBeenCalledWith({ environmentsCreated: 1, connectionsAdded: 1, skipped: 0 });
  });
});
