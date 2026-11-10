// The status bar's app-wide items (#366): the explorer summary beside the ready text on the left, and the version, a
// divider and the Settings gear as the last items on the right. Real layout and focus in headless Chromium.
import { mount, unmount } from "svelte";
import { userEvent } from "vitest/browser";
import { afterEach, describe, expect, it, vi } from "vitest";
import "./app.css";
import { trackInputModality } from "./focus";
import StatusBar from "./StatusBar.svelte";

let mounted: Record<string, unknown> | undefined;
let untrack: (() => void) | undefined;
afterEach(() => {
  if (mounted) unmount(mounted);
  mounted = undefined;
  untrack?.();
  untrack = undefined;
  document.body.innerHTML = "";
});

function show(props: { sidecar?: "connecting" | "connected" | "disconnected"; summary?: string; onSettings?: () => void } = {}) {
  const target = document.createElement("div");
  target.style.width = "900px";
  document.body.append(target);
  mounted = mount(StatusBar, {
    target,
    props: {
      sidecar: props.sidecar ?? "connected",
      sidecarText: "Ready",
      inFlight: undefined,
      lastLoad: undefined,
      startup: "",
      update: { kind: "idle", current: "0.2.99" },
      onRestartToUpdate: () => {},
      problems: 0,
      onOpenProblems: () => {},
      onCancelLoad: () => {},
      summary: props.summary,
      onSettings: props.onSettings ?? (() => {}),
    },
  });
  return target.querySelector<HTMLElement>(".status")!;
}

const gear = (bar: HTMLElement) => bar.querySelector<HTMLButtonElement>('button[aria-label="Settings"]')!;

describe("status bar", () => {
  it("ends with the version, a divider and the Settings gear", () => {
    const bar = show();
    const items = [...bar.children] as HTMLElement[];
    const last = items.slice(-3);
    expect(last[0].textContent).toBe("v0.2.99");
    expect(last[0].classList.contains("muted")).toBe(true);
    expect(last[1].classList.contains("divider")).toBe(true);
    expect(last[2]).toBe(gear(bar));
    expect(gear(bar).title).toBe("Settings (Ctrl+,)");
    expect(gear(bar).getBoundingClientRect().right).toBeLessThanOrEqual(bar.getBoundingClientRect().right);
    // Same height as before: the gear fits the 24px bar.
    expect(bar.getBoundingClientRect().height).toBe(24);
  });

  it("opens Settings from the gear, which waits for the database engine", async () => {
    const onSettings = vi.fn();
    const bar = show({ onSettings });
    await userEvent.click(gear(bar));
    expect(onSettings).toHaveBeenCalledOnce();
    unmount(mounted!);
    mounted = undefined;
    expect(gear(show({ sidecar: "connecting" })).disabled).toBe(true);
  });

  it("shows the explorer summary after the ready text, behind a divider", () => {
    const bar = show({ summary: "3 environments · 20 connections" });
    const items = [...bar.children] as HTMLElement[];
    expect(items[0].textContent).toBe("Ready");
    expect(items[1].classList.contains("divider")).toBe(true);
    expect(items[2].textContent).toBe("3 environments · 20 connections");
    expect(items[2].getAttribute("role")).toBe("status");
  });

  it("leaves the summary and its divider out when there is none", () => {
    const bar = show();
    const items = [...bar.children] as HTMLElement[];
    expect(items[1].classList.contains("divider")).toBe(false);
  });
});

describe("focus ring", () => {
  const outline = (el: HTMLElement) => getComputedStyle(el).outlineStyle;

  it("is not drawn when a dialog opened by a click closes with Esc or Enter and hands focus back", async () => {
    untrack = trackInputModality();
    const bar = show();
    for (const key of ["{Escape}", "{Enter}"]) {
      await userEvent.click(gear(bar));
      // The dialog's first field takes focus; typing in it, then Esc or Enter closes it and restoreFocus (focus.ts)
      // hands focus back to the gear. Chromium counts that as keyboard focus.
      const field = document.createElement("input");
      document.body.append(field);
      field.focus();
      await userEvent.keyboard("ab");
      await userEvent.keyboard(key);
      gear(bar).focus();
      field.remove();
      expect(document.activeElement).toBe(gear(bar));
      expect(outline(gear(bar))).toBe("none");
    }
  });

  it("is drawn for keyboard focus", async () => {
    untrack = trackInputModality();
    const bar = show();
    await userEvent.click(gear(bar));
    gear(bar).blur();
    const before = document.createElement("button");
    bar.prepend(before);
    before.focus();
    // The gear is the bar's only button here, so Tab goes straight to it.
    await userEvent.keyboard("{Tab}");
    expect(document.activeElement).toBe(gear(bar));
    expect(outline(gear(bar))).toBe("solid");
  });
});
