// One badge per engine everywhere (issue #208): Icon (detail pane, leaf rows) draws a connection kind exactly as the
// tree's connection rows do, from the sidecar's registry, and keeps its own glyphs only for node kinds.
import { mount, unmount } from "svelte";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import "./app.css";
import { BUILTIN_KINDS } from "./builtin-kinds";
import Icon from "./Icon.svelte";
import { kindBadge, registerKinds } from "./kinds";

let mounted: Record<string, unknown> | undefined;
beforeEach(() => registerKinds(BUILTIN_KINDS));
afterEach(() => {
  if (mounted) unmount(mounted);
  mounted = undefined;
  document.body.innerHTML = "";
});

function draw(icon: string): HTMLElement {
  const target = document.createElement("div");
  document.body.append(target);
  mounted = mount(Icon, { target, props: { icon } });
  return target.firstElementChild as HTMLElement;
}

const hex = (rgb: string) =>
  "#" + rgb.match(/\d+/g)!.slice(0, 3).map((n) => Number(n).toString(16).padStart(2, "0")).join("");

describe("Icon", () => {
  for (const { kind } of BUILTIN_KINDS)
    it(`draws the ${kind} connection with the registry's badge`, () => {
      const el = draw(kind);
      const badge = kindBadge(kind);
      expect(el.classList).toContain("kind-badge");
      expect(el.textContent).toBe(badge.letters);
      expect(hex(getComputedStyle(el).backgroundColor)).toBe(badge.color);
      if (mounted) unmount(mounted);
      mounted = undefined;
    });

  it("keeps its own glyphs for node kinds, and no engine shares a letter with one", () => {
    expect(draw("table").textContent).toBe("T");
    unmount(mounted!);
    const procLetter = draw("proc").textContent;
    unmount(mounted!);
    mounted = undefined;
    expect(BUILTIN_KINDS.map((k) => k.badge.letters)).not.toContain(procLetter);
  });
});
