import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SidecarStatus } from "./sidecar";
import { sidecarView, type SidecarIndicator } from "./sidecar-status";

const tauri = vi.hoisted(() => ({
  listeners: new Map<string, (e: { payload: unknown }) => void>(),
  current: null as unknown,
}));

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(async (cmd: string) => (cmd === "sidecar_status" ? tauri.current : undefined)),
}));
vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn(async (event: string, cb: (e: { payload: unknown }) => void) => {
    tauri.listeners.set(event, cb);
    return () => {};
  }),
}));

/** Feeds statuses through sidecarView as App does; "ping" stands for a ping answering. */
function run(sequence: (SidecarStatus | "ping")[]) {
  let indicator: SidecarIndicator = "connecting";
  const seen: { indicator: SidecarIndicator; text?: string; lost?: boolean }[] = [];
  for (const step of sequence) {
    if (step === "ping") {
      indicator = "connected";
      seen.push({ indicator });
      continue;
    }
    const view = sidecarView(indicator, step);
    if (!view) continue;
    indicator = view.indicator;
    seen.push(view);
  }
  return seen;
}

describe("sidecarView", () => {
  it("connects on first start without marking anything lost", () => {
    expect(run([{ state: "starting", attempt: 1 }, { state: "running", pid: 1 }, "ping"])).toEqual([
      { indicator: "connecting", text: "Starting database engine...", lost: false },
      { indicator: "connected" },
    ]);
  });

  it("shows disconnected on a single exit and stays disconnected through the restart until ping answers", () => {
    const seen = run([
      { state: "starting", attempt: 1 },
      { state: "running", pid: 1 },
      "ping",
      { state: "exited", code: -1 },
      { state: "starting", attempt: 2 },
      { state: "running", pid: 2 },
      "ping",
    ]);
    expect(seen.map((s) => s.indicator)).toEqual(["connecting", "connected", "disconnected", "disconnected", "connected"]);
    expect(seen[2]).toEqual({ indicator: "disconnected", text: "Database engine exited (code -1), connections disconnected", lost: true });
    expect(seen[3]).toMatchObject({ text: "Restarting database engine (attempt 2)...", lost: false });
  });

  it("reports an unknown exit code", () => {
    expect(sidecarView("connected", { state: "exited", code: null })?.text).toBe("Database engine exited (code unknown), connections disconnected");
  });

  it("treats giving up and an intentional stop as lost, and a restart after a stop stays disconnected", () => {
    expect(sidecarView("connected", { state: "failed", error: "x" })).toEqual({ indicator: "disconnected", text: "Database engine stopped", lost: true });
    const seen = run([{ state: "starting", attempt: 1 }, "ping", { state: "stopped" }, { state: "starting", attempt: 1 }, "ping"]);
    expect(seen.map((s) => s.indicator)).toEqual(["connecting", "connected", "disconnected", "disconnected", "connected"]);
    expect(seen[2]).toEqual({ indicator: "disconnected", text: "Database engine stopped for update", lost: true });
    expect(seen[3]).toMatchObject({ text: "Starting database engine...", lost: false });
  });

  it("never says sidecar to the user", () => {
    const statuses: SidecarStatus[] = [
      { state: "starting", attempt: 1 },
      { state: "starting", attempt: 3 },
      { state: "exited", code: 1 },
      { state: "exited", code: null },
      { state: "failed", error: "x" },
      { state: "stopped" },
    ];
    for (const current of ["connecting", "connected", "disconnected"] as const)
      for (const status of statuses) expect(sidecarView(current, status)?.text).not.toMatch(/sidecar/i);
  });
});

describe("connectSidecar", () => {
  beforeEach(() => {
    tauri.listeners.clear();
    tauri.current = null;
  });

  it.each<SidecarStatus>([{ state: "exited", code: 1 }, { state: "failed", error: "x" }, { state: "stopped" }])(
    "rejects in-flight requests on $state",
    async (status) => {
      const { connectSidecar } = await import("./sidecar");
      const order: string[] = [];
      const client = await connectSidecar((s) => order.push(`status:${s.state}`));
      const pending = client.request("ping").catch((e: Error) => order.push(`rejected:${e.message}`));
      tauri.listeners.get("sidecar://status")!({ payload: status });
      await pending;
      expect(order).toEqual([`status:${status.state}`, "rejected:database engine stopped"]);
    },
  );

  it("reports the current status to a late subscriber", async () => {
    tauri.current = { state: "stopped" };
    const { connectSidecar } = await import("./sidecar");
    const seen: SidecarStatus[] = [];
    await connectSidecar((s) => seen.push(s));
    expect(seen).toEqual([{ state: "stopped" }]);
  });
});
