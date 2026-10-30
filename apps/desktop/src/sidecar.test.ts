import { describe, expect, it } from "vitest";
import { readyText } from "./sidecar";

const ping = { startupMs: 1, version: "0.1.0", mode: "test", pid: 1 };

describe("readyText", () => {
  it("is plain Ready for a healthy store", () => {
    expect(readyText(ping)).toBe("Ready");
  });

  it("names the moved-aside file, not its full path, when the store was recovered", () => {
    const text = readyText({ ...ping, storeRecoveredFrom: "C:\\Users\\me\\AppData\\Roaming\\Panoptic\\store.bin.corrupt-20261030-120000-000" });
    expect(text).toContain("store.bin.corrupt-20261030-120000-000");
    expect(text).not.toContain("AppData");
  });
});
