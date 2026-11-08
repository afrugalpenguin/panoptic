import { flushSync, mount, unmount } from "svelte";
import { expect, it } from "vitest";
import ResultGrid from "./ResultGrid.svelte";
import { ResultSet } from "./store.svelte";

// #243: the grid's scroll space is 22 px a row, and Chromium clamps an element's height at about 33.5M px, so past
// about 1,525,000 rows the end of a result cannot be scrolled to (measured: at 2,000,000 rows the last row reachable
// is 1,525,212). The row limit (editor.maxRows, at most 1,000,000; the sidecar refuses or resets anything higher)
// keeps every set under that. This guards the limit's end: the last row of a full set can be scrolled to.
const MAX_ROWS = 1_000_000;
// Wall-clock cap, not a budget: building a million rows takes a moment on a slow runner.
const TEST_TIMEOUT_MS = 60_000;

it("scrolls to the last row of a result at the 1,000,000-row limit", async () => {
  const set = new ResultSet();
  set.columns = [{ name: "id", type: "int" }];
  set.rows = Array.from({ length: MAX_ROWS }, (_, i) => [i]);
  set.count = MAX_ROWS;
  const host = document.createElement("div");
  host.style.height = "600px";
  document.body.append(host);
  const component = mount(ResultGrid, { target: host, props: { set } });
  try {
    flushSync();
    const grid = host.querySelector<HTMLElement>("[role=grid]")!;

    const scrolled = new Promise((resolve) => grid.addEventListener("scroll", resolve, { once: true }));
    grid.scrollTop = grid.scrollHeight;
    await scrolled;
    flushSync();

    const last = [...grid.querySelectorAll<HTMLElement>("[role=rowheader]")].at(-1)!;
    expect(last.textContent).toBe(String(MAX_ROWS));
    expect(last.getBoundingClientRect().bottom).toBeLessThanOrEqual(grid.getBoundingClientRect().bottom + 0.5);
  } finally {
    unmount(component);
    host.remove();
  }
}, TEST_TIMEOUT_MS);
