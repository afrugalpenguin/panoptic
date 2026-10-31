import { describe, expect, it } from "vitest";
import type { EnvironmentConfig } from "./api";
import { NEW_ENV, newEnvironment, NO_ENV, pickerOptions, toEnvironmentId } from "./env-picker";
import { envStyleFor } from "./import-plan";

const env = (id: string, name: string): EnvironmentConfig => ({ id, name, color: "#000", readOnly: false, connections: [] });
const envs = [env("p", "Prod"), env("d", "Dev")];

describe("pickerOptions", () => {
  it("offers None first, the environments in config order, then New environment...", () => {
    expect(pickerOptions(envs)).toEqual([
      { value: NO_ENV, label: "None" },
      { value: "p", label: "Prod" },
      { value: "d", label: "Dev" },
      { value: NEW_ENV, label: "New environment..." },
    ]);
  });

  it("can leave out None and one environment (Move to environment...)", () => {
    expect(pickerOptions(envs, { none: false, exclude: "p" }).map((o) => o.value)).toEqual(["d", NEW_ENV]);
  });

  it("with no environments still offers None and New environment...", () => {
    expect(pickerOptions([]).map((o) => o.label)).toEqual(["None", "New environment..."]);
  });
});

describe("toEnvironmentId", () => {
  it("maps None to null and keeps an environment id", () => {
    expect(toEnvironmentId(NO_ENV)).toBeNull();
    expect(toEnvironmentId("p")).toBe("p");
  });
});

describe("newEnvironment", () => {
  it("names a new environment from the trimmed name, styled like import does", () => {
    expect(newEnvironment("  Staging ", envs, "id1")).toEqual({
      environment: { id: "id1", name: "Staging", ...envStyleFor("Staging", 2), connections: [] },
      created: true,
    });
  });

  it("reuses an existing environment with the same name, ignoring case", () => {
    expect(newEnvironment("prod", envs, "id1")).toEqual({ environment: envs[0], created: false });
  });

  it("refuses an empty name", () => {
    expect(newEnvironment("   ", envs, "id1")).toEqual({ error: "Name the environment." });
  });
});
