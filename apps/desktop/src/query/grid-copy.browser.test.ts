import { flushSync, mount, unmount } from "svelte";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import ResultGrid from "./ResultGrid.svelte";
import { ResultSet } from "./store.svelte";

// #374: SSMS-style selection in the results grid, and Copy / Copy with Headers from the keyboard and a right-click menu.
let host: HTMLDivElement;
let component: ReturnType<typeof mount>;
let writeText: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  const set = new ResultSet();
  set.columns = [{ name: "id", type: "int" }, { name: "name", type: "nvarchar" }];
  set.rows = [
    [1, "a"],
    [2, null],
    [3, "c"],
  ];
  set.count = 3;
  host = document.createElement("div");
  host.style.height = "300px";
  document.body.append(host);
  component = mount(ResultGrid, { target: host, props: { set } });
  flushSync();
  writeText = vi.spyOn(navigator.clipboard, "writeText").mockResolvedValue();
});

afterEach(() => {
  unmount(component);
  host.remove();
  vi.restoreAllMocks();
});

const grid = () => host.querySelector<HTMLElement>("[role=grid]")!;
const mouse = (el: Element, type: string, init: MouseEventInit = {}) => {
  el.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, button: type === "contextmenu" ? 2 : 0, ...init }));
  flushSync();
};
const key = (k: string, init: KeyboardEventInit = {}) => {
  grid().dispatchEvent(new KeyboardEvent("keydown", { key: k, ctrlKey: true, bubbles: true, cancelable: true, ...init }));
  flushSync();
};
const cell = (r: number, c: number) => host.querySelectorAll("[role=row]")[r + 1].querySelectorAll("[role=gridcell]")[c];
const menuButton = (label: string) =>
  [...document.querySelectorAll<HTMLButtonElement>("[role=menu] button")].find((b) => b.textContent?.trim() === label);

it("selects everything from the corner box and copies it", () => {
  mouse(host.querySelector("[role=row] .num")!, "mousedown");
  key("c");
  expect(writeText).toHaveBeenLastCalledWith("1\ta\r\n2\t\r\n3\tc");
});

it("selects a row from its number without copying until asked", () => {
  mouse(host.querySelectorAll("[role=rowheader]")[1], "mousedown");
  expect(writeText).not.toHaveBeenCalled();
  key("c");
  expect(writeText).toHaveBeenLastCalledWith("2\t");
});

it("extends a row selection with Shift-click", () => {
  const nums = host.querySelectorAll("[role=rowheader]");
  mouse(nums[0], "mousedown");
  mouse(nums[1], "mousedown", { shiftKey: true });
  key("c");
  expect(writeText).toHaveBeenLastCalledWith("1\ta\r\n2\t");
});

it("selects a column from its header", () => {
  mouse([...host.querySelectorAll(".cell.head")].find((h) => h.textContent?.trim() === "name")!, "mousedown");
  key("c");
  expect(writeText).toHaveBeenLastCalledWith("a\r\n\r\nc");
});

it("selects a block by dragging across cells", () => {
  mouse(cell(0, 0), "mousedown");
  mouse(cell(1, 1), "mouseover", { buttons: 1 });
  mouse(cell(1, 1), "mouseup");
  key("C", { shiftKey: true });
  expect(writeText).toHaveBeenLastCalledWith("id\tname\r\n1\ta\r\n2\t");
});

it("selects all with Ctrl+A", () => {
  mouse(cell(0, 0), "mousedown");
  key("a");
  key("c");
  expect(writeText).toHaveBeenLastCalledWith("1\ta\r\n2\t\r\n3\tc");
});

it("offers Copy, Copy with Headers and Select All on right-click, keeping the selection", () => {
  const nums = host.querySelectorAll("[role=rowheader]");
  mouse(nums[0], "mousedown");
  mouse(nums[2], "mousedown", { shiftKey: true });
  mouse(cell(1, 0), "contextmenu");
  expect(menuButton("Copy")).toBeTruthy();
  expect(menuButton("Select All")).toBeTruthy();
  menuButton("Copy with Headers")!.click();
  flushSync();
  expect(writeText).toHaveBeenLastCalledWith("id\tname\r\n1\ta\r\n2\t\r\n3\tc");
  expect(document.querySelector("[role=menu]")).toBeNull();
});

it("right-click outside the selection selects that cell first", () => {
  mouse(cell(0, 0), "mousedown");
  mouse(cell(2, 1), "contextmenu");
  menuButton("Copy")!.click();
  flushSync();
  expect(writeText).toHaveBeenLastCalledWith("c");
});
