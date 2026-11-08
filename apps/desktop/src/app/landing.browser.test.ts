// The landing on a first run leads with Import and New connection (#220), and shows the last place once, in Seek (#223).
import { flushSync, mount, unmount } from "svelte";
import { afterEach, describe, expect, it, vi } from "vitest";
import "./app.css";
import Landing from "./Landing.svelte";
import type { SeekIndex } from "./seek";

const empty: SeekIndex = { envs: [], usage: { envs: {}, recent: [] } };
// Synthetic names only.
const used: SeekIndex = {
  envs: [{ id: "env:dev", name: "Dev", hosts: [{ id: "conn:d1", name: "dev-01", envId: "env:dev", kind: "sql" }] }],
  usage: {
    envs: { "env:dev": { last: 2, uses: 1 } },
    last: { envId: "env:dev", hostId: "conn:d1", hostName: "dev-01", nodeId: "conn:d1/db:Orders", label: "Orders", kind: "database" },
    recent: [],
  },
};

let mounted: Record<string, unknown> | undefined;
afterEach(() => {
  if (mounted) unmount(mounted);
  mounted = undefined;
  document.body.innerHTML = "";
});

function show(index: SeekIndex, firstRun: boolean) {
  const target = document.createElement("div");
  document.body.append(target);
  const on = { onSeekOpen: vi.fn(), onSeekQuery: vi.fn(), onSeekLeave: vi.fn(), onNewQuery: vi.fn(), onNewConnection: vi.fn(), onImport: vi.fn(), onRestart: vi.fn() };
  mounted = mount(Landing, {
    target,
    props: { index, envCount: index.envs.length, connectionCount: index.envs.flatMap((e) => e.hosts).length, engine: "connected", firstRun, ...on },
  });
  flushSync();
}

const actions = () => [...document.querySelectorAll<HTMLElement>(".actions button")].map((b) => b.querySelector(".label")?.textContent);

describe("Landing", () => {
  it("on a first run, leads with Import and New connection, undimmed and explained, and focuses Import", async () => {
    show(empty, true);
    expect(actions()).toEqual(["Import", "New connection", "New query"]);
    expect(document.querySelector(".actions li.dim")).toBeNull();
    expect(document.querySelectorAll(".actions .why")).toHaveLength(2);
    await vi.waitFor(() => expect(document.activeElement?.querySelector(".label")?.textContent).toBe("Import"));
  });

  it("otherwise keeps New query first, Import dimmed, and focuses Seek", async () => {
    show(used, false);
    expect(actions()).toEqual(["New query", "New connection", "Import"]);
    expect(document.querySelector(".actions li.dim .label")?.textContent).toBe("Import");
    await vi.waitFor(() => expect(document.activeElement?.getAttribute("role")).toBe("combobox"));
  });

  it("offers the last place once, as Seek's first row, not as a separate action", () => {
    show(used, false);
    expect(document.querySelector("[role=option]")?.textContent).toContain("Pick up where you left off");
    expect(actions()).not.toContain("Reopen last session");
  });

  // At 1280x800 the workspace beside the explorer is about 990px wide, and a 300px wordmark read "noptic" (#221).
  for (const width of [600, 990, 1600])
    it(`keeps the whole wordmark's start in view at ${width}px wide`, () => {
      show(used, false);
      const host = document.body.firstElementChild as HTMLElement;
      host.style.width = `${width}px`;
      host.style.height = "760px";
      const landing = document.querySelector(".landing")!.getBoundingClientRect();
      const mark = document.querySelector(".wordmark")!.getBoundingClientRect();
      expect(mark.left).toBeGreaterThanOrEqual(landing.left);
      expect(mark.right).toBeGreaterThan(landing.right);
    });
});
