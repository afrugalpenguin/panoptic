// The environment detail pane, phase 1 (docs/environment-pane.md): properties edit in place and save on change.
import { flushSync, mount, unmount } from "svelte";
import { afterEach, describe, expect, it, vi } from "vitest";
import "./app.css";
import type { EnvironmentConfig, ProbeResult } from "./api";
import type { EnvironmentPaneProps } from "./env-pane";
import EnvironmentPane from "./EnvironmentPane.svelte";
import type { EnvConnection } from "./tree-model";

// Synthetic names only (the spec's fictional Fabrikam estate).
const uat: EnvironmentConfig = { id: "uat", name: "UAT", color: "#f08c00", readOnly: false, connections: [] };
const conn = (id: string, kind: string, letters: string, name: string): EnvConnection => ({
  id: `conn:${id}`,
  connectionId: id,
  kind,
  badge: { letters, color: "#2d5aa0", name },
  label: { prefix: "fabrikam-", core: id, suffix: ".example.test" },
});
const list = [conn("uat-sql-01", "sql", "S", "SQL"), conn("uat-sql-02", "sql", "S", "SQL"), conn("uat-cosmos", "cosmos", "C", "Cosmos")];

let mounted: Record<string, unknown> | undefined;
afterEach(() => {
  if (mounted) unmount(mounted);
  mounted = undefined;
  document.body.innerHTML = "";
  vi.useRealTimers();
});

function show(over: Partial<EnvironmentPaneProps> = {}) {
  const props: EnvironmentPaneProps = {
    env: uat,
    position: 2,
    total: 3,
    connections: () => list,
    onSave: vi.fn(async () => {}),
    onMove: vi.fn(),
    onNewConnection: vi.fn(),
    onRefresh: vi.fn(),
    onDelete: vi.fn(),
    onSelectConnection: vi.fn(),
    onExpandConnection: vi.fn(),
    onConnectionMenu: vi.fn(),
    // Never answers unless a test says otherwise: rows stay Checking.
    probe: vi.fn(() => new Promise<ProbeResult[]>(() => {})),
    ...over,
  };
  const target = document.createElement("div");
  target.style.height = "700px";
  target.style.width = "1100px";
  document.body.append(target);
  mounted = mount(EnvironmentPane, { target, props });
  flushSync();
  return props;
}

const $ = <T extends Element = HTMLElement>(selector: string) => document.querySelector<T>(selector)!;
const button = (label: string) => $<HTMLButtonElement>(`button[aria-label="${label}"]`);
const nameInput = () => $<HTMLInputElement>("#env-pane-name");

function typeName(value: string) {
  const input = nameInput();
  input.focus();
  input.value = value;
  input.dispatchEvent(new Event("input", { bubbles: true }));
}
const press = (el: Element, key: string) => el.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }));

describe("EnvironmentPane", () => {
  it("shows the header, the summary and the connections with the tree's label split", () => {
    show();
    expect($("h2").textContent).toBe("UAT");
    expect($(".place").textContent).toBe("Environment · 2 of 3");
    expect($(".summary").textContent?.replace(/\s+/g, " ").trim()).toBe("3 connections | 2 engines | checking | writes allowed");
    const rows = [...document.querySelectorAll(".conn")];
    expect(rows).toHaveLength(3);
    expect(rows[0].querySelector(".dim")?.textContent).toBe("fabrikam-");
    expect(rows[0].querySelector(".core")?.textContent).toBe("uat-sql-01");
    expect(rows[2].querySelector(".engine")?.textContent).toBe("Cosmos");
    expect([...document.querySelectorAll(".pill")].map((p) => p.textContent)).toEqual(["SQL 2", "Cosmos 1"]);
    expect(getComputedStyle($(".env-pane")).getPropertyValue("--env")).toBe("#f08c00");
  });

  it("saves the name on Enter", async () => {
    const props = show();
    typeName("  Staging ");
    press(nameInput(), "Enter");
    await vi.waitFor(() => expect(props.onSave).toHaveBeenCalledWith({ ...uat, name: "Staging" }));
    expect(props.onSave).toHaveBeenCalledTimes(1);
  });

  it("reverts the name on Escape without saving", async () => {
    const props = show();
    typeName("Typo");
    press(nameInput(), "Escape");
    flushSync();
    expect(nameInput().value).toBe("UAT");
    expect(document.activeElement).not.toBe(nameInput());
    await new Promise((r) => setTimeout(r, 20));
    expect(props.onSave).not.toHaveBeenCalled();
  });

  it("refuses an empty name, restores the previous one and flashes the field", async () => {
    const props = show();
    typeName("   ");
    press(nameInput(), "Enter");
    flushSync();
    expect(nameInput().value).toBe("UAT");
    await vi.waitFor(() => expect(nameInput().classList).toContain("bad"));
    expect(props.onSave).not.toHaveBeenCalled();
  });

  it("surfaces a failed write and puts the name back", async () => {
    show({ onSave: vi.fn(async () => Promise.reject(new Error("store is read-only"))) });
    typeName("Staging");
    press(nameInput(), "Enter");
    await vi.waitFor(() => expect($("[role=alert]").textContent).toBe("Not saved: store is read-only"));
    expect(nameInput().value).toBe("UAT");
  });

  it("the write policy menu sets readOnly, and back", async () => {
    const props = show();
    button("Write policy Allowed").click();
    flushSync();
    const items = [...document.querySelectorAll<HTMLButtonElement>("[role=menuitemradio]")];
    expect(items.map((i) => [i.textContent?.trim(), i.getAttribute("aria-checked")])).toEqual([["Allowed", "true"], ["Read-only", "false"]]);
    items[1].click();
    await vi.waitFor(() => expect(props.onSave).toHaveBeenCalledWith({ ...uat, readOnly: true }));
    flushSync();
    expect(document.querySelector("[role=menu]")).toBeNull();

    unmount(mounted!);
    document.body.innerHTML = "";
    const ro = show({ env: { ...uat, readOnly: true } });
    expect($(".summary").textContent).toContain("read-only");
    button("Write policy Read-only").click();
    flushSync();
    $<HTMLButtonElement>("[role=menuitemradio][aria-checked=false]").click();
    await vi.waitFor(() => expect(ro.onSave).toHaveBeenCalledWith({ ...uat, readOnly: false }));
  });

  it("picks a colour from the swatches or the hex field, and refuses a bad hex", async () => {
    const props = show();
    button("Colour #f08c00").click();
    flushSync();
    $<HTMLButtonElement>('[role=radio][aria-label="#1971c2"]').click();
    await vi.waitFor(() => expect(props.onSave).toHaveBeenCalledWith({ ...uat, color: "#1971c2" }));
    flushSync();
    expect(document.querySelector("[role=dialog]")).toBeNull();

    button("Colour #f08c00").click();
    flushSync();
    const hex = $<HTMLInputElement>(".hex input");
    hex.value = "nope";
    hex.dispatchEvent(new Event("input", { bubbles: true }));
    press(hex, "Enter");
    flushSync();
    expect(hex.getAttribute("aria-invalid")).toBe("true");
    hex.value = "5C7CFA";
    hex.dispatchEvent(new Event("input", { bubbles: true }));
    press(hex, "Enter");
    await vi.waitFor(() => expect(props.onSave).toHaveBeenLastCalledWith({ ...uat, color: "#5c7cfa" }));
  });

  it("disables the position arrows at the ends and moves by one otherwise", () => {
    const first = show({ position: 1, total: 3 });
    expect(button("Move up").disabled).toBe(true);
    expect(button("Move down").disabled).toBe(false);
    button("Move down").click();
    expect(first.onMove).toHaveBeenCalledWith(1);

    unmount(mounted!);
    document.body.innerHTML = "";
    show({ position: 3, total: 3 });
    expect(button("Move up").disabled).toBe(false);
    expect(button("Move down").disabled).toBe(true);

    unmount(mounted!);
    document.body.innerHTML = "";
    show({ position: 1, total: 1 });
    expect(button("Move up").disabled).toBe(true);
    expect(button("Move down").disabled).toBe(true);
  });

  it("times building the connection list, not a constant, in the footer and the card header", () => {
    // A store call that takes measurable time, so the measurement is seen to wrap it.
    const slow = () => {
      const until = performance.now() + 3;
      while (performance.now() < until);
      return list;
    };
    show({ connections: slow });
    const footer = $("footer").textContent!.replace(/\s+/g, " ");
    const match = /UAT: 3 items in ([\d.]+) ms/.exec(footer);
    expect(match).not.toBeNull();
    const ms = Number(match![1]);
    expect(Number.isFinite(ms)).toBe(true);
    expect(ms).toBeGreaterThan(0);
    expect(ms).toBeGreaterThanOrEqual(3);
    expect($(".timing").textContent).toBe(`3 listed in ${match![1]} ms`);
    expect(footer).toContain("Ready");
    expect(footer).toContain("Changes save as you make them");
  });

  it("selects a connection on click and expands it on double-click", async () => {
    const props = show();
    const row = document.querySelectorAll<HTMLButtonElement>(".conn")[1];
    // A mouse click counts its clicks in detail; a keyboard click has 0.
    const click = (detail: number) => row.dispatchEvent(new MouseEvent("click", { bubbles: true, detail }));
    click(1);
    expect(props.onSelectConnection).not.toHaveBeenCalled();
    await vi.waitFor(() => expect(props.onSelectConnection).toHaveBeenCalledWith("conn:uat-sql-02"));

    click(1);
    click(2);
    row.dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));
    expect(props.onExpandConnection).toHaveBeenCalledWith("conn:uat-sql-02");
    await new Promise((r) => setTimeout(r, 300));
    expect(props.onSelectConnection).toHaveBeenCalledTimes(1);
  });

  it("right-click on a row opens the connection's menu where the pointer is, without selecting it", async () => {
    const props = show();
    const row = document.querySelectorAll<HTMLButtonElement>(".conn")[2];
    const e = new MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: 120, clientY: 340 });
    row.dispatchEvent(e);
    expect(e.defaultPrevented).toBe(true);
    expect(props.onConnectionMenu).toHaveBeenCalledWith("conn:uat-cosmos", 120, 340);
    await new Promise((r) => setTimeout(r, 300));
    expect(props.onSelectConnection).not.toHaveBeenCalled();
  });

  it("the menu key opens it at the row when there is no pointer position", () => {
    const props = show();
    const row = document.querySelectorAll<HTMLButtonElement>(".conn")[0];
    row.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: 0, clientY: 0 }));
    const box = row.getBoundingClientRect();
    expect(props.onConnectionMenu).toHaveBeenCalledWith("conn:uat-sql-01", Math.round(box.left + 16), Math.round(box.bottom));
  });

  it("arrow keys, Home and End move between connection rows; Enter selects at once", () => {
    const props = show();
    const rows = [...document.querySelectorAll<HTMLButtonElement>(".conn")];
    rows[0].focus();
    press(rows[0], "ArrowDown");
    expect(document.activeElement).toBe(rows[1]);
    press(rows[1], "ArrowDown");
    press(rows[2], "ArrowDown");
    expect(document.activeElement).toBe(rows[2]);
    press(rows[2], "Home");
    expect(document.activeElement).toBe(rows[0]);
    press(rows[0], "ArrowUp");
    expect(document.activeElement).toBe(rows[0]);
    press(rows[0], "End");
    expect(document.activeElement).toBe(rows[2]);
    press(rows[2], "ArrowUp");
    expect(document.activeElement).toBe(rows[1]);
    // A keyboard click (Enter or Space) has no double-click to wait for.
    rows[1].dispatchEvent(new MouseEvent("click", { bubbles: true, detail: 0 }));
    expect(props.onSelectConnection).toHaveBeenCalledWith("conn:uat-sql-02");
  });

  it("probes each connection when shown, filling in Status and Ping as each lands", async () => {
    const answers = new Map<string, (r: ProbeResult[]) => void>();
    const probe = vi.fn((ids: string[], _fresh: boolean) => new Promise<ProbeResult[]>((resolve) => answers.set(ids[0], resolve)));
    show({ probe });
    expect(probe.mock.calls.map((c) => c[0])).toEqual([["uat-sql-01"], ["uat-sql-02"], ["uat-cosmos"]]);
    expect(probe.mock.calls.every((c) => c[1] === false)).toBe(true);
    const status = () => [...document.querySelectorAll(".conn .status")].map((s) => s.textContent?.trim());
    const ping = () => [...document.querySelectorAll(".conn .ping")].map((s) => s.textContent?.trim());
    expect(status()).toEqual(["Checking", "Checking", "Checking"]);

    answers.get("uat-sql-01")!([{ connectionId: "uat-sql-01", status: "reachable", ms: 3.2 }]);
    await vi.waitFor(() => expect(status()[0]).toBe("Reachable"));
    expect(ping()).toEqual(["3 ms", "-", "-"]);
    expect($(".summary").textContent).toContain("checking");

    answers.get("uat-sql-02")!([{ connectionId: "uat-sql-02", status: "reachable", ms: 88 }]);
    answers.get("uat-cosmos")!([{ connectionId: "uat-cosmos", status: "unreachable", error: "No answer within 2 s" }]);
    await vi.waitFor(() => expect(status()).toEqual(["Reachable", "Slow", "Unreachable"]));
    expect(ping()).toEqual(["3 ms", "88 ms", "-"]);
    expect(document.querySelectorAll(".conn .status")[2].getAttribute("title")).toBe("No answer within 2 s");
    expect($(".summary").textContent?.replace(/\s+/g, " ")).toContain("| 2 reachable |");
  });

  it("probes again, past the cache, on Refresh", async () => {
    const probe = vi.fn(async (ids: string[], _fresh: boolean) => ids.map((id): ProbeResult => ({ connectionId: id, status: "reachable", ms: 2 })));
    const props = show({ probe });
    await vi.waitFor(() => expect($(".summary").textContent).toContain("3 reachable"));
    button("Refresh").click();
    expect(props.onRefresh).toHaveBeenCalledOnce();
    expect(probe).toHaveBeenCalledTimes(6);
    expect(probe.mock.calls.slice(3).every((c) => c[1] === true)).toBe(true);
  });

  it("a failed probe call reads unknown rather than checking for ever", async () => {
    show({ probe: vi.fn(async () => Promise.reject(new Error("engine stopped"))) });
    await vi.waitFor(() => expect(document.querySelector(".conn .status")?.textContent?.trim()).toBe("Unknown"));
    expect(document.querySelector(".conn .status")?.getAttribute("title")).toBe("engine stopped");
  });

  it("runs New connection, Refresh and Delete", () => {
    const props = show();
    $<HTMLButtonElement>("button.new").click();
    button("Refresh").click();
    [...document.querySelectorAll<HTMLButtonElement>("button")].find((b) => b.textContent === "Delete environment")!.click();
    expect(props.onNewConnection).toHaveBeenCalledOnce();
    expect(props.onRefresh).toHaveBeenCalledOnce();
    expect(props.onDelete).toHaveBeenCalledOnce();
    expect($(".delete p").textContent).toBe("Removes the environment and its 3 connections. Saved secrets are deleted.");
  });
});
