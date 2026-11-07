// Seek rows carry the tree's READ ONLY pill and engine badge (#227), and a miss says what Seek searches (#215).
import { flushSync, mount, unmount } from "svelte";
import { afterEach, describe, expect, it, vi } from "vitest";
import "./app.css";
import { BUILTIN_KINDS } from "./builtin-kinds";
import { registerKinds } from "./kinds";
import type { SeekIndex } from "./seek";
import SeekBox from "./SeekBox.svelte";

registerKinds(BUILTIN_KINDS);

// Synthetic names only.
const index: SeekIndex = {
  envs: [
    { id: "env:prod", name: "Prod", color: "#e03131", readOnly: true, hosts: [{ id: "conn:p1", name: "prod-sql-01", envId: "env:prod", kind: "sql" }] },
    { id: "env:dev", name: "Dev", color: "#2f9e44", hosts: [{ id: "conn:d1", name: "dev-cosmos", envId: "env:dev", kind: "cosmos" }] },
  ],
  usage: { envs: {}, recent: [] },
};

let mounted: Record<string, unknown> | undefined;
afterEach(() => {
  if (mounted) unmount(mounted);
  mounted = undefined;
  document.body.innerHTML = "";
});

function show(query: string, scope: "all" | "connections" = "all") {
  const target = document.createElement("div");
  document.body.append(target);
  mounted = mount(SeekBox, {
    target,
    props: { index, query, scope, placeholder: "Seek", label: "Seek", onOpen: vi.fn(), onQuery: vi.fn(), onLeave: vi.fn() },
  });
  flushSync();
}

const rows = () => [...document.querySelectorAll<HTMLElement>("[role=option]")];

describe("Seek box", () => {
  it("marks a read-only environment, and its connections, with the READ ONLY pill", () => {
    show("prod");
    const [env, host] = rows();
    expect(env.textContent).toContain("Prod");
    expect(env.querySelector(".read-only")?.textContent).toBe("Read only");
    expect(host.textContent).toContain("prod-sql-01");
    expect(host.querySelector(".read-only")).not.toBeNull();
  });

  it("shows a connection's engine badge, and no pill outside a read-only environment", () => {
    show("dev-cosmos");
    const host = rows().find((r) => r.textContent?.includes("dev-cosmos"))!;
    expect(host.querySelector(".kind-badge")?.textContent).toBe("C");
    expect(host.querySelector(".read-only")).toBeNull();
  });

  it("says what Seek searches when nothing matches", () => {
    show("orders_archive");
    expect(rows()).toHaveLength(0);
    expect(document.querySelector("[role=status]")?.textContent).toContain("environments, connections and objects you have opened");
  });

  it("says no connection matches in the query tab's connection picker", () => {
    show("nothing-here", "connections");
    expect(document.querySelector("[role=status]")?.textContent).toBe("No connection matches.");
  });

  it("says nothing before anything is typed", () => {
    show("");
    expect(document.querySelector("[role=status]")).toBeNull();
  });
});
