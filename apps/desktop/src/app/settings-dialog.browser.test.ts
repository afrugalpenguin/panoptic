// The Settings dialog layout (#360): four labelled sections, a fixed label column, one control width, and the
// update status on one line with its links. Measured in Chromium because the claims are about layout.
import { flushSync, mount, unmount } from "svelte";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { page } from "vitest/browser";
import "./app.css";
import type { UpdateState } from "../updates";
import type { AppSettings } from "./api";
import SettingsDialog from "./SettingsDialog.svelte";

const settings = {
  updateCheck: "startup",
  explorer: { showKindBadge: true, rowFont: "mono" },
  editor: { intellisense: true, keywordCase: null, autoRefreshOnDdl: true, warnUnknownNames: true, catalogSampleDocs: 100, maxRows: 100000 },
} as AppSettings;

// A desktop window: the default test viewport is phone-sized, which narrows the dialog below its 760px.
beforeAll(() => page.viewport(1280, 800));

let mounted: Record<string, unknown> | undefined;
afterEach(() => {
  if (mounted) unmount(mounted);
  mounted = undefined;
  document.body.innerHTML = "";
});

function show(update: UpdateState | undefined, over: Record<string, unknown> = {}) {
  if (mounted) unmount(mounted);
  document.body.innerHTML = "";
  const props = {
    settings,
    update,
    onSave: vi.fn(async () => {}),
    onCheckNow: vi.fn(),
    hasChangelog: true,
    onWhatsNew: vi.fn(),
    onExportConnections: vi.fn(async () => undefined),
    onImportConnections: vi.fn(async () => {}),
    onClose: vi.fn(),
    ...over,
  };
  mounted = mount(SettingsDialog, { target: document.body, props });
  flushSync();
  return { props, dialog: document.querySelector("dialog")! };
}

const checkedAt = new Date(2026, 10, 9, 18, 28).getTime();
const upToDate: UpdateState = { kind: "upToDate", current: "0.2.157", checkedAt };
const rect = (el: Element) => el.getBoundingClientRect();
const text = (el: Element | null) => el!.textContent!.replace(/\s+/g, " ").trim();

describe("Settings dialog layout", () => {
  it("has four sections in order, with a divider above all but the first", () => {
    const { dialog } = show(upToDate);
    const sections = [...dialog.querySelectorAll("section")];
    expect(sections.map((s) => text(s.querySelector("h3")))).toEqual(["General", "Explorer", "Editor", "Results"]);
    expect(sections.map((s) => getComputedStyle(s).borderTopStyle)).toEqual(["none", "solid", "solid", "solid"]);
  });

  it("gives every row a left label, in one column, in the spec's order", () => {
    const { dialog } = show(upToDate);
    const rows = [...dialog.querySelectorAll(".row")];
    expect(rows.map((r) => text(r.querySelector(":scope > .label")))).toEqual([
      "Updates", "Check for updates", "Connections",
      "Engine badges", "Row font",
      "IntelliSense", "Refresh after DDL", "Unknown names", "Keyword case",
      "Row limit", "Cosmos sample size",
    ]);
    const lefts = new Set(rows.map((r) => Math.round(rect(r.querySelector(":scope > .label")!).left)));
    expect(lefts.size).toBe(1);
    const controlLefts = new Set(rows.map((r) => Math.round(rect(r.querySelector(":scope > .control")!).left)));
    expect(controlLefts.size).toBe(1);
    expect([...controlLefts][0] - [...lefts][0]).toBeGreaterThanOrEqual(150);
  });

  it("gives every select and text input the same 240px width, with checkboxes on their left edge", () => {
    const { dialog } = show(upToDate);
    const fields = [...dialog.querySelectorAll<HTMLElement>("select, input:not([type=checkbox])")];
    expect(fields.length).toBe(5);
    expect(new Set(fields.map((f) => Math.round(rect(f).width)))).toEqual(new Set([240]));
    const left = Math.round(rect(fields[0]).left);
    expect(new Set(fields.map((f) => Math.round(rect(f).left)))).toEqual(new Set([left]));
    const boxes = [...dialog.querySelectorAll<HTMLInputElement>("input[type=checkbox]")];
    expect(boxes.length).toBe(4);
    for (const b of boxes) expect(Math.abs(rect(b).left - left)).toBeLessThanOrEqual(1);
  });

  it("uses the shorter checkbox descriptions", () => {
    const { dialog } = show(upToDate);
    expect([...dialog.querySelectorAll(".check")].map(text)).toEqual([
      "Show S, C, Sy badges on connections",
      "Complete names and show details on hover",
      "Refresh IntelliSense after CREATE, ALTER or DROP",
      "Warn before running",
    ]);
  });

  it("shows the update status and its links on one line", () => {
    const { dialog } = show(upToDate);
    const row = dialog.querySelector(".row.updates")!;
    const status = row.querySelector(".status")!;
    // The time is in the user's locale: 18:28 in en-GB, 06:28 PM in en-US (headless Chromium's, and the longer one).
    const at = new Date(checkedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
    expect(text(status)).toBe(`v0.2.157, up to date · checked ${at}`);
    const links = [...row.querySelectorAll("button.link")];
    expect(links.map(text)).toEqual(["Check now", "What's new"]);
    // One line: the status and both links share a top, and the links end at the control column's right edge.
    expect(new Set([status, ...links].map((e) => Math.round(rect(e).top))).size).toBe(1);
    expect(Math.round(rect(links[1]).right)).toBe(Math.round(rect(row.querySelector(".control")!).right));
    // The dialog is the wide size so the status fits beside its links: nothing ends in an ellipsis (#360).
    expect(Math.round(rect(dialog).width)).toBe(760);
    expect(status.scrollWidth).toBeLessThanOrEqual(status.clientWidth);
  });

  it("says Checking... while a check runs, and keeps the error text", () => {
    const { dialog, props } = show(upToDate);
    dialog.querySelector<HTMLButtonElement>(".updates button.link")!.click();
    expect(props.onCheckNow).toHaveBeenCalledOnce();
    show({ kind: "checking", current: "0.2.157" });
    expect(text(document.querySelector(".updates .status"))).toBe("Checking...");
    show({ kind: "error", current: "0.2.157", message: "offline" });
    expect(text(document.querySelector(".updates .status"))).toBe("Check failed: offline");
  });

  it("offers Connections export and import as links", () => {
    const { dialog, props } = show(upToDate);
    const links = [...dialog.querySelectorAll<HTMLButtonElement>(".row.connections button.link")];
    expect(links.map(text)).toEqual(["Export to a file", "Import from a backup"]);
    links[0].click();
    links[1].click();
    expect(props.onExportConnections).toHaveBeenCalledOnce();
    expect(props.onImportConnections).toHaveBeenCalledOnce();
  });

  it("keeps helper text only on Connections, Row limit and Cosmos sample size", () => {
    const { dialog } = show(upToDate);
    const helped = [...dialog.querySelectorAll(".help")].map((h) => text(h.closest(".row")!.querySelector(".label")));
    expect(helped).toEqual(["Connections", "Row limit", "Cosmos sample size"]);
    expect(dialog.textContent).not.toContain("Checks GitHub Releases once each time");
    for (const h of dialog.querySelectorAll(".help")) expect(getComputedStyle(h).fontSize).toBe("12px");
  });

  it("has Save as its only filled button", () => {
    const { dialog } = show(upToDate);
    expect([...dialog.querySelectorAll("button.primary")].map(text)).toEqual(["Save"]);
  });

  it("shows no em or en dashes", () => {
    const { dialog } = show(upToDate);
    const dashes = new RegExp(`[${String.fromCharCode(0x2013, 0x2014)}]`);
    expect(dialog.textContent).not.toMatch(dashes);
  });
});
