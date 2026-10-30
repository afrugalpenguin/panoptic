import { beforeEach, describe, expect, it, vi } from "vitest";
import type { UpdateState } from "./updates";

const m = vi.hoisted(() => ({
  calls: [] as string[],
  install: async () => {},
  startFails: false,
}));

vi.mock("@tauri-apps/api/app", () => ({ getVersion: async () => "1.0.0" }));
vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(async (cmd: string) => {
    m.calls.push(cmd);
    if (cmd === "is_installed") return true;
    if (cmd === "sidecar_start" && m.startFails) throw new Error("spawn failed");
  }),
}));
vi.mock("@tauri-apps/plugin-process", () => ({ relaunch: vi.fn(async () => m.calls.push("relaunch")) }));
vi.mock("@tauri-apps/plugin-updater", () => ({
  check: vi.fn(async () => ({
    version: "1.1.0",
    download: async () => {},
    install: async () => {
      m.calls.push("install");
      await m.install();
    },
  })),
}));

async function readyUpdate() {
  const { createUpdateChecker } = await import("./updates");
  const states: UpdateState[] = [];
  const checkNow = createUpdateChecker((s) => states.push(s));
  await checkNow();
  const ready = states.at(-1);
  if (ready?.kind !== "ready") throw new Error(`expected ready, got ${ready?.kind}`);
  m.calls.length = 0;
  return { states, checkNow, install: ready.install };
}

describe("update install", () => {
  beforeEach(() => {
    m.calls.length = 0;
    m.install = async () => {};
    m.startFails = false;
  });

  it("stops the sidecar, installs, then relaunches", async () => {
    const { install } = await readyUpdate();
    await install();
    expect(m.calls).toEqual(["sidecar_stop", "install", "relaunch"]);
  });

  it("restarts the sidecar and reports the reason when installing fails", async () => {
    m.install = async () => {
      throw new Error("installer was cancelled");
    };
    const { states, install } = await readyUpdate();
    await install();
    expect(m.calls).toEqual(["sidecar_stop", "install", "sidecar_start"]);
    expect(states.at(-1)).toEqual({ kind: "installFailed", current: "1.0.0", next: "1.1.0", message: "Error: installer was cancelled" });
  });

  it("still reports the failure if the sidecar cannot be restarted, and allows checking again", async () => {
    m.install = async () => {
      throw new Error("boom");
    };
    m.startFails = true;
    const { states, install, checkNow } = await readyUpdate();
    await install();
    expect(states.at(-1)).toMatchObject({ kind: "installFailed", message: "Error: boom" });
    await checkNow();
    expect(states.at(-1)?.kind).toBe("ready");
  });
});
