// What's new marks the release that is running as current, not the newest section: a dev build or an outdated
// install runs an older version than the changelog's top entry (#246).
import { flushSync, mount, unmount } from "svelte";
import { afterEach, describe, expect, it, vi } from "vitest";
import "../app/app.css";
import { WhatsNewTab } from "./store.svelte";
import WhatsNewView from "./WhatsNewView.svelte";

const running = vi.hoisted(() => ({ version: "0.2.0" }));
vi.mock("@tauri-apps/api/app", () => ({ getVersion: async () => running.version }));

const sections = [
  { version: "0.2.68", date: "2026-10-30", body: "- Fixed: newest." },
  { version: "0.2.0", date: "2026-09-01", body: "- Added: older." },
];

let mounted: Record<string, unknown> | undefined;
afterEach(() => {
  if (mounted) unmount(mounted);
  mounted = undefined;
  document.body.innerHTML = "";
});

async function show(version: string) {
  running.version = version;
  const target = document.createElement("div");
  document.body.append(target);
  mounted = mount(WhatsNewView, { target, props: { tab: new WhatsNewTab(sections, "settings"), onLinkError: () => {} } });
  flushSync();
  // Let getVersion resolve.
  await new Promise((r) => setTimeout(r, 0));
  flushSync();
  return [...target.querySelectorAll("section")].map((s) => ({
    version: s.querySelector(".number")?.textContent,
    current: s.classList.contains("current"),
    pill: s.querySelector(".pill")?.textContent ?? null,
  }));
}

describe("What's new current badge", () => {
  it("marks the running version's section, not the newest", async () => {
    expect(await show("0.2.0")).toEqual([
      { version: "0.2.68", current: false, pill: null },
      { version: "0.2.0", current: true, pill: "current" },
    ]);
  });

  it("marks the newest when it is the running version", async () => {
    expect((await show("0.2.68")).map((s) => s.pill)).toEqual(["current", null]);
  });

  it("marks nothing when no section is the running version", async () => {
    expect((await show("0.1.0")).map((s) => s.current || s.pill !== null)).toEqual([false, false]);
  });
});
